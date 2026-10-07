import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checker, collapse, framesIn, metaKeys, stale } from '../../../tools/wire.mjs';
import { lineFor } from '../../server/src/wire.js';
import { daemonRootConfig } from '../../server/src/rootconfig.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { optionsFrom } from '../../server/src/commands/options.js';
import { resultFrame } from '../src/rpc.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';
import type { PluginSpec } from '../src/types/plugin.js';

/*
 * Everything this host sends, against everything the protocol declares.
 *
 * The rest of the suite checks what the host does and `conformance.test.ts`
 * checks that the protocol's own reducers can read it. Neither can see an
 * *undeclared* field: a reducer ignores what it does not know, and a snapshot
 * this host wrote and read back agrees with itself whatever is in it.
 *
 * TypeScript cannot see one either. A conditional spread - `...(x ? { model }
 * : {})` - is not excess-property-checked, which is how `SessionState.model`,
 * `argumentHint` and `scope` each reached the wire from a codebase typed
 * against the package. So this is the only check that closes the objects:
 * `tools/schema.mjs` generates a strict schema out of the package's own
 * declarations - `additionalProperties: false` everywhere, which the shipped
 * `state.schema.json` has nowhere - and every frame goes through it.
 *
 * The capture is written out as it goes, which is the conformance fixture:
 * one file holding what a client actually receives, checkable by hand with
 * `npm run wire -- packages/sdk/test/fixtures/wire.jsonl` and diffable when something
 * moves. It is an *output* and never an input - the assertion below runs on
 * the frames this run just produced, not on the file - because a suite that
 * validated its own committed recording would go green against a record of
 * the bugs rather than against the code that fixed them. It is synthetic on purpose - the agent is mocked, the prompts are
 * `hello` - because a capture off a real daemon carries somebody's work.
 */

