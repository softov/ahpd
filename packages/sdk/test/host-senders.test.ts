import { describe, expect, it, vi } from 'vitest';
import { createHost } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Owners } from '../src/host/owners.js';
import type { Agent } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
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
  return { client, peer: p, chat, dispatch, held };
}

const EMPTY = { senders: [], sentBy: [] };

describe('a turn lets go of its sender', () => {
  it('when a queued message becomes a turn and completes', async () => {
    const { dispatch, held } = await signedIn();
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'hello there' } });
    await wait(100);
    expect(held()).toEqual(EMPTY);
  });

  it('keeps the queued sender on the turn it becomes', async () => {
    const { dispatch, peer: p, chat } = await signedIn();
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'hello there' } });
    await wait(100);
    const started = p.notes
      .filter((note) => note.method === 'action')
      .map((note) => note.params as { channel: string; action: Bag })
      .find((one) => one.channel === chat && one.action.type === 'chat/turnStarted')?.action;
    expect(started).toMatchObject({ queuedMessageId: 'q1', _meta: { 'ahpd.sender': 'user:ana' } });
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
    expect(held().sentBy).toContain('q1');
    await dispatch({ type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' });
    await wait(150);
    expect(held()).toEqual(EMPTY);
  });

  it('when a ! command reaches a backend that cannot run one', async () => {
    const { dispatch, held, peer: p } = await signedIn({ terminals: shellTerminals() });
    await dispatch({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo must-not-run' } });
    await wait(50);
    const ended = p.notes
      .map((note) => note.params as { action?: { type?: string; part?: { error?: { message?: string } } } })
      .find((params) => params.action?.type === 'chat/error');
    expect(ended?.action?.part?.error?.message).toContain('cannot run a command in a turn');
    expect(held()).toEqual(EMPTY);
  });

  it('when the session is disposed with a turn running and a message queued', async () => {
    const { client, dispatch, held } = await signedIn({ agents: [echo({ path: DIR, pace: 1000 })] });
    await dispatch({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'one two three' } });
    await dispatch({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'later' } });
    expect(held().sentBy.sort()).toEqual(['q1', 't1']);
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
