import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Agent, Bag, Emit, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../src/index.js';

/*
 * The catalogue, the config schema and a resumed session.
 *
 * The server behind every case is the real scripted subprocess in
 * `test/fixtures/acp-server.mjs`, so what is checked is a genuine handshake:
 * the modes and config options `session/new` names, the commands a prompt
 * advertises, the rows `session/list` returns and the requests `session/load`,
 * `session/set_mode` and `session/set_config_option` actually reach. The
 * fixture records every request in a file when `ACP_LOG` names one, which is
 * how a test proves what the bridge asked for rather than reading state it
 * could have invented.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** Everything this file made, so each case leaves nothing behind. */
const made: string[] = [];
const started: Session[] = [];

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A fresh directory under the system temp root, kept for cleanup. */
const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-catalog-'));
  made.push(path);
  return path;
};

/** The backend under test, with its own request log. */
function backend(flags: string[] = []): { agent: Agent; log: string } {
  const log = join(scratch(), 'requests.jsonl');
  return {
    agent: acpAgent({
      command: process.execPath,
      args: [FIXTURE, ...flags],
      env: { ACP_LOG: log },
      provider: 'acp',
    }),
    log,
  };
}

type Watcher = {
  emit: Emit;
  actions: { channel: string; action: Bag }[];
  types(): string[];
  endings(): string[];
};

/** A session's emitted actions, which is how a test knows a turn has settled. */
function watcher(): Watcher {
  const actions: { channel: string; action: Bag }[] = [];
  const types = (): string[] => actions.map((one) => String(one.action.type));
  return {
    actions,
    emit: (channel, action) => { actions.push({ channel, action }); },
    types,
    endings: () => types().filter((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error'),
  };
}

/** The start a session is handed, without the host that would normally build it. */
const opening = (id: string, over: Partial<Start> = {}): Start => ({
  uri: `ahp-session:/${id}`,
  chatUri: `ahp-chat:/${id}`,
  settings: {},
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  ...over,
});

/** One session of a backend, watched and remembered for cleanup. */
function start(agent: Agent, id: string, over: Partial<Start> = {}): { session: Session; watch: Watcher } {
  const watch = watcher();
  const session = agent.create(opening(id, { ...over, emit: watch.emit }));
  started.push(session);
  return { session, watch };
}

/** The subprocess's work finishing, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

/** Run one turn and wait for the action that ends it. */
const runTurn = async (session: Session, watch: Watcher, turnId: string, text: string): Promise<void> => {
  const before = watch.endings().length;
  session.begin(turnId, text);
  await until(() => watch.endings().length > before);
};

/** Every request the fixture was sent, in order, and which server took it. */
const requests = (log: string): { pid?: number; method?: string; params?: Record<string, unknown> }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { pid?: number; method?: string; params?: Record<string, unknown> });
  }
  catch {
    // No file yet is no requests yet.
    return [];
  }
};

/** The session's config state, which is where the learned schema lives. */
const configOf = (session: Session): { schema: Bag; values: Record<string, unknown> } => {
  const state = session.sessionState() as { config: { schema: Bag; values: Record<string, unknown> } };
  return state.config;
};

const propertiesOf = (session: Session): Record<string, Record<string, unknown>> =>
  configOf(session).schema.properties as Record<string, Record<string, unknown>>;

it('offers no models before a session, because ACP has no pre-session catalogue', async () => {
  const { agent } = backend();
  const offered = await agent.probe?.();
  // ACP names models and commands on `session/new` and in `session/update`,
  // never on `initialize`, so an empty offer is the honest answer rather than
  // a missing one. Nothing is spawned to answer it.
  expect(offered).toEqual({ models: [], customizations: [], commands: [] });
});

