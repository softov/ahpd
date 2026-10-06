import { spawn as startProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { uriOf } from '../src/fileuri.js';
import { createHost } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { nestedAgent } from '../src/nested.js';
import type { NestedHost } from '../src/nested.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The proxy against real child processes.
 *
 * `nested-proxy.test.ts` drives it over in-memory streams, which cannot raise
 * `EPIPE`, close a pipe under a writer, or deliver a process's end before its
 * last output. These cases start a real `ahpd --stdio` with the fixture plugin
 * in `fixtures/plugin-nested-echo` loaded, or a shell that misbehaves the way a
 * broken machine does, and hand it to the proxy through `NestedOptions.start`.
 *
 * The inner host gets an environment of `PATH`, `HOME` and the XDG directories
 * only, with `HOME` and the XDG directories in a temporary folder, so nothing
 * from the runner's own environment decides what it does.
 */

const REPO = join(import.meta.dirname, '../../..');
const ENTRY = 'packages/server/src/main.ts';
const FIXTURE = './packages/sdk/test/fixtures/plugin-nested-echo';
const PROVIDER = 'cofold';
/** How long a real host may take to answer, on a loaded machine. */
const PATIENCE = 20_000;

type Bag = Record<string, any>;

/** Every temporary folder a case made, removed after it. */
const made: string[] = [];
/** Every child a case started, killed after it. */
const children: ChildProcessWithoutNullStreams[] = [];
/** What escaped to the process, which is what a crash of the daemon would be. */
const escaped: unknown[] = [];
const guard = (error: unknown): void => { escaped.push(error); };

beforeEach(() => {
  escaped.length = 0;
  process.on('uncaughtException', guard);
});

afterEach(() => {
  process.off('uncaughtException', guard);
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  expect(escaped).toEqual([]);
});

/** A home of its own for one inner host: `HOME` and the XDG directories in it. */
const home = (): Record<string, string> => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-nested-process-'));
  made.push(dir);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_DATA_HOME: join(dir, 'data'),
    XDG_STATE_HOME: join(dir, 'state'),
    XDG_CACHE_HOME: join(dir, 'cache'),
  };
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) mkdirSync(env[key] as string, { recursive: true });
  return env;
};

