import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { machinePathOf } from '@ahpd/sdk';
import type { Engine, AgentView, Bag, MachineNeed, OpenedTerminal, OpenTerminal, Session, SpawnOptions, Vault } from '@ahpd/sdk';
import { loadPlugins } from '../../server/src/plugins.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import { acpAgent } from '../src/agent.js';
import { name } from '../src/plugin.js';
import { presets } from '../src/presets.js';
import { readParts } from '../../computer/src/parts.js';

/*
 * What a record says its machine needs.
 *
 * A record's `machine` is its own, laid over the shipped row's: its `env`
 * becomes one environment need per variable and its `copy` one copy need per
 * entry, named after the record, and the host asks each record's `machine()`
 * for itself. A `fromEnv` value is read from the daemon's environment when the
 * record opens; a `$secret` is handed through as written and read by the
 * computer plugin when a machine is made, for that machine's owner. A record
 * whose `machine` cannot be resolved refuses its own open, with one line naming
 * the field, and the other records of the host are untouched.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';
const COMPUTER = './packages/computer/src/index.ts';
const DOCKER = fileURLToPath(new URL('../../computer/test/fixtures/docker.mjs', import.meta.url));

/** Everything this file made, so each case leaves nothing behind. */
const made: string[] = [];
const started: Session[] = [];
// Each session closed before the folders go: a server on this host runs in
// its folder, and Windows keeps a folder a process is in.
afterEach(async () => {
  vi.useRealTimers();
  for (const session of started.splice(0)) await session.close();
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

/** The plugin's own load, with the kind it registered and every line it said. */
const load = async (options: Record<string, unknown>) => {
  const lines: string[] = [];
  const { loaded, problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/ahpd-acp-machine', agents: [echo({ path: '/tmp/ahpd-acp-machine' })] },
    configDir: REPO,
    cwd: REPO,
    log: (line: string) => { lines.push(line); },
  });
  const kind = served.engines?.['acp'];
  if (kind === undefined) throw new Error('no acp kind was registered');
  return { loaded, problems, kind, lines };
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

/** One record's needs, opened from the kind. */
const needsOf = (kind: Engine, id: string, held: () => Bag = () => ({})): Record<string, MachineNeed> | undefined =>
  kind.open(viewOf(id, held)).machine?.();

const CODEX_MACHINE = {
  env: {
    CODEX_HOME: '/ahpd/codex',
    CODEX_API_KEY: { fromEnv: 'AHPD_TEST_CODEX_KEY' },
    OPENAI_API_KEY: { $secret: 'host:codex' },
  },
  copy: [{ source: '~/.codex/config.toml', target: '/ahpd/codex/config.toml' }],
};

it('answers one env need per variable and one copy need per entry, named after the record', async () => {
  process.env.AHPD_TEST_CODEX_KEY = 'from-the-daemon';
  const { problems, kind } = await load({});
  expect(problems).toEqual([]);

  expect(needsOf(kind, 'codex', () => ({ machine: CODEX_MACHINE }))).toEqual({
    'codex.CODEX_HOME': expect.objectContaining({ name: 'CODEX_HOME', default: '/ahpd/codex', required: false }),
    // Read from the daemon's environment at load, so it follows process.env.
    'codex.CODEX_API_KEY': expect.objectContaining({ name: 'CODEX_API_KEY', default: 'from-the-daemon', required: false }),
    // Handed through as written: the computer plugin reads it when a machine
    // is made, for that machine's owner.
    'codex.OPENAI_API_KEY': expect.objectContaining({ name: 'OPENAI_API_KEY', default: { $secret: 'host:codex' }, required: false }),
    'codex.copy.0': expect.objectContaining({ source: '~/.codex/config.toml', target: '/ahpd/codex/config.toml' }),
    // The shipped row's part and state, under the record's own block.
    'codex.part': expect.objectContaining({ part: 'codex' }),
    'codex.state': expect.objectContaining({ state: '/ahpd/codex' }),
  });
});

it('has no machine() for a record that takes no row and writes no machine', async () => {
  const { kind } = await load({});
  expect(kind.open(viewOf('mine', () => ({ command: 'mine-acp' }))).machine).toBeUndefined();
});

it('answers each record its own needs', async () => {
  const { problems, kind } = await load({});
  expect(problems).toEqual([]);
  expect(Object.keys(needsOf(kind, 'codex', () => ({ machine: { env: { CODEX_HOME: '/ahpd/codex' } } })) ?? {}))
    .toEqual(['codex.CODEX_HOME', 'codex.part', 'codex.state']);
  expect(Object.keys(needsOf(kind, 'copilot', () => ({ machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } })) ?? {}))
    .toEqual(['copilot.COPILOT_HOME', 'copilot.part', 'copilot.state']);
});

it('refuses a record whose fromEnv names a variable the daemon does not have, naming the record and the variable', async () => {
  delete process.env.AHPD_TEST_CODEX_KEY;
  const { loaded, problems, kind } = await load({});
  expect(loaded.map((one) => one.name)).toEqual([name]);
  expect(problems).toEqual([]);
  expect(() => kind.open(viewOf('codex', () => ({ machine: CODEX_MACHINE })))).toThrow(
    "codex.machine.env.CODEX_API_KEY reads AHPD_TEST_CODEX_KEY, which the daemon's environment does not have",
  );
  // The other record is untouched: one record's open is its own.
  expect(Object.keys(needsOf(kind, 'copilot', () => ({ machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } })) ?? {}))
    .toEqual(['copilot.COPILOT_HOME', 'copilot.part', 'copilot.state']);
});

