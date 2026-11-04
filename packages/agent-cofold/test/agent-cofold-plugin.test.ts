import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { Policy } from '@cofold/agents';
import { createHost } from '../../sdk/src/host.js';
import { describePlugin, loadPlugins } from '../../server/src/plugins.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Engine, AgentView, Bag } from '@ahpd/sdk';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { HostTool } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * The package as a plugin: the manifest, the loader and a served turn.
 *
 * Every case here goes through the real loader and the real host. The model is
 * a script and the store is in memory or under a temporary directory, because
 * a test calls no endpoint; what is under test is that the manifest resolves
 * the module, that `apply` registers the engine `cofold`, that a record of it
 * serves a turn exactly as a literal backend's is, and that a resumed paused
 * run reaches a subscribing client once.
 *
 * An agent is a record now, so a case that wants a backend opens one through
 * the engine and hands it to the host: this package registers no agent of its
 * own.
 *
 * The source file is named rather than the package directory on purpose:
 * `pnpm test` does not build, and the loader applies a manifest's `ahpd.entry`
 * only when the package was resolved, so a file spec loads the file it names
 * rather than the `dist` build beside it.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-cofold/src/index.ts';

/** A temporary directory removed after the one test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

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

/** Let the run's zero-delay work finish, up to a point; no wall-clock waiting on a real model. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

/** One backend the daemon would have had anyway, so the plugin's is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/plugin-cofold',
  agents: [{ ...echo({ path: '/tmp/plugin-cofold', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
});

const load = (specs: PluginSpec[], over: Partial<HostOptions> = {}) =>
  loadPlugins(specs, { base: { ...base(), ...over }, configDir: REPO, cwd: REPO, log: () => {} });

/**
 * The loader and the host a restarted daemon builds.
 *
 * A restart is a new process, and a new process starts with cofold's
 * module-level set of live runs empty, so a run the first daemon left paused
 * can be resumed. `vi.resetModules()` and these imports are what make that
 * second life here: the loader, the sdk, the host and the plugin the loader
 * imports are all fresh copies, and they share nothing with the first host but
 * the store directory.
 */
const restarted = async (): Promise<{
  load: (specs: PluginSpec[], over?: Partial<HostOptions>) => ReturnType<typeof load>;
  host: typeof createHost;
}> => {
  vi.resetModules();
  const loader = await import('../../server/src/plugins.js');
  const sdk = await import('../../sdk/src/host.js');
  return {
    load: (specs, over = {}) => loader.loadPlugins(specs, {
      base: { ...base(), ...over }, configDir: REPO, cwd: REPO, log: () => {},
    }),
    host: sdk.createHost,
  };
};

const initialize = async (client: ReturnType<ReturnType<typeof createHost>['accept']>) => await client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
}) as { snapshots: { state: { agents: { provider: string }[] } }[] };

/** The `cofold` engine one load registered. */
const engineOf = (options: HostOptions): Engine => {
  const engine = options.engines?.['cofold'];
  if (engine === undefined) throw new Error('no cofold engine was registered');
  return engine;
};

/**
 * The line the loader writes for an embedder's `adapter`.
 *
 * `adapter` is an object of methods, which JSON cannot carry, so it is not in
 * the manifest's options schema: the loader names it as an option it does not
 * know and passes it through, and that one line is not a refusal.
 */
const PASSED_ADAPTER = 'plugin agent-cofold: plugins.agent-cofold.options.adapter is not an option agent-cofold knows; passed through';

/**
 * One record, as an engine is handed it: every field read at each call.
 *
 * `config` is the reader the channel installs, so a case changes what a record
 * says by changing what this answers.
 */
const viewOf = (id: string, held: () => Bag, name = id): AgentView => ({
  id,
  engine: 'cofold',
  owner: 'host',
  name,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return held(); },
});

/** A host that serves the daemon's own agents beside one record of the engine. */
const withRecord = (options: HostOptions, id: string, held: () => Bag, name = id) => createHost({
  ...options,
  agents: [...options.agents, engineOf(options).open(viewOf(id, held, name))],
});