/** A child, kept so the case can signal it and the cleanup can end it. */
const child = (command: string, args: string[], env: Record<string, string>): ChildProcessWithoutNullStreams => {
  const started = startProcess(command, args, { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(started);
  return started;
};

/** A real `ahpd --stdio` with the fixture plugin loaded. */
const ahpd = (env: Record<string, string>, plugin = FIXTURE): ChildProcessWithoutNullStreams =>
  child(process.execPath, ['--conditions', 'development', '--import', './scripts/dev.mjs', ENTRY, '--stdio', '--plugin', plugin], env);

/** A shell script, as a machine that is not what it should be. */
const shell = (script: string): ChildProcessWithoutNullStreams => child('sh', ['-c', script], home());

/** Wait for something the proxy does asynchronously, without a fixed sleep. */
const until = async (check: () => boolean, ms = PATIENCE): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
};

/** What a session emitted, in order, with the channel it came out on. */
const recorder = () => {
  const seen: { channel: string; action: Bag }[] = [];
  return {
    seen,
    emit: (channel: 'session' | 'chat' | 'terminal', action: Bag): void => { seen.push({ channel, action }); },
    of: (type: string): Bag | undefined => seen.find(({ action }) => action.type === type)?.action,
    has: (type: string): boolean => seen.some(({ action }) => action.type === type),
  };
};

/** The least a session is, for a proxy driven without the host. */
const start = (emit: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void, extra: Partial<Start> = {}): Start => ({
  uri: 'ahp-session:/outer',
  chatUri: 'ahp-chat:/outer',
  settings: { computer: 'computer://box' },
  emit,
  ...extra,
} as unknown as Start);

/** The proxy, over whatever `open` starts. */
const proxy = (open: () => ChildProcessWithoutNullStreams | Promise<ChildProcessWithoutNullStreams>) =>
  nestedAgent(PROVIDER, { plugins: [FIXTURE], start: async () => await open() as unknown as NestedHost, timeoutMs: PATIENCE });

/**
 * The proxy as a backend a host serves with more than one directory.
 *
 * A restart that adds a directory is what these cases are about, and a host
 * refuses `session/workingDirectorySet` for a backend that works in one - so
 * the agent the host is given has to say it takes several. Everything else is
 * what the string form of `nestedAgent` puts on an agent itself.
 */
const manyDirectories = (open: () => ChildProcessWithoutNullStreams | Promise<ChildProcessWithoutNullStreams>) =>
  nestedAgent(
    { provider: PROVIDER, displayName: PROVIDER, multipleDirectories: true, schema: () => ({ properties: {} }), defaults: () => ({}) } as unknown as Agent,
    { plugins: [FIXTURE], start: async () => await open() as unknown as NestedHost, timeoutMs: PATIENCE },
  );

/**
 * An outer host serving the proxy, with one client watching a nested session.
 *
 * The client is a peer that keeps every notification, so a case reads what the
 * outer host said on each channel and what it refused.
 */
const outer = async (agent: Agent) => {
  const host = createHost({
    path: REPO,
    agents: [agent],
    // The proxy is started through `NestedOptions.start`, so the port is only
    // what lets a session name a machine.
    computers: { how: async () => ({ command: 'true', args: [] }) },
  });
  const notes: { method: string; params: Bag }[] = [];
  const peer: Peer = {
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { notes.push({ method, params: params as Bag }); },
  };
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  const uri = 'ahp-session:/nested-outer';
  const chatUri = chatUriFor(uri);
  await client.handle({ method: 'createSession', params: { channel: uri, provider: PROVIDER, config: { computer: 'computer://box' } } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  let seq = 0;
  return {
    host,
    uri,
    chatUri,
    notes,
    /** The actions the outer host sent on one channel, refusals included. */
    on: (channel: string): Bag[] => notes.filter(({ method, params }) => method === 'action' && params.channel === channel).map(({ params }) => params),
    dispatch: (channel: string, action: Bag): void => {
      seq += 1;
      void client.handle({ method: 'dispatchAction', params: { channel, clientSeq: seq, action } });
    },
  };
};

it('a child that exits at once ends the session with its stderr', async () => {
  const { emit, of, has } = recorder();
  const session = proxy(() => shell('echo no such plugin >&2; exit 3')).create(start(emit));
  await until(() => has('session/creationFailed'));
  const said = String(of('session/creationFailed')?.error?.message);
  expect(said).toMatch(/no such plugin/);
  expect(said).toMatch(/code 3/);
  session.close();
}, 30_000);

it('a child that closes its stdin and keeps running ends the session with a sentence', async () => {
  const { emit, of, has } = recorder();
  // Handed over once the shell has closed its stdin, so the first write is
  // the one that meets the closed pipe.
  const session = proxy(async () => {
    const closing = shell('exec 0<&-; sleep 2');
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    return closing;
  }).create(start(emit));
  await until(() => has('session/creationFailed'), 1_500);
  expect(String(of('session/creationFailed')?.error?.message)).toMatch(/computer:\/\/box/);
  session.close();
}, 30_000);

it('a real inner host killed mid-turn ends the turn and the session, naming the signal', async () => {
  const { emit, of, has } = recorder();
  let host: ChildProcessWithoutNullStreams | undefined;
  const env = { ...home(), PACE: '50' };
  const session = proxy(() => { host = ahpd(env); return host; }).create(start(emit));
  session.begin('t1', 'one two three four five six seven eight nine ten');
  await until(() => has('chat/delta'));
  expect(has('chat/delta')).toBe(true);
  host?.kill('SIGKILL');
  await until(() => has('session/creationFailed') && has('chat/error'));
  expect(String(of('session/creationFailed')?.error?.message)).toMatch(/SIGKILL/);
  expect(of('chat/error')?.turnId).toBe('t1');
  session.close();
}, 40_000);

it('a turn after the inner host was killed is refused with the sentence the session ended with', async () => {
  let inner: ChildProcessWithoutNullStreams | undefined;
  const env = home();
  const served = await outer(proxy(() => { inner = ahpd(env); return inner; }));
  served.dispatch(served.chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } });
  await until(() => served.on(served.chatUri).some(({ action }) => action.type === 'chat/turnComplete'));
  inner?.kill('SIGKILL');
  await until(() => served.on(served.uri).some(({ action }) => action.type === 'session/creationFailed'));
  const said = String(served.on(served.uri).find(({ action }) => action.type === 'session/creationFailed')?.action.error.message);
  expect(said).toMatch(/SIGKILL/);

  served.dispatch(served.chatUri, { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } });
  await until(() => served.on(served.chatUri).some(({ action, rejectionReason }) => action.turnId === 't2' && rejectionReason !== undefined), 3_000);
  const refused = served.on(served.chatUri).find(({ action, rejectionReason }) => action.turnId === 't2' && rejectionReason !== undefined);
  expect(refused?.rejectionReason).toBe(said);
  await served.host.close();
}, 40_000);