it('refuses a record whose machine is wrongly written, naming the field', async () => {
  const { problems, kind } = await load({});
  expect(problems).toEqual([]);
  for (const [machine, said] of [
    ['x', 'codex.machine is not an object'],
    [{ volume: 'x' }, 'codex.machine.volume is not a field; a machine takes env, copy, part, state and seed'],
    [{ env: [] }, 'codex.machine.env is not an object'],
    [{ env: { A: 1 } }, 'codex.machine.env.A is not a string, { fromEnv } or { $secret }'],
    [{ env: { A: { fromEnv: '' } } }, 'codex.machine.env.A is not a string, { fromEnv } or { $secret }'],
    [{ copy: {} }, 'codex.machine.copy is not a list'],
    [{ copy: [{ source: '/a' }] }, 'codex.machine.copy[0] needs a source and a target'],
    [{ copy: [{ source: '/a', target: 'rel' }] }, 'codex.machine.copy[0].target is not an absolute path'],
    [{ part: '../x' }, 'codex.machine.part is not a part id'],
    [{ state: 'rel' }, 'codex.machine.state is not an absolute path'],
    [{ seed: {} }, 'codex.machine.seed is not a list'],
    [{ seed: [{ target: 'a' }] }, 'codex.machine.seed[0] needs a source'],
    [{ seed: [{ source: '/a', keep: 'x' }] }, 'codex.machine.seed[0].keep is not a list of strings'],
  ] as const) {
    expect(() => kind.open(viewOf('codex', () => ({ machine })))).toThrow(said);
    // And the other record still opens, with the row it names.
    expect(needsOf(kind, 'copilot', () => ({ machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } }))).toBeDefined();
  }
});

it('never reads a $secret at load, and never says a value in the line that refuses one', async () => {
  process.env.AHPD_TEST_CODEX_KEY = 'daemon-key-value';
  const { kind } = await load({});
  const codex = kind.open(viewOf('codex', () => ({ machine: CODEX_MACHINE })));
  expect(codex.machine?.()['codex.OPENAI_API_KEY']).toMatchObject({ default: { $secret: 'host:codex' } });

  // The record that is refused carries a value that was read beside a field
  // that is wrong: the line names the field and never the value.
  let thrown: Error | undefined;
  try {
    kind.open(viewOf('broken', () => ({ command: 'x', machine: { env: { KEY: { fromEnv: 'AHPD_TEST_CODEX_KEY' } }, copy: 'x' } })));
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown?.message).toBe('broken.machine.copy is not a list');
  expect(thrown?.message).not.toContain('daemon-key-value');
});

