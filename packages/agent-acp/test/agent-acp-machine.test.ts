import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { Agent, Bag, MachineNeed, PluginHost, Session, Vault } from '@ahpd/sdk';
import { loadPlugins } from '../../server/src/plugins.js';
import { fileResources } from '../../sdk/src/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import { acpAgent } from '../src/agent.js';
import { name, optionsOf } from '../src/plugin.js';

/*
 * What a preset says its machine needs.
 *
 * A preset's `machine` is the variant's own: its `env` becomes one environment
 * need per variable and its `copy` one copy need per entry, named after the
 * preset, and the host asks each variant's `machine()` for itself. A `fromEnv`
 * value is read from the daemon's environment when the load runs; a `$secret`
 * is handed through as written and read by the computer plugin when a machine
 * is made, for that machine's owner. A preset whose `machine` cannot be
 * resolved is skipped with one line naming it, and the others register.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';
const COMPUTER = './packages/computer/src/index.ts';
const DOCKER = fileURLToPath(new URL('../../computer/test/fixtures/docker.mjs', import.meta.url));

/** Everything this file made, so each case leaves nothing behind. */
const made: string[] = [];
const started: Session[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const session of started.splice(0)) session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
  delete process.env.AHPD_TEST_CODEX_KEY;
});

const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-machine-'));
  made.push(path);
  return path;
};

/** A vault holding the given names, and nothing else. */
const heldVault = (held: Record<string, string>): Vault => ({
  get: async (one) => held[one],
  set: async () => {},
  delete: async () => false,
  list: async () => Object.keys(held).sort(),
});

/** The plugin's own load, with what it registered and every line it said. */
const load = async (options: Record<string, unknown>) => {
  const lines: string[] = [];
  const { loaded, problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/ahpd-acp-machine', agents: [echo({ path: '/tmp/ahpd-acp-machine' })] },
    configDir: REPO,
    cwd: REPO,
    log: (line: string) => { lines.push(line); },
  });
  const agents = (served.agents ?? []).slice(1);
  return { loaded, problems, agents, lines };
};

/** The lines one load said about the presets it would not register. */
const skippedOf = (problems: string[]): string[] => problems.filter((line) => line.startsWith(`${name}: `));

/** One registered agent's needs, by provider. */
const needsOf = (agents: Agent[], provider: string): Record<string, MachineNeed> | undefined =>
  agents.find((one) => one.provider === provider)?.machine?.();

const CODEX_MACHINE = {
  env: {
    CODEX_HOME: '/ahpd/codex',
    CODEX_API_KEY: { fromEnv: 'AHPD_TEST_CODEX_KEY' },
    OPENAI_API_KEY: { $secret: 'host:codex' },
  },
  copy: [{ source: '~/.codex/config.toml', target: '/ahpd/codex/config.toml' }],
};

it('answers one env need per variable and one copy need per entry, named after the preset', async () => {
  process.env.AHPD_TEST_CODEX_KEY = 'from-the-daemon';
  const { problems, agents } = await load({ presets: { codex: { machine: CODEX_MACHINE } } });
  expect(problems).toEqual([]);

  expect(needsOf(agents, 'codex')).toEqual({
    'codex.CODEX_HOME': expect.objectContaining({ name: 'CODEX_HOME', default: '/ahpd/codex', required: false }),
    // Read from the daemon's environment at load, so it follows process.env.
    'codex.CODEX_API_KEY': expect.objectContaining({ name: 'CODEX_API_KEY', default: 'from-the-daemon', required: false }),
    // Handed through as written: the computer plugin reads it when a machine
    // is made, for that machine's owner.
    'codex.OPENAI_API_KEY': expect.objectContaining({ name: 'OPENAI_API_KEY', default: { $secret: 'host:codex' }, required: false }),
    'codex.copy.0': expect.objectContaining({ source: '~/.codex/config.toml', target: '/ahpd/codex/config.toml' }),
  });
});

it('has no machine() for a preset with no machine', async () => {
  const { agents } = await load({ presets: { codex: {} } });
  expect(agents.find((one) => one.provider === 'codex')?.machine).toBeUndefined();
});