it('carries an approvals control on the session, with no enum before a server is asked', () => {
  const agent = acpAgent({ command: 'node', model: 'gpt-5' });
  const properties = agent.schema().properties as Record<string, Record<string, unknown>>;
  expect(Object.keys(properties)).toEqual(['permissionMode']);
  expect(properties.permissionMode).toMatchObject({ type: 'string', scope: 'session', sessionMutable: true });
  expect(properties.permissionMode?.enum).toBeUndefined();
  // A model is the turn's rather than a config property, but the configured id
  // is still the default a client is offered.
  expect(agent.defaults()).toEqual({ model: 'gpt-5' });
});

it('keeps no per-session state file of its own', () => {
  // The ACP server owns the conversation, so undefined is the real answer
  // rather than a path to something this bridge never writes.
  expect(acpAgent({ command: 'node' }).stateFile?.('acp-session-1', '/tmp')).toBeUndefined();
});

it('reports the server model options once a session has opened', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'models');
  // Nothing has asked the server yet, and ACP has no model list before it does.
  expect(session.models()).toEqual([]);
  await runTurn(session, watch, 't1', 'hi');
  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
});

it('sets the model a turn chose on the server before prompting', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'chosen');
  const before = watch.endings().length;
  session.begin('t1', 'hi', { id: 'thorough' });
  await until(() => watch.endings().length > before);

  expect(requests(log).find((one) => one.method === 'session/set_config_option')?.params)
    .toMatchObject({ configId: 'model', value: 'thorough' });
  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
});

it('learns the server modes and reports where the session sits after a change', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'modes');
  await runTurn(session, watch, 't1', 'hi');

  expect(propertiesOf(session).permissionMode).toMatchObject({
    enum: ['ask', 'code'],
    enumLabels: ['Ask', 'Code'],
  });
  expect(configOf(session).values.permissionMode).toBe('ask');

  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  await until(() => configOf(session).values.permissionMode === 'code');
  expect(configOf(session).values.permissionMode).toBe('code');
  expect(session.settings().permissionMode).toBe('code');
  expect(requests(log).find((one) => one.method === 'session/set_mode')?.params).toMatchObject({ modeId: 'code' });
});

it('reports a command the server advertises as a customization', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'commands');
  await runTurn(session, watch, 't1', 'hi');

  const plan = session.customizations().find((one) => one.name === 'plan');
  expect(plan).toMatchObject({ type: 'prompt', id: 'command:plan', enabled: true, description: 'Draft a plan' });
  expect(watch.actions.some((one) => one.channel === 'session'
    && one.action.type === 'session/customizationsChanged')).toBe(true);
});

it('lists the sessions the server lists, mapping the fields the contract wants', async () => {
  const { agent } = backend();
  const rows = await agent.list?.();
  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(rows?.[0]).toEqual({
    id: 'listed-1',
    title: 'One',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    workingDirectories: ['file:///tmp/one'],
  });
  // A row with no title falls back to its id, and one with no timestamp to now.
  expect(rows?.[1]?.title).toBe('listed-2');
  expect(rows?.[1]?.workingDirectories).toEqual(['file:///tmp/two', 'file:///tmp/two-b']);
  expect(Number.isNaN(Date.parse(String(rows?.[1]?.createdAt)))).toBe(false);
});

it('lists every page of a catalogue the server did not fit into one answer', async () => {
  const { agent, log } = backend(['--pages']);
  const rows = await agent.list?.();
  // The second page is only reached by asking for the cursor the first one
  // named, so a bridge that reads one page reports one session and no error.
  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(2);
});

it('lists a second time on the connection the first one left open', async () => {
  const { agent, log } = backend();
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);

  // A subscribe is a list, and a client that reconnects is another: spawning a
  // server for each is a subprocess per subscribe for a catalogue that has not
  // changed. The log names the process each request reached.
  const pids = new Set(requests(log).map((one) => one.pid));
  expect(pids.size).toBe(1);
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(2);
});

it('reads back the turn this process watched and nothing for one it did not', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'transcript');
  await runTurn(session, watch, 't1', 'hi');

  const id = session.agentId();
  expect(id).toBeDefined();
  const turns = await agent.transcript?.(String(id));
  expect(turns).toHaveLength(1);
  expect(turns?.[0]?.message.text).toBe('hi');
  expect(turns?.[0]?.state).toBe('complete');
  const parts = turns?.[0]?.responseParts as { kind?: string; content?: string }[];
  expect(parts.some((part) => part.kind === 'markdown' && part.content === 'hello there')).toBe(true);
});