/*
 * A session that runs on this host is the record's own command with the
 * record's own `env`: a machine's variables are given to a machine, by the
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
  const session = await agent.create({
    uri: 'ahp-session:/host',
    chatUri: 'ahp-chat:/host',
    settings: {},
    // This case is not about trust, and an absent answer is untrusted.
    trusted: () => true,
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/error' || action.type === 'chat/turnComplete') ended.push(String(action.type));
    },
  } as never);
  started.push(session);
  session.sendMessage('t1', 'hi');
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
  const session = await agent.create({
    uri: 'ahp-session:/boxed',
    chatUri: 'ahp-chat:/boxed',
    settings: { computer: 'computer://box' },
    trusted: () => true,
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
  session.sendMessage('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });

  // Asked as the session was opened and again by its first turn, the machine
  // having answered no command either time, and neither ask carried the
  // machine's own variables.
  expect(asked.map((one) => one.env)).toEqual([{ HOST_SIDE: '1' }, { HOST_SIDE: '1' }]);
});

/*
 * The whole path: a record's machine block, opened as the record's `machine()`,
 * read by the computer plugin when it makes a disposable machine for a session
 * of that record. The plain variable is given when the machine is made; the
 * `$secret` is read for the session's owner, never given at create, and passed
 * by name on each command run in the machine.
 */
it('reaches a disposable machine: plain values at create, a $secret by name on each command', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = scratch();
  const state = join(dir, 'docker.json');
  process.env.AHPD_TEST_CODEX_KEY = 'daemon-codex-key';
  const lines: string[] = [];
  const { kind } = await load({});
  const codex = kind.open(viewOf('codex', () => ({ machine: CODEX_MACHINE })));
  const copilot = kind.open(viewOf('copilot', () => ({ machine: { env: { COPILOT_HOME: '/ahpd/copilot' } } })));
  const { problems, options } = await loadPlugins([
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
    base: { path: dir, agents: [codex, copilot], resources: fileResources(), vault: heldVault({ 'host:codex': 'vault-codex-key' }) },
    configDir: dir,
    cwd: REPO,
    log: (line: string) => { lines.push(line); },
  });
  expect(problems).toEqual([]);

  const create = options.computers?.create as NonNullable<NonNullable<typeof options.computers>['create']>;
  // The copy's source is this host's file, which the test does not have, so
  // the machine is made from the record's env needs.
  const needs = Object.fromEntries(Object.entries(codex.machine?.() ?? {}).filter(([key]) => !key.includes('.copy.')));
  const id = String(await create({ source: 'disposable:codex', session: 'ahp-session:/one', provider: 'codex', owner: 'user:ada', needs }));

  const held = JSON.parse(readFileSync(state, 'utf8')) as { machines: { env?: Record<string, string> }[]; calls: string[][] };
  // The codex part is on the machine's PATH ahead of the Node it runs on.
  const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  expect(held.machines[0]?.env).toEqual({
    CODEX_HOME: '/ahpd/codex',
    CODEX_API_KEY: 'daemon-codex-key',
    PATH: `/opt/ahpd/codex/bin:/opt/ahpd/node/bin:${BASE_PATH}`,
  });
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

  // The other record's machine gets its own env, and nothing of codex's.
  const other = String(await create({ source: 'disposable:codex', session: 'ahp-session:/two', provider: 'copilot', owner: 'user:ada' }));
  const again = JSON.parse(readFileSync(state, 'utf8')) as { machines: { name: string; env?: Record<string, string> }[] };
  expect(again.machines.find((one) => one.name === other)?.env).toEqual({
    COPILOT_HOME: '/ahpd/copilot',
    PATH: `/opt/ahpd/copilot/bin:/opt/ahpd/node/bin:${BASE_PATH}`,
  });
  /*
   * Four times the default, because this case is not waiting on a timer: it
   * makes two machines and asks how one of them runs a command, and every one
   * of those is a spawn of the fixture's own processes. Alone it takes about
   * five seconds - the default exactly - so on a machine running the rest of
   * the package beside it, it fails for being busy rather than for being wrong.
   */
}, 20_000);