it('answers each preset its own needs', async () => {
  const { problems, agents } = await load({
    presets: {
      codex: { machine: { env: { CODEX_HOME: '/ahpd/codex' } } },
      copilot: { machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } },
    },
  });
  expect(problems).toEqual([]);
  expect(Object.keys(needsOf(agents, 'codex') ?? {})).toEqual(['codex.CODEX_HOME']);
  expect(Object.keys(needsOf(agents, 'copilot') ?? {})).toEqual(['copilot.COPILOT_HOME']);
});

it('skips only a preset whose fromEnv names a variable the daemon does not have, naming the preset and the variable', async () => {
  delete process.env.AHPD_TEST_CODEX_KEY;
  const { loaded, problems, agents, lines } = await load({
    presets: { codex: { machine: CODEX_MACHINE }, copilot: { machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } } },
  });
  expect(loaded.map((one) => one.name)).toEqual([name]);
  expect(agents.map((one) => one.provider)).toEqual(['copilot']);
  expect(skippedOf(problems)).toEqual([
    `${name}: options.presets.codex.machine.env.CODEX_API_KEY reads AHPD_TEST_CODEX_KEY, which the daemon's environment does not have`,
  ]);
  expect(lines.filter((line) => line.includes('options.presets.codex'))).toEqual(skippedOf(problems));
});

it('skips only a preset whose machine is wrongly written, naming the field', async () => {
  for (const [machine, said] of [
    ['x', 'options.presets.codex.machine is not an object'],
    [{ volume: 'x' }, 'options.presets.codex.machine.volume is not a field; a machine takes env and copy'],
    [{ env: [] }, 'options.presets.codex.machine.env is not an object'],
    [{ env: { A: 1 } }, 'options.presets.codex.machine.env.A is not a string, { fromEnv } or { $secret }'],
    [{ env: { A: { fromEnv: '' } } }, 'options.presets.codex.machine.env.A is not a string, { fromEnv } or { $secret }'],
    [{ copy: {} }, 'options.presets.codex.machine.copy is not a list'],
    [{ copy: [{ source: '/a' }] }, 'options.presets.codex.machine.copy[0] needs a source and a target'],
    [{ copy: [{ source: '/a', target: 'rel' }] }, 'options.presets.codex.machine.copy[0].target is not an absolute path'],
  ] as const) {
    const { problems, agents } = await load({
      presets: { codex: { machine }, copilot: { machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } } },
    });
    expect(agents.map((one) => one.provider)).toEqual(['copilot']);
    expect(skippedOf(problems)).toEqual([`${name}: ${said}`]);
  }
});

it('never reads a $secret at load, and never says a value in a skip line', async () => {
  process.env.AHPD_TEST_CODEX_KEY = 'daemon-key-value';
  const asked: string[] = [];
  const said: string[] = [];
  const host = {
    log: (line: string) => { said.push(line); },
    problem: (line: string) => { said.push(line); },
    secret: async (one: string) => { asked.push(one); return 'vault-value'; },
  } as unknown as PluginHost;
  const held = await optionsOf(host, {
    presets: {
      codex: { machine: CODEX_MACHINE },
      // Skipped for its copy, beside a value that was read: the line names the
      // field and never the value.
      broken: { command: 'x', machine: { env: { KEY: { fromEnv: 'AHPD_TEST_CODEX_KEY' } }, copy: 'x' } },
    },
  });
  expect(asked).toEqual([]);
  expect(held.map((one) => one.provider)).toEqual(['codex']);
  expect(held[0]?.machine?.env?.OPENAI_API_KEY).toEqual({ $secret: 'host:codex' });
  // And none of it is an environment variable of the host's own spawn.
  expect(held[0]?.env ?? {}).not.toHaveProperty('CODEX_HOME');
  expect(said).toEqual([`${name}: options.presets.broken.machine.copy is not a list`, `${name}: options.presets.broken.machine.copy is not a list`]);
  expect(said.join('\n')).not.toContain('daemon-key-value');
});

it('refuses a top-level machine, which is written per preset', async () => {
  const { loaded, problems } = await load({ presets: { codex: {} }, machine: { env: {} } });
  expect(loaded).toEqual([]);
  expect(problems.join('\n')).toMatch(/options\.machine is written per preset, as presets\.<id>\.machine$/u);
});

