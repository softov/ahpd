import { WAIT_MS } from '../../../tools/wait.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bag, HostOptions } from '@ahpd/sdk';
import {
  actions, builtServer, claude, createHost, defaultChatOf, echo, emit, hello, hostTools, machine, peer, resetSdk, settle,
} from './support/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { WORK } from './support/work.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const ROOT = 'ahp-root://';
const LIVE = 'ahp-session:/live';
const TWO = 'ahp-session:/two';
const PEER = 'ahp-chat:/0f8fad5b-d9cb-469f-a165-70867728950e';

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** Wait until `check` holds, or give up. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 5); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/** A host over an echo backend, with `off` naming the agents whose record is off. */
const served = (off: Set<string>, over: Partial<HostOptions> = {}) => {
  const options: HostOptions = {
    path: WORK, agents: [echo({ path: WORK, pace: 0 })], ...machine(), disabledAgents: () => off, ...over,
  };
  const host = createHost(options);
  // A folder is untrusted until the window it is in says otherwise.
  const p = peer();
  p.request = async () => ({ trusted: true });
  const client = host.accept(p);
  return { host, client, p, options };
};

/** The `agents` the root state holds now, by provider. */
const rootIds = async (client: Client): Promise<string[]> => {
  const answer = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { agents: { provider: string }[] } };
  };
  return answer.snapshot.state.agents.map((one) => one.provider);
};

/** The ids of the sessions the host lists now. */
const listed = async (client: Client): Promise<string[]> => {
  const answer = await client.handle({ method: 'listSessions', params: { channel: ROOT } }) as {
    items: { resource: string }[];
  };
  return answer.items.map((one) => one.resource);
};

/** A turn on `chat`, as a person sends one. */
const say = async (client: Client, chat: string, turnId: string, text: string): Promise<void> => {
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chat,
      action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text } },
    },
  });
};

/** A live echo session and its default chat, watched. */
const liveEcho = async (client: Client): Promise<string> => {
  await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
  await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
  const chat = await defaultChatOf(client, LIVE);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  return chat;
};

describe('an agent its record turned off', () => {
  it('leaves it off the root list, and lists it again when it is on', async () => {
    const off = new Set(['echo']);
    const { host, client, options } = served(off);
    await client.handle(hello(['0.9.0']));
    expect(await rootIds(client)).not.toContain('echo');

    off.delete('echo');
    await host.replace(options);
    await settle();
    expect(await rootIds(client)).toContain('echo');
  });

  it('refuses it a new session with the sentence, and starts one once it is on', async () => {
    const off = new Set(['echo']);
    const { client } = served(off);
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } }))
      .rejects.toMatchObject({ code: -32002, message: 'echo is turned off.' });

    off.delete('echo');
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
  });

  it('refuses a create_session tool call that names it', async () => {
    const off = new Set(['echo']);
    const host = createHost({
      path: WORK,
      agents: [claude({ paths: [WORK] }), echo({ path: WORK, pace: 0 })],
      ...machine(),
      tools: hostTools(),
      disabledAgents: () => off,
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/calling', provider: 'claude' } });
    const chat = await defaultChatOf(client, 'ahp-session:/calling');
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    // A Claude chat builds its tools at its first send, so the calling session
    // takes one turn and answers it.
    await say(client, chat, 't0', 'hello');
    await settle(8);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    await settle(8);

    const server = builtServer('host') as {
      tools: { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }> }[];
    } | undefined;
    const tool = server?.tools.find((one) => one.name === 'create_session');
    expect(tool).toBeDefined();
    const said = await tool?.handler({
      relationship: 'independent', workspace: WORK, title: 'Off', prompt: 'hello', agent: 'echo',
    });
    expect(said?.content[0]?.text).toContain('echo is turned off.');
  });

  it('refuses a new chat in a live session of it', async () => {
    const off = new Set<string>();
    const { client } = served(off);
    await liveEcho(client);
    off.add('echo');
    await expect(client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } }))
      .rejects.toMatchObject({ code: -32002, message: 'echo is turned off.' });
  });

  it('keeps the turns a session had, refuses its next message, and takes one again once it is on', async () => {
    const off = new Set<string>();
    const { client, p } = served(off);
    const chat = await liveEcho(client);
    await say(client, chat, 't1', 'hello');
    await until(() => actions(p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'));

    off.add('echo');
    await say(client, chat, 't2', 'again');
    await settle();
    const error = actions(p, chat).find((one) => one.action.type === 'chat/error' && one.action.turnId === 't2');
    expect((error?.action.part as Bag).error).toMatchObject({ message: 'echo is turned off.' });
    const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { turns: { id: string }[]; activeTurn?: unknown } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toContain('t1');
    expect(state.activeTurn).toBeUndefined();
    // Nothing ran it: the refusal is the chat's only answer to the turn.
    expect(actions(p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't2')).toBe(false);

    off.delete('echo');
    await say(client, chat, 't3', 'back');
    await until(() => actions(p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't3'));
  });

  it('refuses a chat move into a session of it', async () => {
    const off = new Set<string>();
    const { client } = served(off);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
    });
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await client.handle({ method: 'createSession', params: { channel: TWO, provider: 'echo' } });
    await settle();

    off.add('echo');
    await expect(client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } }))
      .rejects.toMatchObject({ code: -32602, message: 'echo is turned off.', data: { reason: 'agentUnavailable' } });
  });

  /*
   * A host started again on the same store reads the agent off the session's
   * record before it opens anything, so a message to that session never
   * starts a backend.
   *
   * The backend is handed to the second host as well, because the echo
   * example keeps its transcripts in memory: a fresh instance would list
   * nothing whether the record was on or off, and the listing is what this
   * case is about. A disabled agent stays registered while a session of it
   * is still held, as VS Code's host keeps a provider it turned off.
   */
  it('answers a message to a stored session of it with the sentence after a restart, and still lists it', async () => {
    const off = new Set<string>();
    const store = memorySessions();
    const agent = echo({ path: WORK, pace: 0 });
    const first = served(off, { agents: [agent], sessions: store });
    const chat = await liveEcho(first.client);
    await say(first.client, chat, 't1', 'hello');
    await until(() => actions(first.p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'));
    await first.host.close();

    off.add('echo');
    const second = served(off, { agents: [agent], sessions: store });
    await second.client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    await settle();
    expect(await listed(second.client)).toContain(LIVE);

    await say(second.client, chat, 't2', 'outside');
    await until(() => actions(second.p, chat).some((one) => one.action.turnId === 't2' && one.rejectionReason !== undefined));
    expect(actions(second.p, chat).find((one) => one.action.turnId === 't2')?.rejectionReason).toBe('echo is turned off.');
  });
});