it('reads back a session this process never watched by loading it from the server', async () => {
  const { agent, log } = backend(['--replay']);
  // Nothing here has opened a session, so this is the read a host makes for a
  // row in the catalogue after a restart: the server is asked to replay it.
  const turns = await agent.transcript?.('acp-session-restored');
  expect(turns?.map((one) => one.message.text)).toEqual(['what did we decide?', 'and the slow one?']);
  expect(requests(log).find((one) => one.method === 'session/load')?.params)
    .toMatchObject({ sessionId: 'acp-session-restored' });
  expect(requests(log).some((one) => one.method === 'session/new')).toBe(false);
});

it('answers nothing for a session a server that cannot load does not have', async () => {
  const { agent, log } = backend(['--no-load']);
  // `undefined` rather than an empty session, which is what the host reads as
  // "no such session" and what a failed read must not look like.
  expect(await agent.transcript?.('a-session-nobody-watched')).toBeUndefined();
  expect(requests(log).some((one) => one.method === 'session/load')).toBe(false);
});

it('loads a session at the folder the server listed it under', async () => {
  const { agent, log } = backend();
  // `listed-1` is the fixture's `/tmp/one`. A server that keeps a conversation
  // by its folder finds nothing when asked with the daemon's, so the read asks
  // the way the server can answer.
  await agent.list?.();
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);

  await agent.transcript?.('listed-1');
  expect(requests(log).find((one) => one.method === 'session/load')?.params)
    .toMatchObject({ sessionId: 'listed-1', cwd: '/tmp/one' });
});

it('leaves no server behind after reading a session back', async () => {
  const pidFile = join(scratch(), 'transcript.pid');
  const { agent } = backend([`--grandchild=${pidFile}`]);
  await agent.transcript?.('acp-session-nothing-left');
  await until(() => existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, 'utf8'));

  // The read spawned a server of its own, and a read is not a session.
  await until(() => !running(pid));
  expect(running(pid)).toBe(false);
});

it('answers a second read of the same session from the record, and spawns nothing', async () => {
  const { agent, log } = backend();
  const asked = async (): Promise<number | undefined> =>
    (await agent.transcript?.('acp-session-read-once'))?.length;
  expect(await asked()).toBe(0);
  const loads = requests(log).filter((one) => one.method === 'session/load');

  // The second read is the host re-subscribing to a row it already opened, and
  // the record answers it: a server spawned per read would load it every time.
  expect(await asked()).toBe(0);
  expect(requests(log).filter((one) => one.method === 'session/load')).toHaveLength(loads.length);
});

it('reads back an interleaved turn with its parts in the order they streamed', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'interleaved');
  await runTurn(session, watch, 't1', 'ponder it');

  const turns = await agent.transcript?.(String(session.agentId()));
  const parts = turns?.[0]?.responseParts as { id: string; kind?: string; content?: string }[];
  expect(parts.map((part) => part.kind)).toEqual(['reasoning', 'toolCall', 'reasoning', 'markdown']);
  expect(parts.map((part) => part.content)).toEqual(['first thought', undefined, 'second thought', 'the answer']);
  // The same ids the live turn held, so a reloaded client keys the same parts.
  const live = session.allTurns()[0]?.responseParts as { id: string }[];
  expect(parts.map((part) => part.id)).toEqual(live.map((part) => part.id));
});