/*
 * A session that runs on this host is the preset's own command with the
 * preset's own `env`: a machine's variables are given to a machine, by the
 * plugin that makes it, and never reach a spawn on this host or the command a
 * session hands a machine's port.
 */
it('gives a host spawn none of the machine env', async () => {
  const out = join(scratch(), 'env.json');
  // A server that writes the environment it was given and exits, which ends
  // the turn with an error and leaves the file behind.
  const script = `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env))`;
  const agent = acpAgent({
    command: process.execPath,
    args: ['-e', script],
    provider: 'codex',
    machine: { env: { AHPD_MACHINE_ONLY: 'machine-value', AHPD_MACHINE_SECRET: { $secret: 'host:codex' } } },
  });
  const ended: string[] = [];
  const session = agent.create({
    uri: 'ahp-session:/host',
    chatUri: 'ahp-chat:/host',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/error' || action.type === 'chat/turnComplete') ended.push(String(action.type));
    },
  } as never);
  started.push(session);
  session.begin('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });

  const env = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>;
  expect(env.AHPD_MACHINE_ONLY).toBeUndefined();
  expect(env.AHPD_MACHINE_SECRET).toBeUndefined();
});

it('hands a machine port none of the machine env with the command it runs there', async () => {
  const asked: { env?: Record<string, string> }[] = [];
  const agent = acpAgent({
    command: 'codex-acp',
    env: { HOST_SIDE: '1' },
    provider: 'codex',
    machine: { env: { AHPD_MACHINE_ONLY: 'machine-value' } },
  });
  const ended: string[] = [];
  const session = agent.create({
    uri: 'ahp-session:/boxed',
    chatUri: 'ahp-chat:/boxed',
    settings: { computer: 'computer://box' },
    computers: {
      how: async (_id: string, spawn: { env?: Record<string, string> }) => {
        asked.push(spawn);
        return undefined;
      },
    },
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/error') ended.push('error');
    },
  } as never);
  started.push(session);
  session.begin('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });

  expect(asked).toHaveLength(1);
  expect(asked[0]?.env).toEqual({ HOST_SIDE: '1' });
});

/*
 * The whole path: a preset's machine block, registered as the variant's
 * `machine()`, read by the computer plugin when it makes a disposable machine
 * for a session of that variant. The plain variable is given when the machine
 * is made; the `$secret` is read for the session's owner, never given at
 * create, and passed by name on each command run in the machine.
 */
it('reaches a disposable machine: plain values at create, a $secret by name on each command', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = scratch();
  const state = join(dir, 'docker.json');
  process.env.AHPD_TEST_CODEX_KEY = 'daemon-codex-key';
  const lines: string[] = [];
  const { problems, options } = await loadPlugins([
    { name: SOURCE, options: { presets: { codex: { machine: CODEX_MACHINE }, copilot: { machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } } } } },
    {
      name: COMPUTER,
      options: {
        command: process.execPath,
        args: [DOCKER],
        env: { DOCKER_FAKE_STATE: state },
        sessionSetting: false,
        profiles: { codex: { agents: [], disposable: true } },
      },
    },
  ], {
    base: { path: dir, agents: [], resources: fileResources(), vault: heldVault({ 'host:codex': 'vault-codex-key' }) },
    configDir: dir,
    cwd: REPO,
    log: (line: string) => { lines.push(line); },
  });
  expect(problems).toEqual([]);

  const agents = options.agents ?? [];
  const create = options.computers?.create as NonNullable<NonNullable<typeof options.computers>['create']>;
  // The copy's source is this host's file, which the test does not have, so
  // the machine is made from the variant's env needs.
  const needs = Object.fromEntries(Object.entries(needsOf(agents, 'codex') ?? {}).filter(([key]) => !key.includes('.copy.')));
  const id = String(await create({ source: 'disposable:codex', session: 'ahp-session:/one', provider: 'codex', owner: 'user:ada', needs }));

  const held = JSON.parse(readFileSync(state, 'utf8')) as { machines: { env?: Record<string, string> }[]; calls: string[][] };
  expect(held.machines[0]?.env).toEqual({ CODEX_HOME: '/ahpd/codex', CODEX_API_KEY: 'daemon-codex-key' });
  const how = await options.computers?.how(id, { command: 'true' });
  const args = how?.args ?? [];
  expect(args.flatMap((one, at) => (args[at - 1] === '-e' ? [one] : []))).toEqual(['OPENAI_API_KEY']);
  expect(how?.env?.OPENAI_API_KEY).toBe('vault-codex-key');

  // The vault's value is on no argv, in no machine record, no file beside the
  // configuration and no log line.
  expect(readFileSync(state, 'utf8')).not.toContain('vault-codex-key');
  expect(args.join(' ')).not.toContain('vault-codex-key');
  expect(readFileSync(join(dir, 'computers.json'), 'utf8')).not.toContain('vault-codex-key');
  expect(lines.join('\n')).not.toMatch(/vault-codex-key|daemon-codex-key/u);

  // The other preset's machine gets its own env, and nothing of codex's.
  const other = String(await create({ source: 'disposable:codex', session: 'ahp-session:/two', provider: 'copilot', owner: 'user:ada' }));
  const again = JSON.parse(readFileSync(state, 'utf8')) as { machines: { name: string; env?: Record<string, string> }[] };
  expect(again.machines.find((one) => one.name === other)?.env).toEqual({ COPILOT_HOME: '/ahpd/copilot' });
});

