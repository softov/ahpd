import { describe, expect, it, vi } from 'vitest';
import { createHost } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { hostTools } from '../src/tools/index.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Owners } from '../src/host/owners.js';
import type { Agent } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Usage, UsageEntry } from '../src/types/usage.js';
import type { Principal, Users } from '../src/types/users.js';

/*
 * Who sent each turn, and how long the host remembers it.
 *
 * `senders` and `sentBy` hold an entry by turn id, or by queued message id
 * while the message waits. Every road that ends a turn or drops a queued
 * message lets its entry go, so the two maps hold only work still in flight.
 * The maps are the host's own, read here through the owners each host built.
 */

const built = vi.hoisted(() => [] as Owners[]);

vi.mock('../src/host/owners.js', async (original) => {
  const real = await original<typeof import('../src/host/owners.js')>();
  return {
    ...real,
    createOwners: (...args: Parameters<typeof real.createOwners>) => {
      const owners = real.createOwners(...args);
      built.push(owners);
      return owners;
    },
  };
});

const DIR = '/tmp/host-senders';

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const wait = async (ms: number): Promise<void> => { await new Promise((r) => { setTimeout(r, ms); }); };

const ANA: Principal = {
  id: 'ana', roles: [], can: () => true,
  memberships: ['backend:ahpd'], primary: 'backend:ahpd', projects: [{ id: 'ahpd' }], teams: [{ id: 'backend' }],
};

/** A directory, for a host to have somebody to name. Nobody authenticates against it here. */
const directory = (): Users => ({
  resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: [], required: false },
  verify: async () => undefined,
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [{ id: 'backend' }],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

/** A backend whose every turn starts and then ends in `chat/error`. */
const failer = (): Agent => {
  const inner = echo({ path: DIR, pace: 0 });
  return {
    ...inner,
    provider: 'failer',
    displayName: 'Failer',
    create: (start) => {
      const session = inner.create(start);
      return {
        ...session,
        sendMessage: (turnId, text) => {
          start.emit('chat', { type: 'chat/turnStarted', turnId, message: { text } });
          start.emit('chat', {
            type: 'chat/error',
            turnId,
            duration: 1,
            part: { kind: 'error', error: { errorType: 'turnFailed', message: 'the model refused' } },
          });
        },
      };
    },
  };
};

/** One host with somebody to name, Ana connected to it, and one session of `provider`. */
async function signedIn(over: Partial<HostOptions> = {}, provider = 'echo') {
  const host = createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })], users: directory(), ...over });
  const owners = built.at(-1)!;
  const p = peer();
  const client = host.accept(p, ANA);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/s', provider } });
  const chat = chatUriFor('ahp-session:/s');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  const dispatch = (action: Bag) => client.handle({ method: 'dispatchAction', params: { channel: chat, action } });
  /** What the two maps hold, by id. */
  const held = () => ({ senders: [...owners.senders.keys()], sentBy: [...owners.sentBy.keys()] });
  return { host, client, peer: p, chat, dispatch, held };
}

const EMPTY = { senders: [], sentBy: [] };

