import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import type { Engine, AgentView, Bag, Session, Start } from '@ahpd/sdk';

/*
 * The `acp` engine: one record per ACP server.
 *
 * A record is opened by the engine rather than registered as an agent of its own,
 * so the cases here are what `open` builds and when it reads the record:
 *
 * - the engine a load registers, its form, its templates, its host-only fields
 *   and its key variables;
 * - two records opening two backends, each with its own id, name and server;
 * - an edit to a record, which the next turn reads rather than the turn that is
 *   already running, applied by spawning another server on the same
 *   conversation.
 *
 * The server is the scripted subprocess the other ACP cases use, and it appends
 * every request it is sent to `ACP_LOG`, so a file tells which server was
 * spoken to.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** The folders and sessions one case made, released after it. */
const made: string[] = [];
const started: Session[] = [];

afterEach(async () => {
  // The close awaited, and the removal too: on Windows a folder stays held
  // until the server in it is gone, and the release happens on the event loop.
  for (const session of started.splice(0)) await session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A folder of its own for one case, removed after it. */
const folderOf = (label: string): string => {
  const folder = mkdtempSync(join(tmpdir(), `ahpd-acp-engine-${label}-`));
  made.push(folder);
  return folder;
};

/** The subprocess's work finishing, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/** The frames a turn ended with, in order. */
const endings = (actions: Bag[]): string[] => actions
  .map((action) => String(action.type))
  .filter((type) => type === 'chat/turnComplete' || type === 'chat/error' || type === 'chat/turnCancelled');

/** One load of the plugin, with no agent of its own: what it serves is its engine. */
const load = async () => {
  const { loaded, problems, options: served } = await loadPlugins(
    [{ name: SOURCE, options: {} }],
    {
      base: { path: folderOf('base'), agents: [echo({ path: folderOf('echo') })] },
      configDir: REPO,
      cwd: REPO,
      log: () => {},
    },
  );
  return { loaded, problems, served };
};

/** The `acp` engine one load registered. */
const engineOf = async (): Promise<Engine> => {
  const { problems, served } = await load();
  expect(problems).toEqual([]);
  const engine = served.engines?.['acp'];
  if (engine === undefined) throw new Error('no acp engine was registered');
  return engine;
};

/** One record, as an engine is handed it: every field read at each call. */
const viewOf = (id: string, held: () => Bag, name = id): AgentView => ({
  id,
  engine: 'acp',
  owner: 'host',
  name,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return held(); },
});

/** One record's backend, and a session of it recording what it puts on the wire. */
function opened(
  engine: Engine,
  id: string,
  live: () => Bag,
  folder: string,
  name = id,
): { agent: ReturnType<Engine['open']>; session: Session; actions: Bag[] } {
  const agent = engine.open(viewOf(id, live, name));
  const actions: Bag[] = [];
  const start: Start = {
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: {},
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action as Bag); },
    workingDirectory: folder,
    // The folder is one this case made and vouches for, so the trust rule
    // that keeps an ACP agent out of an unread folder is not what is tested.
    trusted: () => true,
  };
  const session = agent.create(start);
  started.push(session);
  return { agent, session, actions };
}

it('registers the acp engine, its templates, host-only fields and key variables', async () => {
  const { problems, served } = await load();
  expect(problems).toEqual([]);
  const engine = served.engines?.['acp'];
  expect(engine).toMatchObject({
    name: 'acp',
    title: 'Agent Client Protocol',
    hostOnly: ['base', 'command', 'args', 'cwd', 'machine', 'install'],
  });
  // Each row's vendor key variables: the ones `knownAgents` marks secret and
  // the ones a row signs in with, which is what any owner may set.
  expect(engine?.keyVariables).toEqual([
    'AMP_API_KEY',
    'CLINE_API_KEY',
    'CODEX_API_KEY',
    'COPILOT_GITHUB_TOKEN',
    'CURSOR_API_KEY',
    'DEEPSEEK_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOSE_PROVIDER__API_KEY',
    'KILO_API_KEY',
    'OMP_AUTH_BROKER_TOKEN',
    'OPENAI_API_KEY',
    'WINDSURF_API_KEY',
  ]);
  expect(typeof engine?.open).toBe('function');

  // The fields of this backend, without the ones the agents channel owns: a
  // record names a shipped row or its own program and nothing a second engine
  // spells.
  const fields = Object.keys((engine?.schema.properties ?? {}) as Bag).sort();
  expect(fields).toEqual([
    'args', 'authenticate', 'base', 'command', 'cwd', 'env', 'honoursTrust', 'hostTools', 'install', 'machine', 'page', 'toolsChanged',
  ]);
  for (const owned of ['name', 'description', 'icon', 'model', 'provider']) expect(fields).not.toContain(owned);

  // One template per shipped row, carrying the row's spawn fields so a record
  // made from it runs the agent the row describes, and its vendor's key
  // variables as fields set empty.
  const templates = engine?.templates ?? [];
  expect(templates).toHaveLength(14);
  expect(templates.slice(0, 3).map((one) => one.name)).toEqual(['Codex', 'Gemini', 'Copilot']);
  const codex = templates[0]?.config ?? {};
  expect(codex).toMatchObject({
    command: 'codex-acp',
    authenticate: { methodId: 'api-key' },
    env: { CODEX_API_KEY: '', OPENAI_API_KEY: '' },
    install: { all: 'npm i -g @agentclientprotocol/codex-acp' },
  });
  const copilot = templates[2]?.config ?? {};
  expect(copilot).toMatchObject({ command: 'copilot', args: ['--acp'], env: { COPILOT_GITHUB_TOKEN: '', COPILOT_AUTO_UPDATE: 'false' } });
  // Copilot signs in on its own, so its template names no method.
  expect(copilot).not.toHaveProperty('authenticate');

  // The load registers the engine and no agent of its own: the base's echo is
  // all this host serves until a record of the engine is opened.
  expect((served.agents ?? []).map((one) => one.provider)).toEqual(['echo']);
});

