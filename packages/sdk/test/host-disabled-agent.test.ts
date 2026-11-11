import { WAIT_MS } from '../../../tools/wait.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Turn } from '@microsoft/agent-host-protocol';
import type { Bag, HostOptions } from '@ahpd/sdk';
import type { WireTurn } from '../src/types/wire.js';
import {
  actions, builtServer, claude, createHost, defaultChatOf, echo, emit, hello, hostTools, machine, peer, resetSdk, settle,
} from './support/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { uriOf } from '../src/resources/fileuri.js';
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

/** A host over an echo backend, with `off` and `paused` naming the agents whose record says so. */
const served = (off: Set<string>, over: Partial<HostOptions> = {}, paused = new Set<string>()) => {
  const options: HostOptions = {
    path: WORK,
    agents: [echo({ path: WORK, pace: 0 })],
    ...machine(),
    disabledAgents: () => off,
    pausedAgents: () => paused,
    ...over,
  };
  const host = createHost(options);
  // A folder is untrusted until the window it is in says otherwise.
  const p = peer();
  p.request = async () => ({ trusted: true });
  const client = host.accept(p);
  return { host, client, p, options };
};

/**
 * The echo backend a second start is given: its own instance, which lists the
 * stored session and answers its transcript, as a restarted daemon's does.
 */
const restarted = (turns: Bag[]): ReturnType<typeof echo> => {
  const base = echo({ path: WORK, pace: 0 });
  return {
    ...base,
    list: async () => [{
      id: 'live',
      title: 'Earlier',
      createdAt: '2026-11-11T00:00:00.000Z',
      modifiedAt: '2026-11-11T00:00:00.000Z',
      workingDirectories: [uriOf(WORK)],
    }],
    transcript: async () => turns as WireTurn<Turn>[],
  };
};

/** A turn as a transcript reads it back. */
const said = (id: string, text: string): Bag => ({
  id,
  message: { text, origin: { kind: 'user' } },
  state: 'complete',
  responseParts: [{ kind: 'markdown', id: `${id}:0`, content: text }],
});

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

/** The turns a chat holds now, read by subscribing to it. */
const turnsOf = async (client: Client, chat: string): Promise<string[]> => {
  const answer = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns: { id: string }[] } };
  };
  return answer.snapshot.state.turns.map((one) => one.id);
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