/** Open one session on a provider and watch both of its channels. */
async function open(client: ReturnType<ReturnType<typeof createHost>['accept']>, provider: string, name: string) {
  const uri = `ahp-session:/${name}`;
  await client.handle({ method: 'createSession', params: { channel: uri, provider } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { uri, chatUri };
}

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  chatUri: string,
  turnId: string,
  text: string,
): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
};

it('loads the package from its source file and serves a turn through the stub model', async () => {
  const model = createFakeModel({ script: [{ text: 'answered by the plugin' }], stream: true });
  const { options, loaded, problems } = await load([
    { name: SOURCE, options: { adapter: model, memory: true } },
  ]);

  expect(problems).toEqual([PASSED_ADAPTER]);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.name).toBe('agent-cofold');
  // The module exports no title, so this is the manifest's `ahpd.title`.
  expect(loaded[0]?.title).toBe('Agent Cofold');

  // An agent is a record now, so the load registers an engine and adds no agent:
  // the one served here is a record this case opened through it.
  expect(engineOf(options).name).toBe('cofold');
  expect(options.agents.map((one) => one.provider)).toEqual(['base']);

  const host = withRecord(options, 'cofold', () => ({}), 'Cofold');
  const said = peer();
  const client = host.accept(said);
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'cofold']);

  const { chatUri } = await open(client, 'cofold', 'plugin');
  begin(client, chatUri, 't1', 'hello there');
  await until(() => ended(said, chatUri));
  expect(types(said, chatUri).at(-1)).toBe('chat/turnComplete');

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns).toHaveLength(1);
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('answered by the plugin');
});

it('lists a manifest, and its title, with the package name as its id', async () => {
  /*
   * A manifest in its own directory rather than this package's: the loader
   * resolves a directory through `ahpd.entry`, `exports["."]` or `main`, and
   * every one of those names the `dist` build, which is gitignored and so
   * absent in a fresh checkout. Naming this package here made the case depend
   * on the build rather than on the loader. The package's own name and title
   * are asserted by the served turn above, which resolves it from its source.
   */
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-listing-'));
  loose = dir;
  writeFileSync(join(dir, 'entry.js'), 'export const apply = () => {};\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@ahpd/agent-cofold',
    private: true,
    type: 'module',
    exports: { '.': './entry.js' },
    ahpd: { entry: './entry.js', title: 'Agent Cofold' },
  }));

  const row = await describePlugin(dir, { configDir: REPO, cwd: REPO });

  expect(row.state).toBe('ready');
  // The entry exports no name, so the key is the package's own name, its scope
  // joined by a dash.
  expect(row.name).toBe('ahpd-agent-cofold');
  expect(row.module).toBe('@ahpd/agent-cofold');
  expect(row.title).toBe('Agent Cofold');
  expect(row.path).toBe(join(dir, 'entry.js'));
});

it('is loaded once, and refuses a second spec of the same name', async () => {
  const a = createFakeModel({ script: [{ text: 'answered by a' }], stream: true });
  const b = createFakeModel({ script: [{ text: 'answered by b' }], stream: true });
  const { options, loaded, problems } = await load([
    { name: SOURCE, options: { adapter: a, memory: true } },
    { name: SOURCE, options: { adapter: b, memory: true } },
  ]);

  // A plugin is loaded once: what makes two backends of this package is two
  // records of its engine, not two specs of it.
  expect(problems).toEqual([`plugin agent-cofold is named 2 times, by ${SOURCE} and ${SOURCE}; write it once and use its options for variants`, PASSED_ADAPTER]);
  expect(loaded).toHaveLength(1);
  expect(loaded.map((one) => one.name)).toEqual(['agent-cofold']);

  // The one load that survived registered the engine, and serves no agent of its
  // own: the daemon's own agent is the only one in the list.
  expect(engineOf(options).name).toBe('cofold');
  expect(options.agents.map((one) => one.provider)).toEqual(['base']);
});