it('names the template a record runs, by its id or its base, with an empty config', async () => {
  const engine = await engineOf();
  const made = engine.templates ?? [];
  const pick = (id: string, config: Record<string, unknown> = {}) => engine.templateOf?.({ id, config }, made)?.name;

  // A record stored with no config, as the move from presets wrote them, runs
  // the row its id names, so it is drawn with that row's template.
  expect(pick('codex')).toBe('Codex');
  expect(pick('gemini')).toBe('Gemini');
  // A record of its own id names its row with `base`.
  expect(pick('mine', { base: 'copilot' })).toBe('Copilot');
  // A record that runs no shipped row has no template.
  expect(pick('nothing')).toBeUndefined();
  expect(pick('mine', { command: 'codex-acp' })).toBeUndefined();
});

it('opens one backend per record, with the record\'s own id, name and server', async () => {
  const engine = await engineOf();
  const one = folderOf('one');
  const two = folderOf('two');
  const firstLog = join(one, 'requests.jsonl');
  const secondLog = join(two, 'requests.jsonl');
  const first = opened(engine, 'acp-one', () => ({ command: process.execPath, args: [FIXTURE], env: { ACP_LOG: firstLog } }), one, 'One');
  const second = opened(engine, 'acp-two', () => ({ command: process.execPath, args: [FIXTURE], env: { ACP_LOG: secondLog } }), two, 'Two');

  expect([first.agent.provider, first.agent.displayName]).toEqual(['acp-one', 'One']);
  expect([second.agent.provider, second.agent.displayName]).toEqual(['acp-two', 'Two']);

  first.session.sendMessage('t1', 'hello');
  second.session.sendMessage('t1', 'hello');
  await until(() => endings(first.actions).length === 1 && endings(second.actions).length === 1);
  expect(endings(first.actions)).toEqual(['chat/turnComplete']);
  expect(endings(second.actions)).toEqual(['chat/turnComplete']);

  // Each server was given its own turn, which is what says two records are two
  // backends rather than one with two names.
  expect(existsSync(firstLog)).toBe(true);
  expect(existsSync(secondLog)).toBe(true);
});

it('applies an edit at the next turn, spawning another server on the conversation it had', async () => {
  const engine = await engineOf();
  const folder = folderOf('live');
  const firstLog = join(folder, 'first.jsonl');
  const secondLog = join(folder, 'second.jsonl');
  let held: Bag = { command: process.execPath, args: [FIXTURE], env: { ACP_LOG: firstLog } };
  const { session, actions } = opened(engine, 'acp-live', () => held, folder);

  session.sendMessage('t1', 'first');
  await until(() => endings(actions).length === 1);
  expect(endings(actions)).toEqual(['chat/turnComplete']);
  const before = statSync(firstLog).size;

  // The record changes under the session. The turn already running is over, so
  // nothing here is answered by the first server: the next one is built from
  // what the record says now.
  held = { command: process.execPath, args: [FIXTURE], env: { ACP_LOG: secondLog } };
  session.sendMessage('t2', 'second');
  await until(() => endings(actions).length === 2);
  expect(endings(actions)).toEqual(['chat/turnComplete', 'chat/turnComplete']);

  // The second server answered, and the first was given nothing after the
  // edit: the conversation moved rather than the record being read but ignored.
  expect(existsSync(secondLog)).toBe(true);
  expect(statSync(firstLog).size).toBe(before);

  // And it moved by being handed back rather than started again: the second
  // server was asked to resume the conversation, not to open another one.
  const asked = readFileSync(secondLog, 'utf8');
  expect(asked).toContain('session/resume');
  expect(asked).not.toContain('session/new');
});