/** The message a `create_session` tool call on `echo` answers with. */
const createSessionTool = async (off: Set<string>, paused: Set<string>): Promise<string | undefined> => {
  const host = createHost({
    path: WORK,
    agents: [claude({ paths: [WORK] }), echo({ path: WORK, pace: 0 })],
    ...machine(),
    tools: hostTools(),
    disabledAgents: () => off,
    pausedAgents: () => paused,
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
  await host.close();
  return said?.content[0]?.text;
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
    expect(await createSessionTool(new Set(['echo']), new Set())).toContain('echo is turned off.');
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
   * A host started again on the same store with the record still off opens no
   * backend of the agent, so no listing offers the stored session: it leaves
   * the list. Turning the record on opens its backend and folds the list, and
   * the session is listed again with the turns the transcript holds.
   *
   * The second host gets its own backend instance, not the first one's: the
   * echo example keeps its transcripts in memory, so a fresh instance that
   * listed nothing would say nothing about the restart.
   */
  it('leaves a stored session off the list after a restart, and lists it again once the agent is on', async () => {
    const store = memorySessions();
    const off = new Set<string>();
    const first = served(off, { sessions: store });
    const chat = await liveEcho(first.client);
    await say(first.client, chat, 't1', 'hello');
    await until(() => actions(first.p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'));
    expect(await listed(first.client)).toContain(LIVE);
    await first.host.close();

    off.add('echo');
    const second = served(off, { agents: [], sessions: store });
    await second.client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    await settle();
    expect(await listed(second.client)).not.toContain(LIVE);

    // What `x-ahpd/agents/enable` leaves behind: the mode is on, and the fold
    // that follows serves the record's backend again.
    off.delete('echo');
    second.options.agents = [restarted([said('t1', 'hello')])];
    await second.host.replace(second.options);
    await settle();
    expect(await listed(second.client)).toContain(LIVE);
    expect(await turnsOf(second.client, chat)).toContain('t1');
  });
});

describe('an agent its record paused', () => {
  it('leaves it off the root list', async () => {
    const paused = new Set(['echo']);
    const { host, client, options } = served(new Set(), {}, paused);
    await client.handle(hello(['0.9.0']));
    expect(await rootIds(client)).not.toContain('echo');

    paused.delete('echo');
    await host.replace(options);
    await settle();
    expect(await rootIds(client)).toContain('echo');
  });

  it('refuses it a new session with the paused sentence, and starts one once it is on', async () => {
    const paused = new Set(['echo']);
    const { client } = served(new Set(), {}, paused);
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } }))
      .rejects.toMatchObject({ code: -32002, message: 'echo is paused.' });

    paused.delete('echo');
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
  });

  it('refuses a create_session tool call that names it', async () => {
    expect(await createSessionTool(new Set(), new Set(['echo']))).toContain('echo is paused.');
  });

  it('refuses a new chat in a live session of it', async () => {
    const paused = new Set<string>();
    const { client } = served(new Set(), {}, paused);
    await liveEcho(client);
    paused.add('echo');
    await expect(client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } }))
      .rejects.toMatchObject({ code: -32002, message: 'echo is paused.' });
  });

  it('keeps the turns a session had and refuses its next message with the paused sentence', async () => {
    const paused = new Set<string>();
    const { client, p } = served(new Set(), {}, paused);
    const chat = await liveEcho(client);
    await say(client, chat, 't1', 'hello');
    await until(() => actions(p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'));

    paused.add('echo');
    await say(client, chat, 't2', 'again');
    await settle();
    const error = actions(p, chat).find((one) => one.action.type === 'chat/error' && one.action.turnId === 't2');
    expect((error?.action.part as Bag).error).toMatchObject({ message: 'echo is paused.' });
    expect(await turnsOf(client, chat)).toContain('t1');
    expect(actions(p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't2')).toBe(false);

    paused.delete('echo');
    await say(client, chat, 't3', 'back');
    await until(() => actions(p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't3'));
  });

  it('refuses a chat move into a session of it', async () => {
    const paused = new Set<string>();
    const { client } = served(new Set(), {}, paused);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
    });
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await client.handle({ method: 'createSession', params: { channel: TWO, provider: 'echo' } });
    await settle();

    paused.add('echo');
    await expect(client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } }))
      .rejects.toMatchObject({ code: -32602, message: 'echo is paused.', data: { reason: 'agentUnavailable' } });
  });

  /*
   * A paused record is opened at start, so a host started again serves its
   * agent and lists the stored session with the turns its transcript holds.
   * Its backend is a second instance answering that transcript and the row,
   * because the echo example keeps both in memory.
   */
  it('lists a stored session with its turns after a restart, and refuses its message', async () => {
    const store = memorySessions();
    const paused = new Set<string>();
    const first = served(new Set(), { sessions: store });
    const chat = await liveEcho(first.client);
    await say(first.client, chat, 't1', 'hello');
    await until(() => actions(first.p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'));
    await first.host.close();

    paused.add('echo');
    const second = served(new Set(), { agents: [restarted([said('t1', 'hello')])], sessions: store }, paused);
    await second.client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    await settle();
    expect(await listed(second.client)).toContain(LIVE);
    expect(await turnsOf(second.client, chat)).toContain('t1');
    // Opening the session wakes it, as a window opening the row does.
    await second.client.handle({ method: 'subscribe', params: { channel: LIVE } });

    await say(second.client, chat, 't2', 'outside');
    await until(() => actions(second.p, chat).some((one) => one.action.type === 'chat/error' && one.action.turnId === 't2'));
    expect(actions(second.p, chat).find((one) => one.action.type === 'chat/error' && one.action.turnId === 't2')?.action.part)
      .toMatchObject({ error: { message: 'echo is paused.' } });

    paused.delete('echo');
    await say(second.client, chat, 't3', 'back');
    await until(() => actions(second.p, chat).some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't3'));
  });
});