it('reads back no part for a message that was only whitespace, with the ids the live turn held', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'blank');
  await runTurn(session, watch, 't1', 'blank it');

  const turns = await agent.transcript?.(String(session.agentId()));
  const parts = turns?.[0]?.responseParts as { id: string; kind?: string; content?: string }[];
  expect(parts.map((part) => part.kind)).toEqual(['reasoning', 'toolCall', 'reasoning', 'markdown']);
  expect(parts.map((part) => part.content)).toEqual(['first thought', undefined, 'second thought', ' \nthe answer']);
  const live = session.allTurns()[0]?.responseParts as { id: string }[];
  expect(parts.map((part) => part.id)).toEqual(live.map((part) => part.id));
  expect(parts.map((part) => part.id)).toEqual(['t1:0', 'call-2', 't1:2', 't1:3']);
});

it('reaches the server for permissionMode and model, and refuses another key naming it', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'config');
  await runTurn(session, watch, 't1', 'hi');

  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  expect(await session.setConfig?.('model', 'thorough')).toBe(true);

  const refused = await session.setConfig?.('nonsense', 'x');
  expect(typeof refused).toBe('string');
  expect(String(refused)).toContain('nonsense');

  const asked = requests(log);
  expect(asked.find((one) => one.method === 'session/set_mode')?.params).toMatchObject({ modeId: 'code' });
  expect(asked.find((one) => one.method === 'session/set_config_option')?.params)
    .toMatchObject({ configId: 'model', value: 'thorough' });
});

it('loads a session on resume rather than opening a new one', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'resume', { resume: 'acp-session-resumed' });
  await runTurn(session, watch, 't1', 'hi');

  expect(session.agentId()).toBe('acp-session-resumed');
  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
  const asked = requests(log);
  expect(asked.some((one) => one.method === 'session/load')).toBe(true);
  expect(asked.some((one) => one.method === 'session/new')).toBe(false);
});

it('holds a load\'s replay out of the turn that asked for it', async () => {
  const { agent } = backend(['--replay']);
  const { session, watch } = start(agent, 'replayed', { resume: 'acp-session-replayed' });
  await runTurn(session, watch, 't1', 'hi');

  // The replay is what the server said before it answered the load, and it is
  // the conversation the session was opened for rather than this turn's answer.
  const held = session.allTurns()[0]?.responseParts as { kind?: string; content?: string }[];
  expect(held.map((part) => part.content)).toEqual(['hello there']);
  expect(JSON.stringify(watch.actions)).not.toContain('we chose the fast one');
});

it('holds a load\'s replay out of the turn after it, whoever asked for the load', async () => {
  const { agent } = backend(['--replay']);
  const { session, watch } = start(agent, 'replayed-from-config');
  // No turn has run, so the config is what opens the server and loads.
  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  expect(session.allTurns()).toEqual([]);

  await runTurn(session, watch, 't1', 'hi');
  const held = session.allTurns()[0]?.responseParts as { kind?: string; content?: string }[];
  expect(held.map((part) => part.content)).toEqual(['hello there']);
});

it('reads a loaded session back with its replayed turns ahead of the new one', async () => {
  const { agent } = backend(['--replay']);
  const { session, watch } = start(agent, 'replayed-history', { resume: 'acp-session-replayed-history' });
  await runTurn(session, watch, 't1', 'hi');

  const turns = await agent.transcript?.(String(session.agentId()));
  // The replay is the conversation the session was resumed for, so it is the
  // beginning of the history rather than something the first turn swallowed.
  expect(turns?.map((one) => one.message.text)).toEqual([
    'what did we decide?',
    'and the slow one?',
    'hi',
  ]);
  const said = (at: number) => (turns?.[at]?.responseParts as { kind?: string; content?: string }[])
    .map((part) => part.content);
  expect(said(0)).toEqual(['we chose the fast one']);
  // The second replayed turn thought before it answered, and the split kept both.
  expect(said(1)).toEqual(['weighing it up', 'we left it for later']);
  expect(said(2)).toEqual(['hello there']);
  expect(turns?.map((one) => one.state)).toEqual(['complete', 'complete', 'complete']);
});

it('reads a message that arrived in several chunks as one turn', async () => {
  const { agent } = backend(['--replay']);
  // The first replayed message is two `user_message_chunk`s, as a message with
  // a block that is not text arrives. A turn is a message, not a chunk.
  const turns = await agent.transcript?.('acp-session-chunked');
  expect(turns?.map((one) => one.message.text)).toEqual([
    'what did we decide?',
    'and the slow one?',
  ]);
  expect(turns).toHaveLength(2);
});