/*
 * A shipped row's sign-in counts a variable the preset gives its machine, for
 * a session placed in that machine and for no other: a session on this host
 * has only the daemon's environment and the preset's own `env`.
 */
const SERVER = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** What one turn sent the server, and every line and argv the bridge said along the way. */
const signedIn = async (placed: boolean) => {
  delete process.env.CODEX_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const log = join(scratch(), 'requests.jsonl');
  const said: string[] = [];
  const argv: string[] = [];
  const host = {
    log: (line: string) => { said.push(line); },
    problem: (line: string) => { said.push(line); },
    secret: async () => { throw new Error('not asked'); },
  } as unknown as PluginHost;
  const [options] = await optionsOf(host, {
    presets: {
      codex: {
        command: process.execPath,
        args: [SERVER, '--signin'],
        env: { ACP_LOG: log },
        machine: { env: { CODEX_API_KEY: 'machine-key-value' } },
      },
    },
  });
  const agent = acpAgent(options as NonNullable<typeof options>);
  const ended: string[] = [];
  const session = agent.create({
    uri: `ahp-session:/signin-${String(placed)}`,
    chatUri: `ahp-chat:/signin-${String(placed)}`,
    settings: placed ? { computer: 'computer://box' } : {},
    ...(placed
      ? {
          computers: {
            how: async (_id: string, spawn: { command: string; args?: string[]; env?: Record<string, string> }) => {
              argv.push(spawn.command, ...(spawn.args ?? []));
              return { command: spawn.command, args: spawn.args ?? [], ...(spawn.env === undefined ? {} : { env: spawn.env }) };
            },
          },
        }
      : {}),
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/error' || action.type === 'chat/turnComplete') {
        ended.push(String(action.type));
        if (action.type === 'chat/error') said.push(String(action.message));
      }
    },
  } as never);
  started.push(session);
  session.begin('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });
  const requests = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { method?: string });
  return { ended, said, argv, requests, raw: readFileSync(log, 'utf8') };
};

it("sends a row's sign-in for a session in the machine its preset gives the variable to", async () => {
  const { ended, requests, said, argv, raw } = await signedIn(true);
  expect(requests.find((one) => one.method === 'authenticate')).toMatchObject({ params: { methodId: 'api-key' } });
  expect(ended).toEqual(['chat/turnComplete']);
  // The sign-in names a method, never the key it stands for.
  expect([...said, ...argv, raw].join('\n')).not.toContain('machine-key-value');
});

it('sends no sign-in for a session on this host, which has only the daemon\'s environment', async () => {
  const { ended, requests, said } = await signedIn(false);
  expect(requests.find((one) => one.method === 'authenticate')).toBeUndefined();
  expect(ended).toEqual(['chat/error']);
  expect(said.join('\n')).not.toContain('machine-key-value');
});
