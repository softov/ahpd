import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { knownAgents } from '@ahpd/sdk';
import type { Engine, AgentView, Bag, Session, Start } from '@ahpd/sdk';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { posix } from '../../../tools/posix.js';
import { name } from '../src/plugin.js';
import { keyVariablesOf, presets as shipped } from '../src/presets.js';

/*
 * The shipped rows, as records.
 *
 * A record whose id names a row takes that row's command, arguments,
 * environment and sign-in, and whatever the record writes itself wins over the
 * row. There are no presets in the plugin's options: the rows are what a record
 * may name, and each is offered as a template. The cases here are what a
 * record's open builds - its own id and name, the row it names or a `base` it
 * takes, the record's fields over the row's, the sign-in a row applies once a
 * key is there and its absence when none is, install and page staying on the
 * record - and the refusals for a record that names no command or a base this
 * plugin does not ship.
 *
 * A row's spawn is read from a program put on PATH under the row's own command,
 * which writes what it was run with; the sign-in and the host tools are read
 * from the scripted ACP server the other ACP cases use.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** Everything this file made, and the PATH it changed, released after each case. */
const made: string[] = [];
const started: Session[] = [];
let savedPath: string | undefined;

afterEach(async () => {
  for (const session of started.splice(0)) await session.close();
  if (savedPath !== undefined) {
    process.env.PATH = savedPath;
    savedPath = undefined;
  }
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A folder of its own for one case, removed after it. */
const scratch = (label: string): string => {
  const path = mkdtempSync(join(tmpdir(), `ahpd-acp-preset-${label}-`));
  made.push(path);
  return path;
};

/** One load of the plugin, with the kind it registered and everything it served. */
const load = async (options: Record<string, unknown> = {}) => {
  const { loaded, problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/ahpd-acp-preset', agents: [echo({ path: '/tmp/ahpd-acp-preset' })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  const kind = served.engines?.['acp'];
  if (kind === undefined) throw new Error('no acp kind was registered');
  return { loaded, problems, served, kind };
};

/** One record, as a kind is handed it: every field read at each call. */
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

/** A start that is trusted, says nothing and carries whatever one case gives it. */
const startOf = (label: string, extra: Record<string, unknown> = {}): Start => ({
  uri: `ahp-session:/${label}`,
  chatUri: `ahp-chat:/${label}`,
  settings: {},
  trusted: () => true,
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  ...extra,
} as never);

/** One record's session, released after the case. */
const sessionOf = async (
  kind: Engine,
  id: string,
  held: () => Bag,
  label: string,
  extra: Record<string, unknown> = {},
): Promise<Session> => {
  const session = await kind.open(viewOf(id, held)).create(startOf(label, extra));
  started.push(session);
  return session;
};

/** What a spawned program was run as. */
interface Probe {
  name: string;
  argv: string[];
  env: Record<string, string>;
}

/*
 * One row's spawn, as the server saw it.
 *
 * A row's command and arguments are not on the Agent this load serves - a
 * backend says its id and name and nothing of what it would spawn - so a PATH
 * entry holds an executable under the row's own command that writes the name,
 * argv and environment it was run with, then exits. The file it leaves is read
 * back here. This is POSIX only, because the executable is a script with a
 * shebang.
 */
const spawnOf = async (
  kind: Engine,
  id: string,
  held: () => Bag = () => ({}),
  command = shipped[id]?.command,
): Promise<Probe> => {
  if (command === undefined) throw new Error(`${id} names no shipped command`);
  const dir = scratch(`run-${id}`);
  const out = join(dir, 'spawn.json');
  const file = join(dir, command);
  // Written aside and renamed, so the file the test waits for is whole when it
  // appears.
  writeFileSync(file, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(`${out}.part`)}, JSON.stringify({`,
    "  name: require('node:path').basename(process.argv[1]),",
    '  argv: process.argv.slice(2),',
    '  env: process.env,',
    '}));',
    `fs.renameSync(${JSON.stringify(`${out}.part`)}, ${JSON.stringify(out)});`,
  ].join('\n'));
  chmodSync(file, 0o755);

  if (savedPath === undefined) savedPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;

  const session = await sessionOf(kind, id, held, `run-${id}`);
  session.sendMessage('t1', 'hi');
  for (let i = 0; i < 3000 && !existsSync(out); i++) await new Promise((resolve) => { setTimeout(resolve, 1); });
  if (!existsSync(out)) throw new Error(`${command} was not run`);
  return JSON.parse(readFileSync(out, 'utf8')) as Probe;
};

/** One turn over the fixture, and what it was sent. */
const turnOf = async (
  kind: Engine,
  id: string,
  config: Bag = {},
  extra: { flags?: string[]; start?: Record<string, unknown> } = {},
) => {
  const log = join(scratch(`turn-${id}`), 'requests.jsonl');
  const own = config['env'];
  const env = { ACP_LOG: log, ...(typeof own === 'object' && own !== null ? own as Record<string, string> : {}) };
  const ended: string[] = [];
  const said: string[] = [];
  const session = await sessionOf(kind, id, () => ({
    ...config,
    command: process.execPath,
    args: [FIXTURE, ...(extra.flags ?? [])],
    env,
  }), `turn-${id}`, {
    ...(extra.start ?? {}),
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/error' || action.type === 'chat/turnComplete') {
        ended.push(String(action.type));
        // A turn's error is the protocol's, under the action's part rather than
        // on the action itself.
        const part = action['part'];
        const error = (typeof part === 'object' && part !== null ? part as Bag : {})['error'];
        if (action.type === 'chat/error' && typeof error === 'object' && error !== null) {
          said.push(String((error as Bag)['message']));
        }
      }
    },
  });
  session.sendMessage('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });

  const raw = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const requests = raw.trim() === '' ? [] : raw.trim().split('\n').map((line) => JSON.parse(line) as Bag);
  return {
    ended,
    said,
    requests,
    signedIn: requests.find((one) => one.method === 'authenticate'),
    servers: (requests.find((one) => one.method === 'session/new')?.params as Bag | undefined)?.['mcpServers'],
  };
};

it('serves the kind with no options at all, and registers no agent of its own', async () => {
  const { loaded, problems, served } = await load();
  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual([name]);
  // The base's echo is all this host serves until a record of the kind opens.
  expect((served.agents ?? []).map((one) => one.provider)).toEqual(['echo']);
});

it('opens a record under the shipped row its id names, or under a base it names', async () => {
  const { problems, kind } = await load();
  expect(problems).toEqual([]);

  const codex = kind.open(viewOf('codex', () => ({ env: { X: '1' } }), 'Codex'));
  expect([codex.provider, codex.displayName]).toEqual(['codex', 'Codex']);
  const copilot = kind.open(viewOf('copilot', () => ({}), 'Copilot'));
  expect([copilot.provider, copilot.displayName]).toEqual(['copilot', 'Copilot']);

  const work = kind.open(viewOf('work', () => ({ base: 'copilot' }), 'Copilot work'));
  expect([work.provider, work.displayName]).toEqual(['work', 'Copilot work']);
});

it('lists the same agents as the sdk', () => {
  expect(Object.keys(shipped).sort()).toEqual(Object.keys(knownAgents).sort());
});

it('offers every shipped row as a template, with a field per variable its vendor documents', async () => {
  const { kind } = await load();
  const templates = kind.templates ?? [];
  expect(templates.map((one) => one.name).sort()).toEqual(Object.values(shipped).map((one) => one.name).sort());

  for (const [id, row] of Object.entries(shipped)) {
    const agent = knownAgents[id];
    if (agent === undefined) throw new Error(`${id} has no row in knownAgents`);
    const template = templates.find((one) => one.name === row.name);
    if (template === undefined) throw new Error(`${id} has no template`);
    const config = template.config ?? {};
    expect(config['command'], `${id} runs another command`).toBe(row.command);

    // A record made from the template starts with a field for each variable its
    // vendor documents, set empty, and the row's own switches at their value.
    const env = (config['env'] ?? {}) as Record<string, string>;
    for (const variable of keyVariablesOf(id)) {
      expect(env[variable], `${id} draws no field for ${variable}`).toBe('');
    }
    for (const [variable, value] of Object.entries(row.env ?? {})) expect(env[variable]).toBe(value);
  }

  // A variable no vendor documents is still a value a record may write.
  const fields = (kind.schema as Bag)['properties'] as Bag;
  expect((fields['env'] as Bag)['additionalProperties']).toEqual({ type: 'string', secret: true, secretAtUse: true });
  // Amp's switch is the row's, so it is drawn with the value it must have.
  const amp = templates.find((one) => one.name === shipped.amp?.name);
  expect((amp?.config?.['env'] as Record<string, string>)['AMP_SKIP_UPDATE_CHECK']).toBe('1');
});

// A shim on PATH is a POSIX executable, hence the skip where there is no such thing.
it.skipIf(!posix)('runs cline and omp the way their rows say', async () => {
  const { kind } = await load();
  const cline = await spawnOf(kind, 'cline');
  const omp = await spawnOf(kind, 'omp');
  expect([cline.name, cline.argv]).toEqual(['cline', ['--acp']]);
  expect([omp.name, omp.argv]).toEqual(['omp', ['acp']]);
});

it.skipIf(!posix)('stops amp checking for updates, as the row does', async () => {
  const { kind } = await load();
  const amp = await spawnOf(kind, 'amp');
  expect(amp.env['AMP_SKIP_UPDATE_CHECK']).toBe('1');
});

it.skipIf(!posix)('spawns the base row\'s command, arguments and environment', async () => {
  const { kind } = await load();
  const work = await spawnOf(kind, 'work', () => ({ base: 'copilot' }), shipped.copilot?.command);
  expect([work.name, work.argv]).toEqual(['copilot', ['--acp']]);
  expect(work.env['COPILOT_AUTO_UPDATE']).toBe('false');
});

it.skipIf(!posix)('accepts install and page on a record, and runs the row its id names', async () => {
  const { kind } = await load();
  const codex = await spawnOf(kind, 'codex', () => ({
    install: { all: 'npm i -g @agentclientprotocol/codex-acp' },
    page: 'https://www.npmjs.com/package/@agentclientprotocol/codex-acp',
  }));
  expect(codex.name).toBe('codex-acp');
});

it.skipIf(!posix)('lays a record\'s env over the row\'s and replaces its arguments', async () => {
  const { kind } = await load();
  const merged = await spawnOf(kind, 'copilot', () => ({ env: { COPILOT_HOME: '/tmp/copilot' } }));
  expect(merged.env).toMatchObject({ COPILOT_AUTO_UPDATE: 'false', COPILOT_HOME: '/tmp/copilot' });

  // A record's own arguments replace the row's rather than adding to them,
  // because a record that wrote arguments wrote the whole command.
  const rewritten = await spawnOf(kind, 'copilot', () => ({ args: [] }));
  expect(rewritten.argv).toEqual([]);
});

it('refuses a record with no command, naming itself, and opens the rest', async () => {
  const { problems, kind } = await load();
  expect(problems).toEqual([]);
  expect(() => kind.open(viewOf('nope', () => ({})))).toThrow(
    'nope names no command, and an acp record names the program its sessions run',
  );
  expect(kind.open(viewOf('copilot', () => ({}))).provider).toBe('copilot');
});

it('refuses a record whose base names no shipped row, naming the rows it ships', async () => {
  const { problems, kind } = await load();
  expect(problems).toEqual([]);
  expect(() => kind.open(viewOf('work', () => ({ base: 'nope' })))).toThrow(
    /^work\.base names a row this plugin does not ship; the shipped rows are: codex, gemini, copilot/u,
  );
  expect(kind.open(viewOf('codex', () => ({}))).provider).toBe('codex');
});

it('applies a row\'s sign-in once the daemon\'s own environment has its variable', async () => {
  delete process.env.CODEX_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const { kind } = await load();
  const without = await turnOf(kind, 'codex', {}, { flags: ['--signin'] });
  expect(without.signedIn).toBeUndefined();
  expect(without.ended).toEqual(['chat/error']);

  process.env.OPENAI_API_KEY = 'sk-daemon';
  const withIt = await turnOf(kind, 'codex', {}, { flags: ['--signin'] });
  delete process.env.OPENAI_API_KEY;
  expect(withIt.signedIn).toMatchObject({ params: { methodId: 'api-key' } });
  expect(withIt.ended).toEqual(['chat/turnComplete']);

  // And with none of the daemon's, a record that carries the variable itself.
  const carried = await turnOf(kind, 'codex', { env: { CODEX_API_KEY: 'sk-record' } }, { flags: ['--signin'] });
  expect(carried.signedIn).toMatchObject({ params: { methodId: 'api-key' } });

  // A record that names its own sign-in wins over the row's, set or not.
  const own = await turnOf(kind, 'codex', { authenticate: { methodId: 'oauth' } }, { flags: ['--signin'] });
  expect(own.said.join('\n')).toContain('codex offers api-key, not oauth');
});

it('sends no sign-in for a row that needs none', async () => {
  const { kind } = await load();
  delete process.env.CURSOR_API_KEY;
  const gemini = await turnOf(kind, 'gemini', {}, { flags: ['--signin'] });
  expect(gemini.signedIn).toBeUndefined();
  const cursor = await turnOf(kind, 'cursor', {}, { flags: ['--signin'] });
  expect(cursor.signedIn).toBeUndefined();

  process.env.CURSOR_API_KEY = 'key-cursor';
  const signed = await turnOf(kind, 'cursor', {}, { flags: ['--signin'] });
  delete process.env.CURSOR_API_KEY;
  // The row's method is chosen; this fixture offers only api-key, so the turn
  // says which one the row wanted rather than sending it.
  expect(signed.said.join('\n')).toContain('cursor offers api-key, not cursor_login');
});

it('signs devin in with its one method when its key is set', async () => {
  const { kind } = await load();
  delete process.env.WINDSURF_API_KEY;
  const without = await turnOf(kind, 'devin', {}, { flags: ['--signin'] });
  expect(without.signedIn).toBeUndefined();

  process.env.WINDSURF_API_KEY = 'key-devin';
  const signed = await turnOf(kind, 'devin', {}, { flags: ['--signin'] });
  delete process.env.WINDSURF_API_KEY;
  expect(signed.said.join('\n')).toContain('devin offers api-key, not devin-browser');
});

it('keeps hostTools plugin-wide and lets a record set its own', async () => {
  const endpoint = { url: 'http://127.0.0.1:4242/ahp-mcp/one', token: 't-kn', setTools: () => {}, close: () => {} };
  const extra = { start: { toolsServer: () => endpoint } };

  const off = await load({ hostTools: false });
  const without = await turnOf(off.kind, 'copilot', {}, extra);
  expect(without.servers).toEqual([]);

  const on = await load();
  const withDefault = await turnOf(on.kind, 'copilot', {}, extra);
  expect(withDefault.servers).toEqual([{
    type: 'http',
    name: 'host',
    url: endpoint.url,
    headers: [{ name: 'authorization', value: `Bearer ${endpoint.token}` }],
  }]);

  // A record turns them on over a load that turned them off.
  const record = await turnOf(off.kind, 'copilot', { hostTools: true }, extra);
  expect(record.servers).toHaveLength(1);

  // And a record turns them off over a load that left them on.
  const quiet = await turnOf(on.kind, 'copilot', { hostTools: false }, extra);
  expect(quiet.servers).toEqual([]);
});

it('lists the modes a row found, and keeps a text box where it found none', async () => {
  const { kind } = await load();
  const approvalsOf = (id: string): Bag => {
    const agent = kind.open(viewOf(id, () => ({})));
    return ((agent.schema() as Bag)['properties'] as Bag)['permissionMode'] as Bag;
  };
  expect(approvalsOf('codex')).toMatchObject({
    enum: ['read-only', 'workspace-write', 'agent', 'agent-full-access'],
    enumLabels: ['Read-only', 'Workspace access', 'Auto review', 'Full access'],
  });
  // A row for an agent whose modes nobody found keeps the plain string.
  expect(approvalsOf('cline')).not.toHaveProperty('enum');
});

it('refreshes a row\'s modes on the agent from the ones a session hears, and keeps them on that session', async () => {
  const { kind } = await load();
  const log = join(scratch('heard'), 'requests.jsonl');
  const agent = kind.open(viewOf('codex', () => ({
    command: process.execPath,
    args: [FIXTURE],
    env: { ACP_LOG: log },
  })));
  const approvalsOf = (): Bag => ((agent.schema() as Bag)['properties'] as Bag)['permissionMode'] as Bag;
  expect(approvalsOf()['enum']).toEqual(['read-only', 'workspace-write', 'agent', 'agent-full-access']);

  const ended: string[] = [];
  const session = await agent.create(startOf('heard', {
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/turnComplete' || action.type === 'chat/error') ended.push(String(action.type));
    },
  }));
  started.push(session);
  session.sendMessage('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });
  expect(ended).toEqual(['chat/turnComplete']);

  // The fixture names `ask` and `code`, which are not the row's own: they are
  // that session's, and the agent's from here, so the next session a client
  // sets up for the agent is offered what its server last named.
  expect(approvalsOf()).toMatchObject({ enum: ['ask', 'code'], enumLabels: ['Ask', 'Code'] });
  expect(session.settings().availableApprovalModes).toEqual(['ask', 'code']);
});

/*
 * A record whose `modes` is `preset` keeps the row's modes on the agent, as
 * VS Code's agents keep the modes they declare; the session still reports its
 * server's as its own.
 */
it('keeps a row\'s modes on the agent when the record says modes preset', async () => {
  const { kind } = await load();
  const log = join(scratch('kept'), 'requests.jsonl');
  const agent = kind.open(viewOf('codex', () => ({
    command: process.execPath,
    args: [FIXTURE],
    env: { ACP_LOG: log },
    modes: 'preset',
  })));
  const approvalsOf = (): Bag => ((agent.schema() as Bag)['properties'] as Bag)['permissionMode'] as Bag;
  const session = await agent.create(startOf('kept'));
  started.push(session);

  expect(session.settings().availableApprovalModes).toEqual(['ask', 'code']);
  expect(approvalsOf()['enum']).toEqual(['read-only', 'workspace-write', 'agent', 'agent-full-access']);
});