describe('a turn lets go of its sender', () => {
  it('when a queued message becomes a turn and completes', async () => {
    const { dispatch, held } = await signedIn();
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'hello there' } });
    await wait(100);
    expect(held()).toEqual(EMPTY);
  });

  /*
   * Who sent a queued message is this host's record, kept beside the queue and
   * handed to the turn the message becomes, as the reference host keeps a
   * pending message's sender for the turn it admits; the turn's start carries
   * it under `ahpd.sender`, and the store keeps it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L77-L83
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L288-L326
   */
  it('keeps the queued sender on the turn it becomes', async () => {
    const store = memorySessions();
    const { dispatch, peer: p, chat } = await signedIn({ sessions: store });
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'hello there' } });
    await wait(100);
    const started = p.notes
      .filter((note) => note.method === 'action')
      .map((note) => note.params as { channel: string; action: Bag })
      .find((one) => one.channel === chat && one.action.type === 'chat/turnStarted')?.action;
    expect(started).toMatchObject({ queuedMessageId: 'q1', _meta: { 'ahpd.sender': 'user:ana' }, message: { _meta: { 'ahpd.sender': 'user:ana' } } });
    expect(store.sender('s', String(started?.turnId))).toBe('user:ana');
  });

  /*
   * A chat a tool opens with a prompt runs its first turn for whoever sent the
   * calling turn, as VS Code's host runs a delegated prompt with the calling
   * chat's credentials.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1373
   */
  it('names the calling turn\'s sender on the first turn of a chat a tool opens', async () => {
    const records: UsageEntry[] = [];
    const usage = {
      record: async (entry: UsageEntry) => { records.push(entry); },
      total: async () => ({}),
      pools: async () => [],
      records: async () => [],
      groups: async () => [],
    } as Usage;
    // The calling turn opens the chat through the tool while it runs, as a
    // model's call is made, and each turn says what it used.
    const inner = echo({ path: DIR, pace: 30 });
    const opener: Agent = {
      ...inner,
      create: (start) => {
        const session = inner.create(start);
        return {
          ...session,
          sendMessage: (turnId, text, from, attachments, options) => {
            start.emit('chat', { type: 'chat/usage', turnId, usage: { inputTokens: 3, outputTokens: 5 } });
            const going = session.sendMessage(turnId, text, from, attachments, options);
            if (text === 'open one') {
              void wait(10).then(() => start.tools?.find((one) => one.definition.name === 'create_chat')?.run?.({ prompt: 'from the tool' }));
            }
            return going;
          },
        };
      },
    };
    // Ana's session, and Bo sending the turn that calls the tool in it.
    const { host, chat } = await signedIn({ usage, agents: [opener], tools: hostTools() });
    const bo = host.accept(peer(), { ...ANA, id: 'bo' });
    await bo.handle({ method: 'initialize', params: { clientId: 'bo', protocolVersions: ['0.9.0'] } });
    await bo.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'open one' } } },
    });
    for (let i = 0; i < 80 && records.length < 2; i++) await wait(25);
    expect(records.map((one) => one.owner)).toEqual(['user:bo', 'user:bo']);
  });

  it('when the turn ends with chat/error', async () => {
    const { dispatch, held } = await signedIn({ agents: [failer()] }, 'failer');
    await dispatch({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } });
    await wait(100);
    expect(held()).toEqual(EMPTY);
  });

  it('when a client takes a queued message back', async () => {
    const { dispatch, held } = await signedIn({ agents: [echo({ path: DIR, pace: 20 })] });
    await dispatch({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'one two' } });
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'later' } });
    // The queued message's sender is the queue's, beside the turn's own.
    expect(held().sentBy).toEqual(['t1']);
    await dispatch({ type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' });
    await wait(150);
    expect(held()).toEqual(EMPTY);
  });

  it('when a ! command\'s turn completes', async () => {
    const { dispatch, held, peer: p } = await signedIn({ terminals: shellTerminals() });
    await dispatch({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo let-go' } });
    const completed = (): boolean => p.notes
      .map((note) => note.params as { action?: { type?: string; turnId?: string } })
      .some((params) => params.action?.type === 'chat/turnComplete' && params.action.turnId === 't1');
    for (let i = 0; i < 200 && !completed(); i++) await wait(25);
    expect(completed()).toBe(true);
    expect(held()).toEqual(EMPTY);
  });

  it('when the session is disposed with a turn running and a message queued', async () => {
    const { client, dispatch, held } = await signedIn({ agents: [echo({ path: DIR, pace: 1000 })] });
    await dispatch({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'one two three' } });
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'later' } });
    // The queued message's sender is the queue's, beside the turn's own.
    expect(held().sentBy).toEqual(['t1']);
    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/s' } });
    await wait(20);
    expect(held()).toEqual(EMPTY);
  });

  it('when a chat is disposed with a turn running', async () => {
    const { client, held } = await signedIn({ agents: [echo({ path: DIR, pace: 1000 })] });
    const other = 'ahp-chat:/other';
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/s', chat: other } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: other, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'one two three' } } },
    });
    expect(held().sentBy).toEqual(['t2']);
    await client.handle({ method: 'disposeChat', params: { channel: other } });
    expect(held()).toEqual(EMPTY);
  });
});