it('every chat a turn through a real inner host names is the outer chat', async () => {
  const env = home();
  const served = await outer(proxy(() => ahpd(env)));
  served.dispatch(served.chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } });
  await until(() => served.on(served.chatUri).some(({ action }) => action.type === 'chat/turnComplete'));
  const updated = served.on(served.uri).filter(({ action }) => action.type === 'session/chatUpdated').map(({ action }) => action.chat);
  expect(updated.length).toBeGreaterThan(0);
  expect(updated.filter((chat) => chat !== served.chatUri)).toEqual([]);
  // Nothing anywhere names a chat of the inner host's.
  const chats = JSON.stringify(served.notes).match(/ahp-chat:[^"\\]+/g) ?? [];
  expect(chats.filter((chat) => chat !== served.chatUri)).toEqual([]);
  await served.host.close();
}, 40_000);

it('a restart waits for the inner host it replaces, and resumes its conversation', async () => {
  const env = home();
  const started: ChildProcessWithoutNullStreams[] = [];
  /** Set when the first process's own `close` arrived. */
  let firstGone = false;
  /** Set when a second process was asked for while the first was still there. */
  let replacedTooEarly = false;
  const served = await outer(manyDirectories(() => {
    const one = ahpd(env);
    started.push(one);
    if (started.length > 1 && !firstGone) replacedTooEarly = true;
    one.once('close', () => { if (one === started[0]) firstGone = true; });
    return one;
  }));

  served.dispatch(served.chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first words' } });
  await until(() => served.on(served.chatUri).some(({ action }) => action.type === 'chat/turnComplete'));

  /** What the inner host has written down about the session it is running. */
  const kept = (): Bag[] => {
    try {
      const file = join(env.XDG_STATE_HOME as string, 'nested-echo', 'nested-outer.json');
      return (JSON.parse(readFileSync(file, 'utf8')) as Bag).turns as Bag[];
    }
    catch { return []; }
  };
  await until(() => kept().length === 1);
  expect(kept().map((turn) => turn.message?.text)).toEqual(['first words']);

  const elsewhere = mkdtempSync(join(tmpdir(), 'ahpd-nested-elsewhere-'));
  made.push(elsewhere);
  served.dispatch(served.uri, { type: 'session/workingDirectorySet', directory: uriOf(elsewhere) });
  // The host hands the action back once the restart behind it is over, so this
  // is the moment both processes have had their say.
  await until(() => served.on(served.uri).some(({ action }) => action.type === 'session/workingDirectorySet'));

  expect(started).toHaveLength(2);
  // The one it replaces is gone before the one that replaces it is started:
  // two hosts on one session would both write the transcript under it.
  expect(replacedTooEarly).toBe(false);

  // And the new one continues the conversation rather than starting another.
  served.dispatch(served.chatUri, { type: 'chat/turnStarted', turnId: 't2', message: { text: 'second words' } });
  await until(() => kept().length === 2);
  expect(kept().map((turn) => turn.message?.text)).toEqual(['first words', 'second words']);
  await served.host.close();
}, 60_000);

it('a restart before the first turn starts a session the inner host does not hold', async () => {
  const env = home();
  const started: ChildProcessWithoutNullStreams[] = [];
  const served = await outer(manyDirectories(() => {
    const one = ahpd(env);
    started.push(one);
    return one;
  }));

  const elsewhere = mkdtempSync(join(tmpdir(), 'ahpd-nested-elsewhere-'));
  made.push(elsewhere);
  served.dispatch(served.uri, { type: 'session/workingDirectorySet', directory: uriOf(elsewhere) });
  await until(() => served.on(served.uri).some(({ action }) => action.type === 'session/workingDirectorySet'));
  expect(started).toHaveLength(2);

  served.dispatch(served.chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first words' } });
  // The turn ends either way, so the case reads what happened rather than
  // waiting out a turn that nothing is going to answer.
  await until(() => served.on(served.chatUri).some(({ action }) => action.type === 'chat/turnComplete' || action.type === 'chat/error'));
  expect(served.on(served.uri).filter(({ action }) => action.type === 'session/creationFailed')).toEqual([]);
  expect(served.on(served.chatUri).some(({ action }) => action.type === 'chat/turnComplete')).toBe(true);
  await served.host.close();
}, 60_000);

it('a resumed session continues the transcript the inner host kept under its id', async () => {
  const env = home();
  const first = recorder();
  let inner: ChildProcessWithoutNullStreams | undefined;
  const one = proxy(() => { inner = ahpd(env); return inner; }).create(start(first.emit, { uri: 'ahp-session:/kept-here', chatUri: 'ahp-chat:/kept-here' }));
  one.begin('t1', 'first words');
  await until(() => first.has('chat/turnComplete'));
  const gone = new Promise((resolve) => { inner?.once('close', resolve); });
  one.close();
  await gone;

  const second = recorder();
  const two = proxy(() => ahpd(env)).create(start(second.emit, { uri: 'ahp-session:/kept-here', chatUri: 'ahp-chat:/kept-here', resume: 'kept-here' }));
  two.begin('t2', 'second words');
  await until(() => second.has('chat/turnComplete') || second.has('session/creationFailed'));
  expect(second.of('session/creationFailed')).toBeUndefined();
  const turns = two.allTurns() as Bag[];
  expect(turns.map((turn) => turn.message?.text)).toEqual(['first words', 'second words']);
  expect(two.agentId()).toBe('kept-here');
  two.close();
}, 60_000);

it('a resume the inner host has no transcript for makes the session there', async () => {
  const env = home();
  const { emit, of, has } = recorder();
  const session = proxy(() => ahpd(env)).create(start(emit, { resume: 'never-ran-here' }));
  /*
   * The resume names an id the machine has nothing under - a session made
   * before the machine was, or one whose machine has gone. The inner host
   * answers the subscribe with `No agent for session`, and the session is made
   * there under that same id rather than the turn being refused.
   */
  session.begin('t1', 'first words');
  await until(() => has('chat/turnComplete') || has('session/creationFailed'));
  expect(of('session/creationFailed')).toBeUndefined();
  expect(has('chat/turnComplete')).toBe(true);
  expect(session.agentId()).toBe('never-ran-here');
  // And the inner host kept it under the resumed id, which is where the next
  // resume looks for it.
  await until(() => {
    try {
      const kept = JSON.parse(readFileSync(join(env.XDG_STATE_HOME as string, 'nested-echo', 'never-ran-here.json'), 'utf8')) as Bag;
      return (kept.turns as Bag[]).length === 1;
    }
    catch { return false; }
  });
  session.close();
}, 60_000);

it('a restart goes on once the process is gone, with its pipes still held open', async () => {
  const lines: string[] = [];
  const { emit } = recorder();
  /*
   * A machine whose host leaves something behind that inherits its stdout: the
   * process is gone at once, and the pipes this host reads stay open until that
   * something lets go - so `close` says nothing for seconds, and the process's
   * own `exit` is the only word that it has gone.
   */
  const inner = shell('sleep 8 & exit 0');
  const session = nestedAgent(PROVIDER, {
    plugins: [FIXTURE],
    start: async () => inner as unknown as NestedHost,
    timeoutMs: PATIENCE,
    log: (line) => lines.push(line),
  }).create(start(emit));
  await until(() => inner.exitCode !== null);

  const waited = await Promise.race([
    Promise.resolve(session.close(false)).then(() => 'gone'),
    new Promise((resolve) => { setTimeout(() => resolve('still open'), 6_000); }),
  ]);
  expect(waited).toBe('gone');
  // And not by the bound: the process itself said it had gone.
  expect(lines.some((line) => line.includes('is still there'))).toBe(false);
}, 30_000);

it('a closed session stops an inner host that will not take SIGTERM, within the bound', async () => {
  const { emit, has } = recorder();
  let inner: ChildProcessWithoutNullStreams | undefined;
  const env = { ...home(), IGNORE_SIGTERM: '1' };
  const session = proxy(() => { inner = ahpd(env); return inner; }).create(start(emit));
  session.begin('t1', 'hello');
  await until(() => has('chat/turnComplete'));
  const gone = new Promise<string | null>((resolve) => { inner?.once('close', (_code, signal) => { resolve(signal); }); });
  const closedAt = Date.now();
  session.close();
  // Disposing, then SIGTERM, then SIGKILL a few seconds later.
  expect(await gone).toBe('SIGKILL');
  expect(Date.now() - closedAt).toBeLessThan(10_000);
}, 40_000);

it('a plugin the inner host cannot load ends the session naming it', async () => {
  const { emit, of, has } = recorder();
  const session = nestedAgent(PROVIDER, {
    plugins: ['@ahpd/agent-not-installed'],
    start: () => ahpd(home(), '@ahpd/agent-not-installed') as unknown as NestedHost,
    timeoutMs: PATIENCE,
  }).create(start(emit));
  await until(() => has('session/creationFailed'));
  expect(String(of('session/creationFailed')?.error?.message)).toMatch(/@ahpd\/agent-not-installed/);
  session.close();
}, 40_000);

it('an inner host that cannot make its configuration directory ends the session with its EACCES line', async () => {
  const env = home();
  const config = env.XDG_CONFIG_HOME as string;
  chmodSync(config, 0o500);
  try {
    const { emit, of, has } = recorder();
    const session = proxy(() => ahpd(env)).create(start(emit));
    await until(() => has('session/creationFailed'));
    expect(String(of('session/creationFailed')?.error?.message)).toMatch(/EACCES/);
    session.close();
  }
  finally {
    chmodSync(config, 0o700);
  }
}, 40_000);