const sdk = vi.hoisted(() => {
  interface Fake {
    frames: Record<string, unknown>[];
    wake: (() => void) | undefined;
    closed: boolean;
    options: Record<string, unknown>;
  }
  return {
    canUseTool: undefined as undefined | ((n: string, i: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
    queries: [] as Fake[],
  };
});

const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  listSessions: async () => [],
  getSessionMessages: async () => [],
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false, options };
    sdk.queries.push(fake);
    if (options.canUseTool) sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    void (async () => { for await (const _ of prompt) { /* drained */ } })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.frames.length > 0) yield fake.frames.shift() as Record<string, unknown>;
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      initializationResult: async () => ({
        commands: [{ name: 'review', description: 'Review the diff' }],
        outputStyles: ['default', 'concise'],
      }),
      mcpServerStatus: async () => [{ name: 'notes', status: 'connected' }],
      reloadSkills: async () => ({ skills: [{ name: 'writing', description: 'How to write', argumentHint: 'What to write about' }] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [{ model: 'claude-opus-5', displayName: 'Opus 5' }],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');
const { claude } = await import('../../agent-claude/src/claude.js');
const { echo } = await import('../../../examples/echo/agent.js');
const { shellTerminals } = await import('../src/terminals.js');
const { fileResources } = await import('../src/resources.js');
const { memoryAutomations } = await import('../src/automations.js');
const { hostTools } = await import('../src/tools.js');

/** The team and project this capture's work is charged to. */
const research = { id: 'research', title: 'Research' };
const apollo = { id: 'apollo', title: 'Apollo' };

/*
 * A person this capture runs as, and one with work of her own.
 *
 * A host with no users directory has nobody to name, so every field a signed
 * in person adds to a frame stayed absent here - and a check that never sees
 * the field cannot catch it. The traffic below is a client on a host with a
 * directory, on a connection that is somebody: `ana` is granted everything,
 * so no frame is narrowed for want of a permission, her work is charged to a
 * team and a project, and she is the one who made the automation the capture
 * runs.
 */
const ana: Principal = {
  id: 'ana',
  roles: ['reviewer'],
  // Granted rather than listed. What is being captured is the shape of a
  // frame, and the shapes behind a permission this connection did not hold
  // would be shapes nothing here checks.
  can: () => true,
  memberships: [`${research.id}:${apollo.id}`, research.id],
  primary: `${research.id}:${apollo.id}`,
  teams: [research],
  projects: [apollo],
};

const people = (): Users => ({
  resource: {
    resource: 'ahpd://users',
    resource_name: 'ahpd users',
    authorization_servers: ['https://example.test/users'],
    required: false,
  },
  verify: async () => ana,
  list: async () => [{
    id: ana.id,
    roles: [...ana.roles],
    grants: ['session:create', 'config:read', 'config:settings'],
    trusted: false,
    memberships: [`${research.id}:${apollo.id}`],
    primary: `${research.id}:${apollo.id}`,
  }],
  grantsOfRoles: async () => ['session:create', 'config:read'],
  grantsOfPerson: async () => ['session:create', 'config:read', 'config:settings'],
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [research],
  projects: async () => [apollo],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Every frame this host put on the wire, in order. */
const wire: Record<string, unknown>[] = [];

function peer(): Peer {
  return {
    send: () => {},
    // A notification is a frame as it goes: method and params, which is what
    // a recorder on the socket would have written down.
    notify: (method, params) => { wire.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/** Every request this host refused, by method, so a refusal is not silent. */
const refused: string[] = [];

/**
 * One request, recorded as the exchange it was: what was asked, with what, and
 * what came back.
 *
 * The answer goes through `resultFrame`, the same function `rpc.ts` builds the
 * response frame with, so what is recorded is what the socket carries and not
 * what the handler happened to return - `undefined` and the `{}` a client
 * reads are two different things, and a check of the first proves nothing
 * about the second.
 *
 * A refusal is recorded too. It carries no result, and its params are still
 * the request's, so it is checked for those; and a request that starts
 * answering something other than what it did here is a change the departures
 * list is asked about below.
 */
const asking = (client: { handle(r: { method: string; params: unknown }): Promise<unknown> }) =>
  async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    try {
      const result = await client.handle({ method, params });
      wire.push({ asked: method, params, result: resultFrame(result) });
      return result;
    } catch (error) {
      refused.push(method);
      wire.push({ asked: method, params, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  };

/** Say what a session's own CLI said. */
async function said(...frames: Record<string, unknown>[]): Promise<void> {
  const fake = sessionQueries().at(-1);
  if (!fake) throw new Error('no session CLI is running');
  fake.frames.push(...frames);
  fake.wake?.();
  fake.wake = undefined;
  await settle();
}

/*
 * Every `_meta` key this host may write, and where.
 *
 * `_meta` is the protocol's one open bag: no declaration names a key in it, and
 * a closed-object schema has no opinion about what is in it - so it is exactly
 * where a host invents a name no client has heard of, and the half of
 * "everything this host sends" that the schema above cannot reach.
 *
 * A key is judged with the place it was found and not on its own. `command` is
 * the reference client's on a completion item and an invention anywhere else,
 * so a census of bare names could only allow a name everywhere.
 */

/** The key spaces a client reads by convention rather than by declaration. */
const PREFIXED = ['ahpd.', 'vscode.', 'anthropic/', 'agentHost/'];

/**
 * The reference client's own keys, each at the place it reads it.
 *
 * `at` matches the end of the folded path, which is how one entry covers a key
 * on an action and the same key on that action echoed in a result.
 */
const REFERENCE: { key: string; at: string; from: string }[] = [
  // What the reference client picks a row's renderer by. A call it has no kind
  // for carries no `_meta` at all rather than a guess.
  { key: 'toolKind', at: 'action/_meta', from: 'docs/AHP.md' },
  // A completion item has to say it is a command, or the reference client
  // drops it without a word, and `description` is the menu's second column.
  { key: 'command', at: 'attachment/_meta', from: 'docs/AHP.md' },
  { key: 'description', at: 'attachment/_meta', from: 'docs/AHP.md' },
];

/**
 * What this host writes under a name of its own, and the task that renames it.
 *
 * p4 empties this list. Until it does, this is the gap between the protocol's
 * vocabulary and this host's, written where the next key has to be added to
 * rather than left for a reader to find.
 */
const PENDING: { key: string; at: string; task: string }[] = [
  { key: 'owner', at: '/changes/_meta', task: 'p4 task 02' },
  { key: 'owner', at: '/summary/_meta', task: 'p4 task 02' },
  { key: 'owner', at: '/state/_meta', task: 'p4 task 02' },
  { key: 'sender', at: 'action/_meta', task: 'p4 task 02' },
  { key: 'model', at: '/changes/_meta', task: 'p4 task 03' },
  { key: 'model', at: '/state/_meta', task: 'p4 task 03' },
  // On a skill, where this host puts its own field: the reference reads
  // `argumentHint` on a completion item, which is allowed above.
  { key: 'argumentHint', at: 'customizations/N/children/N/_meta', task: 'p4 task 03' },
  { key: 'cacheWriteTokens', at: 'usage/_meta', task: 'p4 task 04' },
  { key: 'cost', at: 'usage/_meta', task: 'p4 task 04' },
];

/** A key at a place, as the census reports it. */
const where = (key: string, at: string): string => `${key} @ ${at}`;

/** Whether a key at a place is one this file has looked at and written down. */
const announced = (key: string, at: string): boolean =>
  PREFIXED.some((prefix) => key.startsWith(prefix))
  || REFERENCE.some((one) => one.key === key && at.endsWith(one.at))
  || PENDING.some((one) => one.key === key && at.endsWith(one.at));

/** The `_meta` keys in a frame that nothing here announces, as `key @ place`. */
const strayMeta = (frame: Record<string, unknown>): string[] =>
  metaKeys(frame).filter(({ key, at }) => !announced(key, at)).map(({ key, at }) => where(key, at));

it('sends nothing the protocol does not declare, and nothing short of what it requires', async () => {
  /*
   * A plugin the daemon's own root config carries options for.
   *
   * Its `optionsSchema` is a plugin's: a `writeOnly` string, an integer with a
   * `minimum`, and no titles anywhere. The daemon serves it as it stands beside
   * its own keys, so the root config schema a `config:read` connection reads is
   * the whole of what a client has to draw a form from.
   */
  const home = mkdtempSync(join(tmpdir(), 'ahpd-wire-'));
  const config = join(home, 'config.json');
  const spec: PluginSpec = {
    name: './fixtures/plugin-secret/index.ts',
    options: { apiKey: 'k-1', region: 'eu', retries: 2 },
  };
  writeFileSync(config, JSON.stringify({ plugins: [spec] }));
  const { problems } = await loadPlugins([spec], {
    base: { path: home, agents: [echo({ path: home, pace: 0 })] },
    configDir: home,
    cwd: join(import.meta.dirname, '../../server/test'),
    log: () => {},
  });
  expect(problems).toEqual([]);

  const automations = memoryAutomations();
  const host = createHost({
    path: '/home/softov',
    agents: [claude({ paths: ['/home/softov'] }), echo({ path: '/home/softov', pace: 0 })],
    resources: fileResources(),
    terminals: shellTerminals(),
    automations,
    tools: hostTools(),
    users: people(),
    rootConfig: daemonRootConfig(optionsFrom({ configFile: config })),
  });
  const client = host.accept(peer(), ana);
  const ask = asking(client);

  /*
   * Every action this client dispatches, numbered.
   *
   * `clientSeq` is required on one and is what a client uses to match its own
   * actions against the server sequence they landed at, so a capture that left
   * it off is a capture of a client the protocol does not describe.
   */
  let seq = 0;
  const dispatch = (channel: string, action: Record<string, unknown>): void => {
    seq += 1;
    void client.handle({ method: 'dispatchAction', params: { channel, clientSeq: seq, action } });
  };

  await ask('initialize', {
    channel: 'ahp-root://', clientId: 'wire', protocolVersions: ['1.0.0'], initialSubscriptions: ['ahp-root://'],
  });
  await ask('ping', { channel: 'ahp-root://' });
  await ask('resolveSessionConfig', { channel: 'ahp-root://', provider: 'claude' });
  await ask('listSessions', { channel: 'ahp-root://' });

  const uri = 'ahp-session:/wire';
  const chatUri = 'ahp-chat:/wire';
  await ask('createSession', { channel: uri, provider: 'claude' });
  await ask('subscribe', { channel: 'ahp-root://' });
  await ask('subscribe', { channel: uri });
  await ask('subscribe', { channel: chatUri });

  // A second session, on the other backend: the two are separately asked for
  // so the config schema is resolved for both, and their states differ in
  // which optional keys they carry.
  const echoUri = 'ahp-session:/wire-echo';
  await ask('createSession', { channel: echoUri, provider: 'echo' });
  await ask('subscribe', { channel: echoUri });
  await ask('resolveSessionConfig', { channel: 'ahp-root://', provider: 'echo' });
  await settle();

  // A whole turn: prose, a tool that ran, its result, and the usage that ends
  // it. Every action on the chat channel comes out of these frames.
  // The turn names the model it runs on, which is how a session comes to have
  // one at all: the protocol carries a model per message, not per session, so
  // what the session is on is an extension on its state.
  dispatch(chatUri, {
    type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello', model: { id: 'claude-opus-5' } },
  });
  await settle();
  await said(
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading' } } },
    {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc1', name: 'Read' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/home/softov/a"}' } },
    },
    {
      type: 'assistant',
      message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/home/softov/a' } }] },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'ok' }] } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 12,
      // Cache writes and a price are both the SDK's, and neither is a field
      // the protocol declares: they ride the usage's own `_meta`, which is the
      // half of this capture that the census below is about.
      usage: { input_tokens: 10, output_tokens: 4, cache_creation_input_tokens: 900 },
      modelUsage: { 'claude-opus-5': { costUSD: 0.25, costBasis: 'exact' } },
    },
  );

  // The rest of the session channel: a title, the flags a client keeps, a
  // config value, and a client saying it is watching.
  for (const action of [
    { type: 'session/isReadChanged', isRead: true },
    { type: 'session/isArchivedChanged', isArchived: false },
    { type: 'session/titleChanged', title: 'A wire capture' },
    { type: 'session/configChanged', config: { permissionMode: 'plan' } },
    { type: 'session/activeClientSet', activeClient: { clientId: 'wire', displayName: 'The wire capture', tools: [] } },
  ]) dispatch(uri, action);
  for (const action of [
    { type: 'chat/draftChanged', draft: { text: 'half a thought', origin: { kind: 'user' } } },
    { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'and then this', origin: { kind: 'user' } } },
  ]) dispatch(chatUri, action);
  await settle();

  // Asked for again, so the answer is the state a client connecting late
  // reads: the turn that just ended, and the model the session is on - which
  // is under `_meta`, and only on the state, never on an action.
  await ask('subscribe', { channel: uri });

  await ask('subscribe', { channel: `${uri}/annotations` });
  dispatch(`${uri}/annotations`, {
    type: 'annotations/set',
    annotation: {
      id: 'a1',
      origin: { session: uri, chat: chatUri },
      resource: 'file:///home/softov/a',
      resolved: false,
      entries: [],
    },
  });
  await settle();

  // A second chat, which is the other half of the session channel.
  const chatTwo = 'ahp-chat:/wire-2';
  await ask('createChat', { channel: uri, chat: chatTwo });
  await ask('subscribe', { channel: chatTwo });
  // The cursor is after the slash, which is what makes it a slash command
  // being typed rather than a path: a host asked with the offset before it
  // answers an empty list, and the items' own `_meta` is what the reference
  // client draws a command or a skill from.
  await ask('completions', { kind: 'userMessage', channel: chatUri, text: '/', offset: 1 });
  await ask('sessionConfigCompletions', { channel: 'ahp-root://', provider: 'claude', property: 'branch', query: '' });
  await ask('disposeChat', { channel: chatTwo });

  // A terminal, from the bytes a shell writes: claimed by this client rather
  // than attached to a session, and started with no command of its own.
  const terminal = 'ahp-terminal:/wire';
  await ask('createTerminal', {
    channel: terminal, claim: { kind: 'client', clientId: 'wire' }, cwd: 'file:///home/softov',
  });
  await ask('subscribe', { channel: terminal });
  dispatch(terminal, { type: 'terminal/resized', cols: 100, rows: 30 });
  await settle(20);
  await ask('disposeTerminal', { channel: terminal });

  // A turn that stops to ask, which is the one action the protocol has for a
  // question a person has to answer before the agent can go on.
  sdk.canUseTool?.('AskUserQuestion', {
    header: 'Which folder?',
    questions: [{ question: 'Which folder?', options: [{ label: 'a' }, { label: 'b' }] }],
  }, { toolUseID: 'q1' });
  await settle();

  // An automation, its run, and the run's own channel. Made by the person on
  // the connection, so every frame that names an author names her.
  const nightly = 'ahp-automation:/nightly';
  dispatch('ahp-automations://', {
    type: 'automation/createRequested',
    resource: nightly,
    definition: {
      title: 'Nightly review',
      enabled: true,
      message: { text: 'review what changed', origin: { kind: 'automation' } },
      session: { provider: 'echo', workingDirectories: ['file:///home/softov'] },
      triggers: [],
    },
  });
  await settle();

  /*
   * And more history than a page, so the cursor has somewhere to go.
   *
   * Straight into the store, and before anything subscribes to the catalogue:
   * a run made through `runAutomation` is a session, and nineteen more
   * sessions is a capture of nineteen identical sessions with the one frame
   * that matters buried in it. Nothing is watching yet, so the store's own
   * announcements reach nobody - what the capture keeps is the entry holding
   * them.
   */
  for (let i = 0; i < 19; i++) {
    await automations.run(nightly, { kind: 'manual' }, async () => `ahp-session:/seeded-${String(i)}`);
  }
  await settle();

  await ask('subscribe', { channel: 'ahp-automations://' });
  await ask('listAutomationTriggerDefinitions', { channel: 'ahp-root://' });
  const run = await ask('runAutomation', {
    channel: 'ahp-automations://', automation: nightly, requestId: 'r1',
  }) as { resource: string };
  await settle();
  await ask('subscribe', { channel: run.resource });
  await ask('runAutomation', { channel: 'ahp-automations://', automation: nightly, requestId: 'r2' });
  await settle();

  /*
   * The second page, asked for with the cursor the entry carries.
   *
   * `fetchAutomationRuns` answers `{}`: the protocol's result for it is empty,
   * and the page itself is the automation's entry, which every subscriber of
   * the catalogue reads off the `automation/set` the store dispatched as it
   * grew - so the action is on the wire before this answer is.
   */
  await ask('fetchAutomationRuns', { channel: 'ahp-automations://', automation: nightly, cursor: '20' });
  const fetched = wire.findIndex((one) => one.asked === 'fetchAutomationRuns');
  expect(wire[fetched]).toEqual({
    asked: 'fetchAutomationRuns',
    params: { channel: 'ahp-automations://', automation: nightly, cursor: '20' },
    result: {},
  });
  const arrival = wire[fetched - 1] as { params: { action: { type: string; automation: Record<string, unknown> } } };
  expect(arrival.params.action.type).toBe('automation/set');
  // Twenty-one runs, which is more than a page, and no cursor left because
  // the history is exhausted.
  expect(arrival.params.action.automation.runs).toHaveLength(21);
  expect(arrival.params.action.automation.runsNextCursor).toBeUndefined();

  // And a reconnect, which is the one answer carrying several snapshots.
  await ask('reconnect', {
    channel: 'ahp-root://', clientId: 'wire', subscriptions: ['ahp-root://', uri, chatUri], lastSeenServerSeq: 0,
  });

  /*
   * The requests this host serves that the protocol's own maps do not name.
   *
   * The reference window's own set, kept so a VS Code client can talk to this
   * daemon as it talks to that host, and named in `docs/AHP.md` so the list is
   * a decision rather than an oversight. Two of them are answered here, which
   * is what makes them departures rather than gaps.
   */
  await ask('getManagedSettingsDiagnostics', {});
  await ask('getNetworkDiagnosticsInfo', {});
  await ask('vscode/reconcileAgentHostDetachedWorktrees', {
    scope: 'file:///home/softov', activeHandles: [],
  });

  /*
   * And the one departure that is refused rather than answered.
   *
   * `shutdown` stops the daemon, and this host was built with no way to stop,
   * so it answers `-32601`. Which makes it the only frame in the capture that
   * is not an answer, and the only exercise the recorder's refusal branch
   * gets - a branch nothing goes down is a branch that does not hold.
   */
  await ask('shutdown', {});

  await ask('disposeSession', { channel: uri });
  await ask('disposeSession', { channel: echoUri });
  await settle();
  rmSync(home, { recursive: true, force: true });

  /*
   * The fixture, with the parts that move on every run taken out.
   *
   * A capture whose timestamps and generated ids change each time is one
   * nobody can diff, and the reason to keep it is to see what moved when
   * something changes. So the volatile values are replaced by stable ones -
   * the shapes are what this file is for, and a UUID is the same shape
   * whichever UUID it is.
   */
  let minted = 0;
  let turns = 0;
  const names = new Map<string, string>();
  const steady = (text: string): string => text
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '2020-01-01T00:00:00.000Z')
    .replace(/"ahpd\.durationMs":\d+/g, '"ahpd.durationMs":0')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (found) => {
      if (!names.has(found)) names.set(found, `00000000-0000-4000-8000-${String(minted++).padStart(12, '0')}`);
      return names.get(found) as string;
    })
    /*
     * And the id a backend mints from the clock when an agent speaks first,
     * which is `turn-${Date.now()}`. A generated id is mapped rather than
     * blanked, so two turns in one capture stay two; the numbers are their
     * own, so a turn appearing does not renumber the ids above.
     */
    .replace(/\bturn-\d{10,}\b/g, (found) => {
      if (!names.has(found)) names.set(found, `turn-${turns++}`);
      return names.get(found) as string;
    });
  mkdirSync('packages/sdk/test/fixtures', { recursive: true });
  writeFileSync('packages/sdk/test/fixtures/wire.jsonl', `${wire.map((one) => steady(JSON.stringify(one))).join('\n')}\n`);

  /*
   * Generated rather than committed, so it cannot drift from the package.
   *
   * `npm test` runs `tools/schema.mjs` first; this is for a bare `vitest run`,
   * which is how the suite is usually driven while working. `stale()` is what
   * makes the second run honest: the file left on disk by the last package
   * bump still validates frames, just against the protocol before, and a
   * check that passes for the wrong reason is not a check.
   */
  if (stale()) execFileSync(process.execPath, ['tools/schema.mjs'], { stdio: 'inherit' });
  const check = checker();
  const defects = wire.flatMap((frame) => check.frame(frame));

  /*
   * What this capture still gets wrong, each line with the plan that pays it
   * off.
   *
   * Not a list of things that are fine: every key here is a frame a strict
   * reader of the protocol refuses today. Writing them down is what turns the
   * check into a contract - the day the named plan lands, the line comes out,
   * and a fix that lands without its line coming out is a fix that did not
   * change the wire.
   */
  /*
   * Where a plugin's options sit in the root config schema. The daemon picks
   * the key as `plugins.<module as it was named>`, so the path below carries
   * the module path this test loaded the plugin from.
   */
  const secret = 'plugins..~1fixtures~1plugin-secret~1index.ts';
  const KNOWN: string[] = [
    /*
     * p3: the daemon's own keys in the root config schema are JSON Schema
     * fragments, and a client reads `ConfigPropertySchema`. Every one of them
     * wants a `title`, the two numeric bounds and the regex are keys the
     * declaration does not have, and four `type`s are arrays where it allows
     * one string.
     */
    'RootState /config/schema/properties/paths missing required `title`', // p3
    'RootState /config/schema/properties/paths/items missing required `title`', // p3
    'RootState /config/schema/properties/port missing required `title`', // p3
    'RootState /config/schema/properties/port/type enum must be equal to one of the allowed values', // p3
    'RootState /config/schema/properties/host missing required `title`', // p3
    'RootState /config/schema/properties/http missing required `title`', // p3
    'RootState /config/schema/properties/http/type enum must be equal to one of the allowed values', // p3
    'RootState /config/schema/properties/http/properties/host missing required `title`', // p3
    'RootState /config/schema/properties/http/properties/host undeclared key `pattern`', // p3
    'RootState /config/schema/properties/http/properties/port missing required `title`', // p3
    'RootState /config/schema/properties/http/properties/port undeclared key `minimum`', // p3
    'RootState /config/schema/properties/http/properties/port undeclared key `maximum`', // p3
    'RootState /config/schema/properties/http/properties/port/type enum must be equal to one of the allowed values', // p3
    'RootState /config/schema/properties/updateCheck missing required `title`', // p3
    'RootState /config/schema/properties/advancedTools missing required `title`', // p3
    'RootState /config/schema/properties/wire missing required `title`', // p3
    'RootState /config/schema/properties/mcpServers missing required `title`', // p3
    /*
     * p3: and a plugin's `optionsSchema` goes on the wire as the plugin wrote
     * it, beside the daemon's. `writeOnly` and `minimum` are the two keys the
     * declaration does not have, and the missing titles are the plugin's.
     */
    `RootState /config/schema/properties/${secret}/properties/options missing required \`title\``, // p3
    `RootState /config/schema/properties/${secret}/properties/options/properties/apiKey missing required \`title\``, // p3
    `RootState /config/schema/properties/${secret}/properties/options/properties/apiKey undeclared key \`writeOnly\``, // p3
    `RootState /config/schema/properties/${secret}/properties/options/properties/region missing required \`title\``, // p3
    `RootState /config/schema/properties/${secret}/properties/options/properties/retries missing required \`title\``, // p3
    `RootState /config/schema/properties/${secret}/properties/options/properties/retries undeclared key \`minimum\``, // p3
    `RootState /config/schema/properties/${secret}/properties/options/properties/retries/type enum must be equal to one of the allowed values`, // p3
  ];

  /*
   * Everything this host serves that no map in the package names, keyed by
   * the method `skipped()` reports it under, plus the one value it sends that
   * no declaration allows.
   *
   * A method in no map is either a departure somebody decided on or a hole in
   * the checker, and the only thing that tells them apart is being written
   * down. Each names the heading in `docs/AHP.md` that records the decision,
   * and the assertion below reads the section back - so this list and the
   * section a person reads are the same set, or the suite says which moved.
   */
  const DEPARTURES: Record<string, string> = {
    activity: 'Server notifications',
    shutdown: 'What the window asks a host about itself',
    getNetworkDiagnosticsInfo: 'What the window asks a host about itself',
    getManagedSettingsDiagnostics: 'What the window asks a host about itself',
    diagnosticsFetch: 'What the window asks a host about itself',
    'vscode/createAgentHostDetachedWorktree': 'Worktrees the window manages',
    'vscode/claimAgentHostDetachedWorktree': 'Worktrees the window manages',
    'vscode/setAgentHostDetachedWorktreeArchived': 'Worktrees the window manages',
    'vscode/deleteAgentHostDetachedWorktree': 'Worktrees the window manages',
    'vscode/reconcileAgentHostDetachedWorktrees': 'Worktrees the window manages',
    'vscode/removeSessionArtifact': 'Sessions and the catalogue',
    'vscode/getAgentHostSessionStateFile': 'What the window asks a host about itself',
    'vscode/collectAgentHostDebugLogs': 'What the window asks a host about itself',
    'vscode/readAgentHostDebugLogsChunk': 'What the window asks a host about itself',
    'vscode/devContainers/isDockerAvailable': 'CONTAINERS.md',
    'vscode/devContainers/connect': 'CONTAINERS.md',
    'vscode/devContainers/disconnect': 'CONTAINERS.md',
    'vscode/devContainers/relaySend': 'CONTAINERS.md',
    'vscode/devContainers/relayMessage': 'CONTAINERS.md',
    'vscode/devContainers/output': 'CONTAINERS.md',
    'vscode/devContainers/relayClose': 'CONTAINERS.md',
    'vscode/devContainers/closeConnection': 'CONTAINERS.md',
  };

  /*
   * The same list, read off the document.
   *
   * The section is the one headed "What is served outside the protocol", and
   * a departure is a row whose first cell is a code span. `activity: null` is
   * written with the value it carries, so the name is what stands before the
   * colon.
   */
  const documented = (): string[] => {
    const text = readFileSync(new URL('../../../docs/AHP.md', import.meta.url), 'utf8');
    const start = text.indexOf('\n### What is served outside the protocol');
    if (start < 0) throw new Error('docs/AHP.md has no section naming what is served outside the protocol');
    const end = text.indexOf('\n### ', start + 1);
    return text.slice(start, end < 0 ? undefined : end)
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => (line.split('|')[1] ?? '').replace(/`/g, '').trim().split(':')[0]!.trim());
  };

  /*
   * The one declaration this host widens on purpose, keyed by the finding.
   *
   * A partial is spread over the row a client holds, so a key left off is a
   * field that did not move and an idled row would keep saying what its last
   * tool was doing. The reference host sends `null` for that and its client
   * reads it as cleared, so this one does too.
   */
  const WIDENED: Record<string, string> = {
    'SessionSummaryChangedParams /changes/activity type must be string': 'Server notifications',
  };

  /*
   * Both directions matter: an undeclared key is this host inventing something
   * a client cannot read, and a missing required one is this host not keeping
   * its own promise. The same capture shows both, and every one of them is
   * either a defect with a plan or a departure with a reason.
   */
  const found = collapse(defects).map(([key]) => key).sort();
  expect(found).toEqual([...KNOWN, ...Object.keys(WIDENED)].sort());

  // One way round, because the capture asks a few of these and never the
  // rest: a method outside every map that the capture sent and nobody named
  // is a frame a strict reader refuses and a person cannot look up.
  expect([...check.skipped().keys()].filter((method) => !(method in DEPARTURES))).toEqual([]);

  // And the other way, against the document rather than the traffic. Exact,
  // so an entry here that nobody wrote down and a row written down that this
  // file does not hold are the same failure.
  expect(documented()).toEqual(Object.keys(DEPARTURES));

  // And exactly one request in the capture is refused, which is the departure
  // that refuses by design. Anything else here is a request that stopped
  // working, recorded as an error frame rather than as an answer.
  expect(refused).toEqual(['shutdown']);

  /*
   * The other half of everything this host sends: the names it invents.
   *
   * The schema closes every object it declares and the one object it does not
   * is `_meta`, so a key this host makes up reaches a client unnoticed by every
   * check above. What is left is to name each one, where it is written and
   * whether the protocol or this host owns it.
   */
  const census = wire.flatMap((frame) => metaKeys(frame));
  const stray = wire.flatMap((frame) => strayMeta(frame));
  expect([...new Set(stray)].sort()).toEqual([]);

  // Both ways round here too: a listed key the traffic stopped sending is a
  // line that would otherwise sit here for ever, naming a rename of something
  // nothing writes.
  const missing = [...REFERENCE, ...PENDING].filter((one) =>
    !census.some(({ key, at }) => key === one.key && at.endsWith(one.at)));
  expect(missing.map((one) => where(one.key, one.at))).toEqual([]);

  /*
   * And enough of it reached a declaration to mean anything.
   *
   * A capture nothing recognised would pass this test saying nothing, which is
   * the failure mode of a check whose subject is a list of things that could
   * not be checked. 233 payloads go through a declaration today, against the
   * 60 this file checked before the traffic above was widened; the floor is
   * there to catch the capture quietly narrowing again, not to pin the count.
   */
  expect(check.checked()).toBeGreaterThan(200);
});

describe('the `_meta` census', () => {
  const onItem = (meta: Record<string, unknown>): Record<string, unknown> => ({
    asked: 'completions',
    params: { channel: 'ahp-chat:/a', kind: 'userMessage', text: '/', offset: 1 },
    result: { items: [{ insertText: '/compact', attachment: { type: 'simple', label: '/compact', _meta: meta } }] },
  });
  const onSkill = (meta: Record<string, unknown>): Record<string, unknown> => ({
    method: 'session/chatUpdated',
    params: {
      channel: 'ahp-session:/a',
      changes: { customizations: [{ type: 'plugin', children: [{ type: 'skill', name: 'writing', _meta: meta }] }] },
    },
  });

  it('judges a key with the place it was found, and not on its own', () => {
    // The reference client's own bag, on the item it reads it from.
    expect(strayMeta(onItem({ command: 'compact', description: 'Compact the conversation' }))).toEqual([]);
    /*
     * The same two names on a skill's customization, where the reference reads
     * neither: `command` there is a host saying "this is a slash command" about
     * something that is not one, and a client drawing it as one is the defect
     * this whole file exists to catch.
     */
    expect(strayMeta(onSkill({ command: 'compact' })))
      .toEqual(['command @ /params/changes/customizations/N/children/N/_meta']);
  });

  it('names a key nothing here has written down', () => {
    expect(strayMeta({ method: 'action', params: { action: { type: 'chat/delta', _meta: { invented: 1 } } } }))
      .toEqual(['invented @ /params/action/_meta']);
  });

  it('takes ahpd\'s own key space without an entry per key', () => {
    expect(strayMeta({ method: 'action', params: { action: { type: 'chat/delta', _meta: { 'ahpd.something': 1 } } } })).toEqual([]);
  });
});

/*
 * What `--wire` writes down, and what reads it back.
 *
 * The line is VS Code's: the message at the root and `_ahpLog` beside it, so
 * whatever opens a capture taken off an agent host opens this one too. The
 * reader has to keep up - `pnpm wire` takes both shapes, because a capture
 * taken before the change is still a capture somebody has to check.
 */
describe('the strict schema', () => {
  it('is stale the moment the package it was built from is not the one installed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahp-strict-'));
    const at = join(dir, 'schema.json');
    // Built from the package that is installed, so this is the one file that
    // is not stale.
    execFileSync(process.execPath, ['tools/schema.mjs', '--out', at], { stdio: 'inherit' });
    expect(stale(at)).toBe(false);

    // A file nobody wrote: there is nothing to check frames against.
    expect(stale(join(dir, 'never-written.json'))).toBe(true);

    // One left over a package bump. It still validates every frame, which is
    // what the old missing-only guard let through - a check against the
    // protocol before, passing for reasons that have nothing to do with drift.
    const built = JSON.parse(readFileSync(at, 'utf8'));
    built.ahpVersion = '0.0.1';
    writeFileSync(at, JSON.stringify(built));
    expect(stale(at)).toBe(true);

    // And one that is not a schema at all rather than an old one.
    writeFileSync(at, 'not json');
    expect(stale(at)).toBe(true);
  });
});

/*
 * The schema's own output, where the audit found it wrong.
 *
 * A `Partial<T>` is a second shape rather than a second name for the first: the
 * root channel's session summary and a chat's summary share four field names
 * and nothing else, and reading one as the other passes exactly the fields they
 * do share. And `SessionStatus` is a set of flags rather than a list of names -
 * a client sends `Idle | IsRead` and means both - so an enum of the members
 * alone reports a status the type has as one it does not.
 */
describe('the generated schema', () => {
  const check = checker();

  /** Where a finding is and what it is, so the path is part of the assertion. */
  const at = (found: { at: string; what: string }[]): string[] => found.map((one) => `${one.at} ${one.what}`);

  /** What the root channel says moved about a session. */
  const changed = (changes: unknown) => check.frame({
    method: 'root/sessionSummaryChanged',
    params: { channel: 'ahp-root://', session: 'ahp-session:/wire', changes },
  });

  /** A chat's own fields, changed on the session that holds it. */
  const chatChanged = (changes: unknown) => check.frame({
    method: 'action',
    params: {
      channel: 'ahp-session:/wire',
      serverSeq: 1,
      action: { type: 'session/chatUpdated', chat: 'ahp-chat:/wire', changes },
    },
  });

  /** A session's state, with one field under test. */
  const sessionWith = (status: unknown) => check.frame({
    result: {
      snapshot: {
        resource: 'ahp-session:/wire',
        fromSeq: 1,
        state: {
          lifecycle: 'ready', activeClients: [], chats: [], provider: 'claude', title: 'A wire capture', status,
        },
      },
    },
  });

  it('checks a partial session summary as a session, not as whichever Partial it emitted first', () => {
    // `project` and `_meta` are the session's own, and a chat has neither.
    expect(at(changed({ project: { uri: 'file:///home/softov', displayName: 'softov' }, _meta: { 'ahpd.x': 1 } }))).toEqual([]);
    // A key neither of them has is still a finding, so the line above is not
    // passing because nothing is being checked.
    expect(at(changed({ invented: 1 }))).toEqual(['/changes undeclared key `invented`']);
  });

  it('checks a partial chat summary as a chat', () => {
    // `interactivity` and `movable` are the chat's, and a session has neither.
    expect(at(chatChanged({ interactivity: 'full', movable: true }))).toEqual([]);
    expect(at(chatChanged({ status: 33 }))).toEqual([]);
    // Twice, and both are right: the envelope's union refuses the action and
    // the action's own declaration refuses the field. The first is where it
    // stands on the wire, the second is what it is.
    expect(at(chatChanged({ project: { uri: 'file:///home/softov', displayName: 'softov' } })))
      .toEqual(['/action/changes undeclared key `project`', '/changes undeclared key `project`']);
  });

  it('checks a status as any set of its flags, and nothing else', () => {
    // 33 is `Idle | IsRead`, which no member names and a client sends anyway.
    expect(at(sessionWith(33))).toEqual([]);
    // 4 is a bit no member of this one sets, so it is not a status at all.
    expect(at(sessionWith(4))).toEqual(['/status enum must be equal to one of the allowed values']);
  });

  it('checks the chats inside a partial session summary the same way', () => {
    const chats = (one: Record<string, unknown>): string[] => at(changed({
      chats: [{ resource: 'ahp-chat:/wire', title: 'A wire capture', ...one }],
      defaultChat: 'ahp-chat:/wire',
    }));
    expect(chats({ status: 33 })).toEqual([]);
    expect(chats({ status: 4 })).toEqual(['/changes/chats/N/status enum must be equal to one of the allowed values']);
    expect(chats({ status: 33, invented: 1 })).toEqual(['/changes/chats/N undeclared key `invented`']);
  });
});

/*
 * Requests and answers, routed the way the protocol routes them.
 *
 * `CommandMap` and `ServerNotificationMap` are the protocol's own index of what
 * each method carries, so a method's declaration can be read off the method
 * rather than guessed from the shape of the frame. Everything here is what the
 * recorder below writes down.
 */
describe('the protocol’s maps', () => {
  const check = checker();
  const asks = (frame: Record<string, unknown>): string[] => check.frame(frame).map((one) => one.what);

  it('checks a result against the declaration its method names, a declared null included', () => {
    // `ping` answers `null`, which is a value and not an absent one: a host that
    // puts `{}` there has answered something the protocol does not declare.
    expect(asks({ asked: 'ping', params: { channel: 'ahp-root://' }, result: {} })).toEqual(['type must be null']);
    expect(asks({ asked: 'ping', params: { channel: 'ahp-root://' }, result: null })).toEqual([]);
  });

  it('checks a request against the declaration its method names', () => {
    // `kind` has no default and the offset's name is the protocol's, not the
    // SDK's.
    expect(asks({ asked: 'completions', params: { channel: 'ahp-chat:/wire', text: '/', position: 1 } }))
      .toEqual(['missing required `kind`', 'missing required `offset`', 'undeclared key `position`']);
    expect(asks({ asked: 'completions', params: { kind: 'userMessage', channel: 'ahp-chat:/wire', text: '/', offset: 0 } }))
      .toEqual([]);
  });

  it('routes a notification to its params declaration', () => {
    const clean = {
      method: 'root/sessionSummaryChanged',
      params: { channel: 'ahp-root://', session: 'ahp-session:/wire', changes: { title: 'A wire capture' } },
    };
    expect(asks(clean)).toEqual([]);
    expect(check.frame({ ...clean, params: { ...clean.params, invented: 1 } }).map((one) => one.def))
      .toEqual(['SessionSummaryChangedParams']);
  });

  it('counts a method in neither map under its name', () => {
    expect(asks({ asked: 'shutdown' })).toEqual([]);
    expect([...check.skipped().keys()]).toEqual(['shutdown']);
  });
});

describe('a capture line', () => {
  /** The meta a line carries, with the two fields that move left steady. */
  const meta = { dir: 'c2s' as const, connectionId: '3', transport: 'websocket', byteLength: 0 };
  const line = (at: Record<string, unknown>): Record<string, unknown> => at._ahpLog as Record<string, unknown>;

  it('holds the message at the root, the way it went, and the connection it crossed', () => {
    const ask = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'authenticate', params: { token: 'sesame' } });
    const answer = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '0.9.0' } });
    const action = JSON.stringify({ jsonrpc: '2.0', method: 'action', params: { channel: 'ahp-root://', action: { type: 'root/agentsChanged', agents: [] } } });

    // Three frames, one exchange: what a client sent, what came back, and the
    // host pushing on its own.
    const [sent, answered, pushed] = [
      lineFor('client', ask, 3, 'websocket'),
      lineFor('host', answer, 3, 'websocket'),
      lineFor('host', action, 3, 'websocket'),
    ];

    expect([sent.method, answered.method, pushed.method]).toEqual(['authenticate', undefined, 'action']);
    // `frame` is gone: the message is the line, and nesting it is the one thing
    // that would stop a reader of VS Code's capture from finding it.
    expect([sent, answered, pushed].some((one) => 'frame' in one)).toBe(false);
    expect([sent, answered, pushed].map((one) => line(one).dir)).toEqual(['c2s', 's2c', 's2c']);
    for (const [at, text] of [[sent, ask], [answered, answer], [pushed, action]] as const) {
      expect(line(at).connectionId).toBe('3');
      expect(line(at).transport).toBe('websocket');
      // The frame as it went over, not the line it became.
      expect(line(at).byteLength).toBe(Buffer.byteLength(text, 'utf8'));
      expect(new Date(line(at).ts as string).toISOString()).toBe(line(at).ts);
    }
  });

  it('keeps a frame that is not a message whole, under _raw', () => {
    const text = 'not json at all';
    const captured = lineFor('client', text, 1, 'stdio');
    expect(captured._raw).toBe(text);
    expect(line(captured).transport).toBe('stdio');
    // A line has to stay a line of JSON, or the capture stops being one.
    expect(JSON.parse(JSON.stringify(captured))).toEqual(captured);
    // A JSON value that is not an object is no message either, and spreading
    // one would leave a line holding nothing but its own meta.
    for (const odd of ['[1,2]', '5', '"five"', 'null']) {
      expect(lineFor('host', odd, 1, 'websocket')._raw).toBe(odd);
    }
  });

  it('reads a capture of the old shape as well as the new one', () => {
    const message = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '0.9.0' } };
    const old = { at: '2020-01-01T00:00:00.000Z', from: 'host', peer: 3, frame: message };
    expect([...framesIn(`${JSON.stringify(old)}\n`)]).toEqual([message]);
    // The new shape comes back as itself, `_ahpLog` and all: a capture is
    // still a capture, and a reader that wants the direction still has it.
    const captured = lineFor('host', JSON.stringify(message), 3, 'websocket');
    expect([...framesIn(`${JSON.stringify(captured)}\n`)]).toEqual([captured]);
  });

  it('is not a defect, where an undeclared key on the message still is', () => {
    const check = checker();
    const frame = { method: 'action', params: { channel: 'ahp-root://', action: { type: 'root/agentsChanged', agents: [] }, serverSeq: 1 } };
    const { ts, ...rest } = { ...meta, ts: '2020-01-01T00:00:00.000Z' };

    expect(check.frame({ ...frame, _ahpLog: { ...rest, byteLength: 40 } })).toEqual(check.frame(frame));
    // The frame itself is clean, and a real undeclared key is still caught, so
    // the line above is not passing because nothing was checked.
    expect(check.frame(frame)).toEqual([]);
    expect(check.frame({ ...frame, params: { ...frame.params, invented: true } }).map((one) => one.what))
      .toEqual(['undeclared key `invented`']);
  });
});