it('refuses an autoCompactTokens the loader\'s options check rejects', async () => {
  const model = createFakeModel({ script: [{ text: 'hi' }], stream: true });
  // The schema says a positive integer, and the loader holds the options to
  // it: a point of zero is a session that folds before it has said anything.
  for (const value of [0, 'x']) {
    const { loaded, problems } = await load([{ name: SOURCE, options: { adapter: model, memory: true, autoCompactTokens: value } }]);
    expect(loaded).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('autoCompactTokens');
  }

  const fine = await load([{ name: SOURCE, options: { adapter: model, memory: true, autoCompactTokens: 4000 } }]);
  expect(fine.problems).toEqual([PASSED_ADAPTER]);
  expect(fine.loaded).toHaveLength(1);
});

/*
 * The `tools` option is held to the schema the harness validates its own
 * configuration file against, so a key cofold does not know is a person who
 * meant something else and is told so rather than quietly given the default.
 * `strictTools: false` is the way back: the loose reading drops what it cannot
 * use, which is what a configuration written for a later cofold needs.
 */
it('refuses a tools option the harness schema does not know, unless strictTools is false', async () => {
  const model = createFakeModel({ script: [{ text: 'hi' }], stream: true });

  const strict = await load([{ name: SOURCE, options: { adapter: model, memory: true, tools: { filse: true } } }]);
  expect(strict.loaded).toEqual([]);
  expect(strict.problems).toHaveLength(2);
  expect(strict.problems[1]).toContain('tools.filse');

  const loose = await load([{
    name: SOURCE,
    options: { adapter: model, memory: true, strictTools: false, tools: { filse: true, shell: false } },
  }]);
  expect(loose.problems).toEqual([PASSED_ADAPTER]);
  expect(loose.loaded).toHaveLength(1);

  const fine = await load([{ name: SOURCE, options: { adapter: model, memory: true, tools: { shell: false } } }]);
  expect(fine.problems).toEqual([PASSED_ADAPTER]);
  expect(fine.loaded).toHaveLength(1);
});

it('refuses the package when its @ahpd/sdk peer range is not satisfied', async () => {
  /*
   * A temporary copy of the manifest, not of the sources: the range check runs
   * before `import()`, so the entry it points at is never reached and only the
   * manifest has to be real. The copy is removed after the test.
   */
  loose = mkdtempSync(join(tmpdir(), 'ahpd-cofold-peer-'));
  writeFileSync(join(loose, 'package.json'), JSON.stringify({
    name: '@ahpd/agent-cofold',
    version: '0.0.1',
    type: 'module',
    peerDependencies: { '@ahpd/sdk': '^9.9.9' },
    ahpd: { entry: './index.js', title: 'Agent Cofold' },
  }, null, 2));
  writeFileSync(join(loose, 'index.js'), 'export function apply() {}\n');

  const { loaded, problems } = await load([loose]);
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('^9.9.9');
  expect(problems[0]).toContain(sdkVersion());
});

