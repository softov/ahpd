import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { Policy } from '@cofold/agents';
import { createHost } from '../packages/sdk/src/host.js';
import { describePlugin, loadPlugins } from '../packages/server/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { HostTool } from '../packages/sdk/src/types/host.js';
import type { PluginSpec } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The package as a plugin: the manifest, the loader and a served turn.
 *
 * Every case here goes through the real loader and the real host. The model is
 * a script and the store is in memory or under a temporary directory, because
 * a test calls no endpoint; what is under test is that the manifest resolves
 * the module, that `apply` contributes provider `cofold` from its own options,
 * that a turn is served exactly as a literal backend's is, and that a resumed
 * paused run reaches a subscribing client once.
 *
 * The source file is named rather than the package directory on purpose:
 * `pnpm test` does not build, and the loader applies a manifest's `ahpd.entry`
 * only when the package was resolved, so a file spec loads the file it names
 * rather than the `dist` build beside it.
 */

const REPO = join(import.meta.dirname, '..');
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

const initialize = async (client: ReturnType<ReturnType<typeof createHost>['accept']>) => await client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
}) as { snapshots: { state: { agents: { provider: string }[] } }[] };

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
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

it('loads the package from its source file and serves a turn through the stub model', async () => {
  const model = createFakeModel({ script: [{ text: 'answered by the plugin' }], stream: true });
  const { options, loaded, problems } = await load([
    { name: SOURCE, options: { adapter: model, memory: true } },
  ]);

  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.name).toBe('@ahpd/agent-cofold');
  // The module exports no title, so this is the manifest's `ahpd.title`.
  expect(loaded[0]?.title).toBe('Cofold');

  const host = createHost(options);
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

it('lists the package manifest, and its title, without importing the entry', async () => {
  const row = await describePlugin('./packages/agent-cofold', { configDir: REPO, cwd: REPO });

  expect(row.state).toBe('ready');
  expect(row.name).toBe('@ahpd/agent-cofold');
  expect(row.title).toBe('Cofold');
});

it('contributes two backends for two specs that name different providers', async () => {
  const a = createFakeModel({ script: [{ text: 'answered by a' }], stream: true });
  const b = createFakeModel({ script: [{ text: 'answered by b' }], stream: true });
  const { options, loaded, problems } = await load([
    { name: SOURCE, options: { provider: 'cofold-a', displayName: 'Cofold A', adapter: a, memory: true } },
    { name: SOURCE, options: { provider: 'cofold-b', displayName: 'Cofold B', adapter: b, memory: true } },
  ]);

  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(2);
  expect(loaded.map((one) => one.name)).toEqual(['@ahpd/agent-cofold', '@ahpd/agent-cofold']);

  const host = createHost(options);
  const p = peer();
  const client = host.accept(p);
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'cofold-a', 'cofold-b']);

  const first = await open(client, 'cofold-a', 'a');
  const second = await open(client, 'cofold-b', 'b');
  begin(client, first.chatUri, 't1', 'say a');
  await until(() => ended(p, first.chatUri));
  begin(client, second.chatUri, 't1', 'say b');
  await until(() => ended(p, second.chatUri));

  const answered = async (chatUri: string): Promise<string | undefined> => {
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
    };
    return opened.snapshot.state.turns[0]?.responseParts[0]?.content;
  };
  expect(await answered(first.chatUri)).toBe('answered by a');
  expect(await answered(second.chatUri)).toBe('answered by b');
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
    ahpd: { entry: './index.js', title: 'Cofold' },
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
  const before = createHost(first.options);
  const clientA = before.accept(peer());
  await initialize(clientA);
  const opened = await open(clientA, 'cofold', 'one');
  begin(clientA, opened.chatUri, 't1', 'hi');
  await pausedRun(root, 'one');
  /*
   * The first host is abandoned rather than closed: `close()` denies the open
   * request, and the point is a process that went away leaving the run
   * `awaiting`, which is the restart the second host below continues.
   */

  // The second process, over the same store, resumes the run when a client
  // says something on the session the catalogue listed.
  const second = await load([{ name: SOURCE, options: {
    adapter: createFakeModel({ script: [{ text: 'done' }], stream: true }), store: root, policy: asks,
  } }], { path: where, tools: [writer] });
  const after = createHost(second.options);
  const p = peer();
  const client = after.accept(p);
  await initialize(client);
  /*
   * A listed session is published under `<provider>:/<id>`, not under the
   * `ahp-session:` URI the first process created it with: the catalogue names
   * a row after the provider that owns it, and that is the channel a client
   * browses and continues it on.
   */
  const session = await client.handle({ method: 'subscribe', params: { channel: 'cofold:/one' } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = session.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  begin(client, chatUri, 't2', 'carry on');
  await until(() => actions(p, 'cofold:/one').some((e) => e.action.type === 'session/inputNeededSet'));

  /*
   * A client that arrives after the resume reads the chat snapshot the way a
   * subscription does. The open turn must appear once: as the active turn the
   * replay rebuilt, and not again in the history the host seeded from
   * `transcript(id)`.
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
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
});