it('does not replay a conversation twice when a read is followed by a turn', async () => {
  const { agent, log } = backend(['--replay']);
  // What a host does for a row it is opening: read the transcript, then send a
  // turn to the same conversation. The read and the turn spawn a server each,
  // so the conversation is replayed twice - and the second replay must not land
  // in the history, or a client reads one conversation as having happened twice.
  await agent.transcript?.('acp-session-once');
  const { session, watch } = start(agent, 'once', { resume: 'acp-session-once' });
  await runTurn(session, watch, 't1', 'hi again');

  expect(requests(log).filter((one) => one.method === 'session/load').length).toBeGreaterThan(1);
  const turns = await agent.transcript?.('acp-session-once');
  // The replayed turns, then the new one, and not the replay a second time.
  expect(turns?.map((one) => one.message.text)).toEqual([
    'what did we decide?',
    'and the slow one?',
    'hi again',
  ]);
});

it('continues the same session after the server dies, rather than starting a new one', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'died');
  // The fixture exits mid-prompt, so the first turn fails and the death that
  // caused it is already heard before the second turn asks for a server.
  await runTurn(session, watch, 't1', 'die now');
  const named = session.agentId();
  expect(named).toBeDefined();

  await runTurn(session, watch, 't2', 'hi again');
  expect(watch.endings()).toEqual(['chat/error', 'chat/turnComplete']);
  // The same conversation, on whichever server answered the second turn.
  expect(session.agentId()).toBe(named);
  const loads = requests(log).filter((one) => one.method === 'session/load');
  expect(loads).toHaveLength(1);
  expect(loads[0]?.params).toMatchObject({ sessionId: named });
  expect(requests(log).filter((one) => one.method === 'session/new')).toHaveLength(1);
});

it('fails the turn after a death when the server cannot load a session', async () => {
  const { agent, log } = backend(['--no-load']);
  const { session, watch } = start(agent, 'died-no-load');
  await runTurn(session, watch, 't1', 'die now');

  await runTurn(session, watch, 't2', 'hi again');
  // A sentence, rather than a `session/new` that would answer with a
  // conversation that had lost everything the first one held.
  expect(watch.types().at(-1)).toBe('chat/error');
  expect(String((watch.actions.at(-1)?.action as { part?: { error?: { message?: string } } })
    .part?.error?.message)).toContain('cannot load a session');
  expect(requests(log).some((one) => one.method === 'session/load')).toBe(false);
  expect(requests(log).filter((one) => one.method === 'session/new')).toHaveLength(1);
});

it('tells a server that advertised session/close to close, and one that did not is not told', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'close-capability');
  await runTurn(session, watch, 't1', 'hi');
  const named = String(session.agentId());

  await session.close?.();
  expect(requests(log).find((one) => one.method === 'session/close')?.params).toMatchObject({ sessionId: named });

  const silent = backend(['--no-close']);
  const other = start(silent.agent, 'close-not-advertised');
  await runTurn(other.session, other.watch, 't1', 'hi');
  await other.session.close?.();
  expect(requests(silent.log).some((one) => one.method === 'session/close')).toBe(false);
});

it('leaves no process behind when a session closes', async () => {
  const pidFile = join(scratch(), 'grandchild.pid');
  const { agent } = backend([`--grandchild=${pidFile}`]);
  const { session, watch } = start(agent, 'close');
  await runTurn(session, watch, 't1', 'hi');
  await until(() => existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  expect(running(pid)).toBe(true);

  await session.close?.();
  // The server leads a group of its own, so the grandchild it started is in it
  // and the SIGTERM reaches both.
  await until(() => !running(pid));
  expect(running(pid)).toBe(false);
});

/** Whether a pid is still a process this user could signal. */
const running = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  }
  catch {
    return false;
  }
};