/** Wait until the store says a session's newest run is waiting on a person. */
const pausedRun = async (root: string, sessionId: string): Promise<void> => {
  const store = createFileStore({ root });
  for (let i = 0; i < 400; i++) {
    // The session directory does not exist until the turn writes something,
    // and asking for its runs before then is an error rather than an empty
    // list, so the record is what says the store is ready to be read.
    const record = await store.sessions.get({ sessionId });
    if (record !== undefined) {
      const runs = await store.runs.list({ sessionId });
      if (runs[0]?.status === 'awaiting') return;
    }
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

it('resumes a paused run and shows the open turn once to a client that subscribes after', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-cofold-resume-'));
  const where = mkdtempSync(join(tmpdir(), 'ahpd-cofold-work-'));
  const asks: Partial<Policy> = {
    decide: ({ tool }) => (tool.name === 'write' ? { behavior: 'ask' } : { behavior: 'allow' }),
  };
  const ran: string[] = [];
  const writer: HostTool = {
    definition: {
      name: 'write',
      title: 'Write a note',
      description: 'Writes a note somewhere.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    run: (input) => {
      ran.push(String(input.text));
      return `wrote ${String(input.text)}`;
    },
  };
  const script = [{ toolCalls: [{ name: 'write', input: { text: 'hi' }, callId: 'call-a' }] }];

  // The first process: one turn that pauses on the approval and stays open.
  const first = await load([{ name: SOURCE, options: {
    adapter: createFakeModel({ script, stream: true }), store: root, policy: asks,
  } }], { path: where, tools: [writer] });
  const before = withRecord(first.options, 'cofold', () => ({}), 'Cofold');
  const clientA = before.accept(peer());
  await initialize(clientA);
  const opened = await open(clientA, 'cofold', 'one');
  begin(clientA, opened.chatUri, 't1', 'hi');
  // A record keeps its store under the plugin's folder, in a folder of its own.
  await pausedRun(join(root, 'cofold'), 'one');
  /*
   * The first host is abandoned rather than closed: `close()` denies the open
   * request, and the point is a process that went away leaving the run
   * `awaiting`, which is the restart the second host below continues.
   */

  // The second process, over the same store, resumes the run when a client
  // says something on the session the catalogue listed.
  const again = await restarted();
  const second = await again.load([{ name: SOURCE, options: {
    adapter: createFakeModel({ script: [{ text: 'done' }, { text: 'carried on' }], stream: true }), store: root, policy: asks,
  } }], { path: where, tools: [writer] });
  /*
   * The engine and the host come from the fresh copies, so the second process is
   * the same code as the first and shares nothing with it but the store.
   */
  const freshEngine = second.options.engines?.['cofold'];
  if (freshEngine === undefined) throw new Error('no cofold engine was registered');
  const after = again.host({
    ...second.options,
    agents: [...second.options.agents, freshEngine.open(viewOf('cofold', () => ({}), 'Cofold'))],
  });
  const p = peer();
  const client = after.accept(p);
  await initialize(client);
  /*
   * A listed session keeps the `ahp-session:` URI the first process created it
   * with: the catalogue names a row by the name its record holds, and that is
   * the channel a client browses and continues it on.
   */
  const session = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = session.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  /*
   * The paused run's turn reads back as VS Code reads a turn still running when
   * its agent went away: interrupted, an error the client may resume, and the
   * client's resume is what continues the run on its question. A queued
   * message then waits behind the resumed turn.
   */
  const read = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { id: string; state: string; responseParts: { kind: string; resumable?: boolean }[] }[] } };
  };
  const interrupted = read.snapshot.state.turns.at(-1);
  expect(interrupted?.state).toBe('error');
  expect(interrupted?.responseParts.at(-1)).toMatchObject({ kind: 'error', resumable: true });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnResume', turnId: String(interrupted?.id) } },
  });
  await until(() => actions(p, 'ahp-session:/one').some((e) => e.action.type === 'session/inputNeededSet'));
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q2', message: { text: 'carry on', origin: { kind: 'user' } } } },
  });

  /*
   * A client that arrives after the resume reads the chat snapshot the way a
   * subscription does. The resumed turn must appear once: as the active turn,
   * and not again in the history the host seeded from `transcript(id)`.
   */
  const late = peer();
  const lateClient = after.accept(late);
  await initialize(lateClient);
  const shown = await lateClient.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { id: string }[]; activeTurn?: { id: string } } };
  };
  const active = shown.snapshot.state.activeTurn;
  expect(active).toBeDefined();
  const copies = shown.snapshot.state.turns.filter((turn) => turn.id === active?.id).length + (active === undefined ? 0 : 1);
  expect(copies).toBe(1);

  // Answering the replayed request continues the run the first host left open.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-a', approved: true, confirmed: 'user-action' } },
  });
  await until(() => ended(p, chatUri));
  expect(ran).toEqual(['hi']);
  // And then the queued message, behind it.
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/turnStarted' && e.action.queuedMessageId === 'q2')).toBe(true);
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
});