/*
 * A shipped row's sign-in counts a variable the record gives its machine, for a
 * session placed in that machine and for no other: a session on this host has
 * only the daemon's environment and the record's own `env`.
 */
const SERVER = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** What one turn sent the server, and every line and argv the bridge said along the way. */
const signedIn = async (placed: boolean) => {
  delete process.env.CODEX_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const log = join(scratch(), 'requests.jsonl');
  const said: string[] = [];
  const argv: string[] = [];
  const { kind } = await load({});
  const agent = kind.open(viewOf('codex', () => ({
    command: process.execPath,
    args: [SERVER, '--signin'],
    env: { ACP_LOG: log },
    machine: { env: { CODEX_API_KEY: 'machine-key-value' } },
  })));
  const ended: string[] = [];
  // A folder that is there and that no case removes: a server on this host runs in it.
  const folder = join(REPO, 'packages', 'agent-acp');
  const session = await agent.create({
    uri: `ahp-session:/signin-${String(placed)}`,
    chatUri: `ahp-chat:/signin-${String(placed)}`,
    workingDirectory: folder,
    settings: placed ? { computer: 'computer://box' } : {},
    trusted: () => true,
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
  session.sendMessage('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });
  const requests = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { method?: string; params?: Bag });
  return { ended, said, argv, requests, folder, raw: readFileSync(log, 'utf8') };
};

it("sends a row's sign-in for a session in the machine the record gives the variable to", async () => {
  const { ended, requests, said, argv, raw } = await signedIn(true);
  expect(requests.find((one) => one.method === 'authenticate')).toMatchObject({ params: { methodId: 'api-key' } });
  expect(ended).toEqual(['chat/turnComplete']);
  // The sign-in names a method, never the key it stands for.
  expect([...said, ...argv, raw].join('\n')).not.toContain('machine-key-value');
});

it('tells an agent in a machine the folder by its machine path', async () => {
  const { ended, requests, folder } = await signedIn(true);
  expect(ended).toEqual(['chat/turnComplete']);
  // Its own path on Linux and macOS, and `/<drive>/...` on Windows, where the
  // machine mounts a host folder at its drive-style path.
  expect(requests.find((one) => one.method === 'session/new')?.params?.cwd).toBe(machinePathOf(folder));
});

it('sends no sign-in for a session on this host, which has only the daemon\'s environment', async () => {
  const { ended, requests, said } = await signedIn(false);
  expect(requests.find((one) => one.method === 'authenticate')).toBeUndefined();
  expect(ended).toEqual(['chat/error']);
  expect(said.join('\n')).not.toContain('machine-key-value');
});

/*
 * A terminal the server asks for: the host's terminal, and - in a session
 * placed in a machine - the command it runs answered by `computers.how`.
 *
 * The fixture sends `terminal/create` at the folder the session was told, then
 * reads the output and the exit code back through the host's terminal. On Linux
 * and macOS the machine's path is the host's, so a spawn there succeeds either
 * way; what these cases assert is that the command went through `how`, and that
 * the host's terminal ran the descriptor it answered rather than the agent's
 * own `echo`.
 */
const terminalIn = async (placed: boolean) => {
  // A folder that is there and that no case removes: a server on this host runs in it.
  const folder = join(REPO, 'packages', 'agent-acp');
  const actions: Bag[] = [];
  const asked: SpawnOptions[] = [];
  const opened: OpenTerminal[] = [];
  const agent = acpAgent({ command: process.execPath, args: [SERVER], provider: 'codex' });
  const session = await agent.create({
    uri: `ahp-session:/terminal-${String(placed)}`,
    chatUri: `ahp-chat:/terminal-${String(placed)}`,
    workingDirectory: folder,
    settings: placed ? { computer: 'computer://box' } : {},
    trusted: () => true,
    computers: {
      how: async (_id: string, spawn: SpawnOptions) => {
        asked.push(spawn);
        // The server itself runs on this host, as the machine's descriptor for
        // it says. The terminal is answered with a descriptor of the test's
        // own, so what the host's terminal is handed is visibly the machine's
        // command rather than the agent's.
        if (spawn.command === 'echo') {
          return { command: 'docker', args: ['exec', '-i', 'box', 'echo', 'hello from the machine'] };
        }
        return { command: spawn.command, args: spawn.args ?? [], ...(spawn.env === undefined ? {} : { env: spawn.env }) };
      },
    },
    terminals: {
      open: (options: OpenTerminal): OpenedTerminal => {
        opened.push(options);
        // What it prints depends on what it was handed, so a case that reads
        // the prose is reading which command the host's terminal really ran.
        const output = options.command === 'echo' ? 'hello from the shell\n' : 'hello from the machine\n';
        return {
          uri: `ahp-terminal:/terminal-${String(opened.length)}`,
          output: () => ({ output, exitCode: 0 }),
          waitForExit: async () => ({ exitCode: 0 }),
          write: () => {},
          resize: () => {},
          kill: () => {},
          release: () => {},
        };
      },
    },
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => { actions.push(action); },
  } as never);
  started.push(session);
  session.sendMessage('t1', 'term now');
  const over = (): boolean => actions.some((one) => one.type === 'chat/turnComplete' || one.type === 'chat/error');
  for (let i = 0; i < 3000 && !over(); i++) await new Promise((resolve) => { setTimeout(resolve, 1); });
  const ofType = (type: string): Bag[] => actions.filter((one) => one.type === type);
  return {
    asked,
    opened,
    folder,
    ended: actions.filter((one) => one.type === 'chat/turnComplete' || one.type === 'chat/error').map((one) => String(one.type)),
    prose: ofType('chat/delta').map((one) => String(one.content)).join(''),
    said: ofType('chat/error').map((one) => String(one.message)),
  };
};

it('runs a terminal a session in a machine asks for in the machine', async () => {
  const { asked, opened, folder, ended, prose, said } = await terminalIn(true);
  expect(said).toEqual([]);
  expect(ended).toEqual(['chat/turnComplete']);
  // The port was asked for the agent's own command, with the cwd in the host's
  // spelling: the machine's path is what the server named.
  expect(asked.filter((one) => one.command === 'echo')).toEqual([
    { command: 'echo', args: ['hello from the shell'], cwd: folder },
  ]);
  // The host's terminal ran what the port answered, not the agent's `echo`.
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({
    cwd: folder,
    command: 'docker',
    args: ['exec', '-i', 'box', 'echo', 'hello from the machine'],
  });
  // And the server read that terminal's output, so the descriptor is what the
  // host's terminal really ran rather than what it was merely told.
  expect(prose).toContain('term=hello from the machine|exit=0');
});

it('keeps a terminal of a session on this host on the host, without asking the port', async () => {
  const { asked, opened, folder, ended, prose, said } = await terminalIn(false);
  expect(said).toEqual([]);
  expect(ended).toEqual(['chat/turnComplete']);
  // The port is there, and a session on this host never needs it.
  expect(asked).toEqual([]);
  expect(opened).toEqual([{ cwd: folder, command: 'echo', args: ['hello from the shell'] }]);
  expect(prose).toContain('term=hello from the shell|exit=0');
});

/*
 * A shipped row carries its machine: the part its CLI comes from, the variable
 * that points its configuration at a state directory, and that directory with
 * the host files it is seeded from. A record's own block is laid over it by
 * key, and a key is the person's to fill in their own record.
 */

it('answers a shipped row its part, its config dir variable and its state', async () => {
  const { problems, kind } = await load({});
  expect(problems).toEqual([]);
  const needs = needsOf(kind, 'gemini') ?? {};
  expect(needs['gemini.part']).toMatchObject({ part: 'gemini', required: true });
  expect(needs['gemini.GEMINI_CLI_HOME']).toMatchObject({ name: 'GEMINI_CLI_HOME', default: '/ahpd/gemini' });
  expect(needs['gemini.state']).toMatchObject({
    state: '/ahpd/gemini',
    seed: [
      { source: '~/.gemini/settings.json', target: '.gemini/settings.json', drop: ['security.auth'] },
      { source: '~/.gemini/GEMINI.md', target: '.gemini/GEMINI.md' },
    ],
  });
  // A shipped row carries no key.
  expect(Object.keys(needs).sort()).toEqual(['gemini.GEMINI_CLI_HOME', 'gemini.part', 'gemini.state']);
});

it('lays a record\'s own machine over its row by key, a key among them', async () => {
  process.env.AHPD_TEST_CODEX_KEY = 'gemini-key';
  const { problems, kind } = await load({});
  expect(problems).toEqual([]);
  const needs = needsOf(kind, 'gemini', () => ({
    machine: { env: { GEMINI_API_KEY: { fromEnv: 'AHPD_TEST_CODEX_KEY' } }, part: 'gemini-next' },
  })) ?? {};
  expect(needs['gemini.GEMINI_API_KEY']).toMatchObject({ name: 'GEMINI_API_KEY', default: 'gemini-key' });
  expect(needs['gemini.GEMINI_CLI_HOME']).toMatchObject({ default: '/ahpd/gemini' });
  expect(needs['gemini.part']).toMatchObject({ part: 'gemini-next' });
  expect(needs['gemini.state']).toMatchObject({ state: '/ahpd/gemini' });
});

it('keeps the row\'s machine variables out of a host spawn', async () => {
  const out = join(scratch(), 'env.json');
  const script = `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env))`;
  const { kind } = await load({});
  const agent = kind.open(viewOf('gemini', () => ({ command: process.execPath, args: ['-e', script] })));
  const ended: string[] = [];
  const session = await agent.create({
    uri: 'ahp-session:/row-host',
    chatUri: 'ahp-chat:/row-host',
    settings: {},
    trusted: () => true,
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => {
      if (action.type === 'chat/error' || action.type === 'chat/turnComplete') ended.push(String(action.type));
    },
  } as never);
  started.push(session);
  session.sendMessage('t1', 'hi');
  for (let i = 0; i < 3000 && ended.length === 0; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });

  const env = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>;
  expect(env.GEMINI_CLI_HOME).toBeUndefined();
  // While the record's machine still has it, for the machine it names.
  expect(agent.machine?.()['gemini.GEMINI_CLI_HOME']).toMatchObject({ name: 'GEMINI_CLI_HOME', default: '/ahpd/gemini' });
});

it('ships a part and a state directory for every row, each seeded from the agent\'s own host files', async () => {
  const { problems, kind } = await load({});
  expect(problems).toEqual([]);
  const rows = Object.fromEntries(['codex', 'gemini', 'copilot', 'opencode', 'kilo', 'goose', 'pi', 'dsh', 'copapo', 'devin', 'cursor', 'amp', 'qwen'].map((id) => {
    const needs = kind.open(viewOf(id, () => ({}))).machine?.() ?? {};
    const state = needs[`${id}.state`] as { state: string; seed: { source: string }[] } | undefined;
    return [id, {
      part: (needs[`${id}.part`] as { part: string }).part,
      env: Object.values(needs).flatMap((need) => ('name' in need ? [`${need.name}=${String(need.default)}`] : [])),
      ...(state === undefined ? {} : { state: state.state, seed: state.seed.map((seed) => seed.source) }),
    }];
  }));
  expect(rows).toEqual({
    codex: { part: 'codex', env: ['CODEX_HOME=/ahpd/codex'], state: '/ahpd/codex', seed: ['~/.codex/config.toml', '~/.codex/AGENTS.md', '~/.codex/skills'] },
    gemini: { part: 'gemini', env: ['GEMINI_CLI_HOME=/ahpd/gemini'], state: '/ahpd/gemini', seed: ['~/.gemini/settings.json', '~/.gemini/GEMINI.md'] },
    copilot: {
      part: 'copilot',
      env: ['COPILOT_HOME=/ahpd/copilot'],
      state: '/ahpd/copilot',
      seed: ['~/.copilot/settings.json', '~/.copilot/mcp-config.json', '~/.copilot/copilot-instructions.md', '~/.copilot/agents', '~/.copilot/skills'],
    },
    opencode: {
      part: 'opencode',
      env: ['XDG_CONFIG_HOME=/ahpd/opencode/config', 'XDG_DATA_HOME=/ahpd/opencode/data'],
      state: '/ahpd/opencode',
      seed: ['~/.config/opencode/opencode.json', '~/.config/opencode/agent', '~/.config/opencode/command'],
    },
    kilo: {
      part: 'kilo',
      env: ['XDG_CONFIG_HOME=/ahpd/kilo/config', 'XDG_DATA_HOME=/ahpd/kilo/data'],
      state: '/ahpd/kilo',
      seed: ['~/.config/kilo/kilo.json', '~/.config/kilo/agent', '~/.config/kilo/command'],
    },
    goose: { part: 'goose', env: ['GOOSE_PATH_ROOT=/ahpd/goose'], state: '/ahpd/goose', seed: ['~/.config/goose/config.yaml'] },
    pi: { part: 'pi', env: ['PI_CODING_AGENT_DIR=/ahpd/pi'], state: '/ahpd/pi', seed: ['~/.pi/agent/settings.json', '~/.pi/agent/models.json'] },
    dsh: { part: 'dsh', env: ['DSH_HOME=/ahpd/dsh'], state: '/ahpd/dsh', seed: ['~/.dsh/profiles/acp'] },
    copapo: {
      part: 'copapo',
      env: ['XDG_CONFIG_HOME=/ahpd/copapo/config', 'XDG_DATA_HOME=/ahpd/copapo/data', 'COFOLD_HOME=/ahpd/copapo/home'],
      state: '/ahpd/copapo',
      seed: ['~/.config/copapo/config.json'],
    },
    devin: {
      part: 'devin',
      env: ['XDG_CONFIG_HOME=/ahpd/devin/config', 'XDG_DATA_HOME=/ahpd/devin/data'],
      state: '/ahpd/devin',
      seed: ['~/.config/devin/config.json', '~/.config/devin/mcp_config.json'],
    },
    cursor: { part: 'cursor', env: ['CURSOR_CONFIG_DIR=/ahpd/cursor'], state: '/ahpd/cursor', seed: ['~/.cursor/cli-config.json'] },
    amp: { part: 'amp', env: ['AMP_CLI_PATH=amp'] },
    qwen: { part: 'qwen', env: ['QWEN_HOME=/ahpd/qwen'], state: '/ahpd/qwen', seed: ['~/.qwen/settings.json'] },
  });
  // No seed is a login or token file.
  const seeds = JSON.stringify(rows);
  for (const login of ['auth.json', '.copilot/config.json', 'credentials', 'oauth']) expect(seeds).not.toContain(login);
});

/*
 * A shipped row's machine runs what its part ships: the command it starts,
 * and any binary a `*_CLI_PATH` variable points its server at, are each a
 * launcher in that part's `bin`, so a machine with nothing installed runs it.
 */
it('runs only commands its part ships, for every shipped row with a part', () => {
  const parts = new Map(readParts().map((one) => [one.id, one.bin]));
  const missing: string[] = [];
  for (const [id, preset] of Object.entries(presets)) {
    const part = preset.machine?.part;
    if (part === undefined) continue;
    const bins = parts.get(part) ?? [];
    const runs = [
      preset.command,
      ...Object.entries(preset.machine?.env ?? {}).flatMap(([key, value]) => (key.endsWith('_CLI_PATH') && typeof value === 'string' ? [value] : [])),
    ];
    for (const command of runs) {
      if (!bins.includes(command)) missing.push(`${id} runs ${command}, which the ${part} part does not ship`);
    }
  }
  expect(missing).toEqual([]);
});
