import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { gitWorktrees } from '../../sdk/src/repo/worktrees.js';
import { describePlugin, loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
import type { HostOptions, HostTool, ToolCall } from '../../sdk/src/types/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * The package as a plugin: the loader, the scheme and the tools.
 *
 * The `docker` the runtime spawns is the scripted fixture, so what is under
 * test is that the provider and the tools reach a command at all and that the
 * host serves what came back. No daemon is asked for anything.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(async () => {
  // Everything the test started, closed before its folders go.
  await closeAll();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

/*
 * The state directory a load is given, which is a temporary one of its own.
 *
 * A load with this repository as its state directory writes into the checkout:
 * a machine made on a linked worktree leaves `computers.gitfile` at whatever
 * `configDir` names, and a test that did that put a file in the repository.
 */
let home: string | undefined;
const stateDir = (): string => (home ??= mkdtempSync(join(tmpdir(), 'ahpd-computer-config-')));

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** One backend the daemon would have had anyway, so the provider is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/computer',
  agents: [{ ...echo({ path: '/tmp/computer', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const load = async (
  options: Record<string, unknown>,
  more: Partial<HostOptions> = {},
  log: (line: string) => void = () => {},
) => {
  const result = await loadPlugins(
    [{ name: SOURCE, options }],
    { base: { ...base(), ...more }, configDir: stateDir(), cwd: REPO, log },
  );
  keeping(result.options);
  return result;
};

const at = {} as ToolCall;
const tool = (tools: HostTool[], name: string) => tools.find((one) => one.definition.name === name) as HostTool;

it('serves computer: through the host and offers the three tools', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-'));
  const state = join(loose, 'docker.json');
  const { options, loaded, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
  });

  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual(['ahpd-computer']);
  expect(Object.keys(options.resourceProviders ?? {})).toEqual(['computer']);
  const tools = options.tools ?? [];
  expect(tools.map((one) => one.definition.name)).toEqual([
    'request_disposable_computer', 'release_computer', 'computer_exec',
  ]);

  // A machine is made by the tool, which is the only thing that makes one.
  expect(String(await tool(tools, 'request_disposable_computer').run({ name: 'box' }, at))).toContain('computer://box');

  const host = createHost(options);
  keeping(options, host);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });

  const listed = await client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://' },
  }) as { entries: { name: string }[] };
  expect(listed.entries.map((one) => one.name)).toEqual(['box']);

  const status = await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'computer://box/status' },
  }) as { data: string; contentType?: string };
  expect(status.contentType).toBe('application/json');
  expect(JSON.parse(status.data)).toMatchObject({ Name: '/box', Image: 'debian:bookworm-slim' });

  // The commands the provider ran are in the fixture's own record, which is the
  // proof it spawned something rather than answering from a stub.
  const record = JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][] };
  expect(record.calls.some((one) => one[0] === 'run')).toBe(true);
  expect(record.calls.some((one) => one[0] === 'ps')).toBe(true);
  expect(record.calls.some((one) => one[0] === 'inspect')).toBe(true);

  expect(String(await tool(tools, 'release_computer').run({ id: 'box' }, at))).toContain('gone');
  const after = await client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://' },
  }) as { entries: unknown[] };
  expect(after.entries).toEqual([]);
});

it('withholds the three tools from a session until the host permits advanced tools', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-gate-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
  });

  const names = async (advancedTools: boolean) => {
    const host = createHost({ ...options, advancedTools });
    keeping(options, host);
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/gate', provider: 'base' } });
    const seen = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/gate' } }) as {
      snapshot: { state: { serverTools?: { name: string }[] } };
    }).snapshot.state.serverTools?.map((one) => one.name) ?? [];
    return seen;
  };

  // The plugin contributed them either way; it is the host that decides.
  expect((options.tools ?? []).map((one) => one.definition.name)).toContain('request_disposable_computer');
  expect(await names(false)).not.toContain('request_disposable_computer');
  expect(await names(true)).toContain('request_disposable_computer');
});

it('contributes the computer session setting, and the default the operator chose', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-key-'));
  const state = join(loose, 'docker.json');
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionDefault: 'computer://box',
  });

  expect(problems).toEqual([]);
  expect(Object.keys(options.sessionConfig ?? {})).toEqual(['computer']);

  const host = createHost(options);
  keeping(options, host);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/key', provider: 'base' } });
  const config = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/key' } }) as {
    snapshot: { state: { config?: { schema?: { properties?: Record<string, unknown> }; values?: Record<string, unknown> } } };
  }).snapshot.state.config;
  expect(Object.keys(config?.schema?.properties ?? {})).toContain('computer');
  expect(config?.values?.computer).toBe('computer://box');
});

it('refuses a session default that is not a computer URI, and can leave the key out', async () => {
  const bad = await load({ sessionDefault: 'box' });
  expect(bad.loaded).toEqual([]);
  expect(bad.problems[0]).toContain('computer://<id>');

  const none = await load({ sessionSetting: false });
  expect(none.options.sessionConfig ?? {}).toEqual({});
});

it('advertises the scheme on the handshake, before any machine exists', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-meta-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });

  const host = createHost(options);
  keeping(options, host);
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { _meta?: Record<string, { [scheme: string]: { title: string; root: string; operations: string[]; manifest: { properties: Record<string, { default?: string }> } } }> };

  const entry = ready._meta?.['ahpd.resourceProviders']?.computer;
  expect(entry?.title).toBe('Computer');
  expect(entry?.root).toBe('computer://');
  // The host derives these from the provider's methods, not from a claim.
  expect(entry?.operations).toEqual(['get', 'list', 'resolve', 'put', 'delete']);
  expect(entry?.manifest.properties.image?.default).toBe('debian:bookworm-slim');
});

it('answers how to reach a machine, and nothing for one that is not there', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-port-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });

  expect(options.computers).toBeDefined();
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  };
  await provider.write('computer://box', { data: JSON.stringify({}), encoding: 'utf-8' });

  // A caller's `cwd` is a path on *this host*, so it only reaches `-w` when a
  // mount makes it the same place inside; this machine has none, so the
  // machine's own directory stands and a host path is not passed in.
  const how = await options.computers?.how('box', {
    command: 'node', args: ['server.mjs'], cwd: '/work', env: { A: '1' },
  });
  expect(how).toEqual({
    command: process.execPath,
    // The variable by name only, so a process list shows no value.
    args: [FIXTURE, 'exec', '-i', '-e', 'A', 'box', 'node', 'server.mjs'],
    // The docker program's own environment, which is the plugin's, with the
    // asked value laid over it for `-e A` to read.
    env: { DOCKER_FAKE_STATE: state, A: '1' },
  });

  // With no directory named, the machine's own is the only one that means
  // anything in there: a host path would be a `-w` of a directory it lacks.
  const inside = await options.computers?.how('box', { command: 'node' });
  expect(inside?.args).toEqual([FIXTURE, 'exec', '-i', 'box', 'node']);

  // A machine that is not there is not a spawn descriptor.
  expect(await options.computers?.how('nope', { command: 'node' })).toBeUndefined();
});

/*
 * Every asked value reaches `docker exec` by name, with the value in the
 * environment the descriptor says to spawn `docker` with: an argv is in every
 * user's process list, an environment is not. The names `docker` itself reads
 * stay `NAME=VALUE`, since in docker's own environment they would change how
 * docker runs.
 */
it('passes each asked variable by name, and keeps the names docker reads as written', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-byname-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  };
  await provider.write('computer://box', { data: JSON.stringify({}), encoding: 'utf-8' });

  const how = await options.computers?.how('box', {
    command: 'node', env: { PATH: '/opt/x/bin:/usr/bin', KEY: 'secret-value' },
  });
  expect(how?.args).toEqual([FIXTURE, 'exec', '-i', '-e', 'PATH=/opt/x/bin:/usr/bin', '-e', 'KEY', 'box', 'node']);
  expect(how?.args.some((one) => one.includes('secret-value'))).toBe(false);
  expect(how?.env?.KEY).toBe('secret-value');
  // The asked PATH is the machine's, not the one docker is run with.
  expect(how?.env?.PATH).toBeUndefined();

  // Spawned as a backend spawns it, the command in the machine has the value
  // and no argv the scripted docker saw does.
  const outer: Record<string, string | undefined> = { ...process.env };
  delete outer.KEY;
  const ran = spawnSync(how?.command ?? '', how?.args ?? [], { env: { ...outer, ...how?.env }, encoding: 'utf8' });
  expect(ran.status, ran.stderr).toBe(0);
  const record = JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][]; commands: { env: Record<string, string> }[] };
  expect(record.commands.at(-1)?.env).toEqual({ PATH: '/opt/x/bin:/usr/bin', KEY: 'secret-value' });
  expect(record.calls.flat().filter((one) => one.includes('secret-value'))).toEqual([]);

  // A backend that spawns the args and drops the descriptor's env loses the
  // value, and the scripted docker refuses rather than running without it.
  const dropped = spawnSync(how?.command ?? '', how?.args ?? [], { env: { ...outer, DOCKER_FAKE_STATE: state }, encoding: 'utf8' });
  expect(dropped.status).not.toBe(0);
  expect(dropped.stderr).toContain('-e KEY');
});

/*
 * Every `DOCKER_*` name is docker's own: in its environment it would choose the
 * daemon, the context or the configuration docker uses. So a machine's variable
 * under one of those names stays in argv and never reaches the environment
 * docker is spawned with.
 */
it('keeps every DOCKER_ name out of the environment docker is spawned with', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-dockerown-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  };
  await provider.write('computer://box', { data: JSON.stringify({}), encoding: 'utf-8' });

  const how = await options.computers?.how('box', {
    command: 'node', env: { DOCKER_CONTEXT: 'elsewhere', DOCKER_CONFIG: '/tmp/other-config', KEY: 'v' },
  });
  expect(how?.args).toEqual([
    FIXTURE, 'exec', '-i', '-e', 'DOCKER_CONTEXT=elsewhere', '-e', 'DOCKER_CONFIG=/tmp/other-config', '-e', 'KEY', 'box', 'node',
  ]);
  expect(how?.env).toEqual({ DOCKER_FAKE_STATE: state, KEY: 'v' });

  const ran = spawnSync(how?.command ?? '', how?.args ?? [], { env: { ...process.env, ...how?.env }, encoding: 'utf8' });
  expect(ran.status, ran.stderr).toBe(0);
  const record = JSON.parse(readFileSync(state, 'utf8')) as { commands: { env: Record<string, string>; dockerEnv: string[] }[] };
  // The machine has them, and docker was not run with them.
  expect(record.commands.at(-1)?.env).toMatchObject({ DOCKER_CONTEXT: 'elsewhere', DOCKER_CONFIG: '/tmp/other-config' });
  expect(record.commands.at(-1)?.dockerEnv).not.toContain('DOCKER_CONTEXT');
  expect(record.commands.at(-1)?.dockerEnv).not.toContain('DOCKER_CONFIG');
});

it('reports a runtime it does not have at load, rather than failing later', async () => {
  const { loaded, problems } = await load({ runtime: 'kvm' });
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('runtime must be one of docker');
});

it('lists its manifest and title without importing the entry', async () => {
  /*
   * A manifest in its own directory rather than this package's: `describePlugin`
   * resolves `ahpd.entry`, which names the `dist` build, and `pnpm test` runs
   * before `pnpm build`. The entry here throws if it is ever imported, which is
   * what a listing must not do.
   */
  const real = JSON.parse(readFileSync(join(REPO, 'packages/computer/package.json'), 'utf8')) as {
    ahpd: Record<string, unknown>;
  };
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-computer-listing-'));
  loose = dir;
  writeFileSync(join(dir, 'entry.js'), 'throw new Error("a listing imported the entry");\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@ahpd/computer',
    private: true,
    type: 'module',
    exports: { '.': './entry.js' },
    ahpd: { ...real.ahpd, entry: './entry.js' },
  }));

  const row = await describePlugin(dir, { configDir: stateDir(), cwd: REPO });
  expect(row.state).toBe('ready');
  // The key is the directory as written; the package's own name is `module`.
  expect(row.name).toBe(dir);
  expect(row.module).toBe('@ahpd/computer');
  expect(row.title).toBe('Computer');
});

it('reads a host path through the machine mounts, or falls back to its workdir', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-within-'));
  const state = join(loose, 'docker.json');
  // A mount's host path is checked at create, so the three sources are made
  // here rather than named as paths this host happens not to have.
  const srv = join(loose, 'srv');
  const app = join(srv, 'app');
  const claude = join(loose, 'claude');
  mkdirSync(app, { recursive: true });
  mkdirSync(claude);
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    // The mapping is the same whoever named the mounts; a body is the shortest
    // way to name three of them in one place.
    bodyMounts: true,
  });
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  };
  /*
   * Two mounts, one nested inside the other, and a working directory besides.
   *
   * The nested one is the case a shortest-match would get wrong: the outer
   * source covers the inner one too, and the answer a person means is the
   * mount that actually holds it.
   */
  await provider.write('computer://box', {
    data: JSON.stringify({
      mounts: [`${srv}:/mnt/srv`, `${app}:/workspaces/app`, `${claude}:/ahpd/claude`],
      workdir: '/workspaces/app',
    }),
    encoding: 'utf-8',
  });

  const where = async (cwd?: string): Promise<string | undefined> => {
    const said = await options.computers?.how('box', { command: 'node', ...(cwd === undefined ? {} : { cwd }) });
    const at = said?.args.indexOf('-w') ?? -1;
    return at === -1 ? undefined : said?.args[at + 1];
  };

  // The longest source wins, so the nested mount answers for its own subtree.
  expect(await where(app)).toBe('/workspaces/app');
  expect(await where(join(app, 'src/deep'))).toBe('/workspaces/app/src/deep');
  // And the outer one still answers for everything it alone covers.
  expect(await where(join(srv, 'other'))).toBe('/mnt/srv/other');
  // A mount's own root maps to the target itself, with no trailing slash.
  expect(await where(claude)).toBe('/ahpd/claude');
  // A path no mount covers is not a directory in there at all, so the
  // machine's own working directory stands rather than a host path.
  expect(await where(join(loose, 'elsewhere'))).toBe('/workspaces/app');
  // A near miss is not a match: the outer source must not cover `srvs`.
  expect(await where(`${srv}s`)).toBe('/workspaces/app');
  // Nothing named is the machine's own, as before.
  expect(await where()).toBe('/workspaces/app');
});

it('reports what a machine is using, as numbers a gauge can be drawn from', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-stats-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
    read(uri: string): Promise<{ data: string }>;
    list(uri: string): Promise<{ name: string }[]>;
  };
  await provider.write('computer://box', { data: JSON.stringify({ cpus: '2' }), encoding: 'utf-8' });

  // The leaf is listed, so a client that browses finds it rather than having
  // to know the name.
  expect((await provider.list('computer://box')).map((one) => one.name)).toContain('stats');

  const used = JSON.parse((await provider.read('computer://box/stats')).data) as {
    running: boolean;
    cpu: { percent: number; cores?: number };
    memory: { used: number; limit: number; percent: number };
    pids?: number;
    network?: { rx: number; tx: number };
  };
  expect(used.running).toBe(true);
  // The runtime's display text, read as numbers: `444KiB` is binary and
  // `1.01kB` is decimal, in the same payload, which is docker's own habit.
  expect(used.memory.used).toBe(444 * 1024);
  expect(used.memory.limit).toBe(512 * 1024 * 1024);
  expect(used.memory.percent).toBe(0.08);
  expect(used.cpu.percent).toBe(12.5);
  expect(used.network?.rx).toBe(1010);
  expect(used.pids).toBe(7);
  // The cores the machine was limited to, so a percentage of one core's time
  // means something: 150% is busy on two and impossible on one.
  expect(used.cpu.cores).toBe(2);
});

it('makes a machine from a named profile, and refuses one it does not define', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-profiles-'));
  const state = join(loose, 'docker.json');
  // Every mount's host path is checked at create, so both are directories this
  // host has.
  const shared = join(loose, 'shared');
  const claude = join(loose, 'claude');
  mkdirSync(shared);
  mkdirSync(claude);
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    // One line the operator writes, which is the whole point: what a machine
    // is given stops being three mount strings a person retypes correctly.
    mounts: [`${shared}:/shared`],
    profiles: {
      claude: {
        title: 'Claude',
        description: 'The CLI and this host configuration.',
        image: 'node:22',
        cpus: '2',
        memory: '512m',
        mounts: [`${claude}:/ahpd/claude`],
        workdir: '/work',
      },
      plain: { image: 'debian:bookworm-slim' },
    },
  });

  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
    describe(): { manifest?: { properties?: Record<string, { enum?: unknown[] }> } };
  };

  // Published in the schema, so a client draws the picker with no new
  // protocol and no code of its own.
  const picker = provider.describe().manifest?.properties?.profile;
  expect(picker?.enum).toEqual(['claude', 'plain']);

  await provider.write('computer://box', {
    data: JSON.stringify({ profile: 'claude', workdir: '/mine' }),
    encoding: 'utf-8',
  });
  const made = JSON.parse(readFileSync(state, 'utf-8')) as { machines: Record<string, unknown>[] };
  const box = made.machines.find((one) => one.name === 'box') as Record<string, unknown>;
  expect(box.image).toBe('node:22');
  expect(box.cpus).toBe('2');
  expect(box.memory).toBe('512m');
  // The body's own field beats the profile's, so a profile is a default and
  // never a ceiling.
  expect(box.workdir).toBe('/mine');
  // Widest first: the deployment's, then the profile's.
  expect(box.mounts).toEqual([`${shared}:/shared`, `${claude}:/ahpd/claude`]);

  // Named and unknown is refused, because silently getting a machine with
  // none of the profile's mounts fails later and further away.
  await expect(provider.write('computer://other', {
    data: JSON.stringify({ profile: 'nope' }),
    encoding: 'utf-8',
  })).rejects.toThrow(/no profile called nope; it has claude, plain/);
});

/*
 * Plan host/67 task 01: a profile's `gitGuard` is `fetch`, the default, or
 * `open` - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 *
 * A profile written for the guard this plan removes says `bind`, which is read
 * as `fetch` with one line naming the profile, so the safest layout is what an
 * old file gets. What this task changes is the reading, so the answer is asked
 * where it is used: the machine a session makes from the profile. Under
 * `fetch` the machine runs as the host user, which is half of what that guard
 * means; under `open` at a repository root it keeps the image's user.
 */
const repositoryAt = (dir: string): { repo: string; gitDir: string } => {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) => spawnSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  return { repo, gitDir: join(repo, '.git') };
};

/**
 * One host with the git port, and the machine a session makes from a profile.
 *
 * The folder the session works in is `<state>/../repo` unless another is named,
 * which is the repository `repositoryAt` makes beside it.
 */
const guardOf = async (
  state: string,
  profiles: Record<string, unknown>,
  folder?: string,
): Promise<{ argv: string[]; user?: string | undefined; error?: string | undefined }> => {
  const lines: string[] = [];
  const loaded = await load(
    { command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: state }, profiles },
    { worktrees: gitWorktrees() },
    (line) => lines.push(line),
  );
  if (loaded.problems.length > 0) return { argv: [], error: loaded.problems.map((one) => String(one)).join('\n') };
  const host = createHost(loaded.options);
  keeping(loaded.options, host);
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  let failed: unknown;
  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/guard',
      provider: 'base',
      config: { computer: 'disposable:claude' },
      workingDirectories: [folder ?? join(state, '..', 'repo')],
    },
  }).catch((error: unknown) => { failed = error; });
  if (failed !== undefined) {
    return { argv: [], error: failed instanceof Error ? failed.message : String(failed) };
  }
  const made = JSON.parse(readFileSync(state, 'utf8')) as { machines: { name: string }[]; calls: string[][] };
  const argv = made.calls.find((one) => one[0] === 'run') ?? [];
  const at = argv.indexOf('--user');
  return { argv, user: at === -1 ? undefined : argv[at + 1] };
};

it('reads a profile\'s gitGuard as fetch, taking bind as fetch and keeping open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-computer-guard-'));
  loose = dir;
  repositoryAt(dir);
  const me = `${String(process.getuid?.())}:${String(process.getgid?.())}`;

  // Spelled out, and left out: both are `fetch`, the default.
  for (const [key, profile] of [
    ['spelled', { image: 'node:22', disposable: true, sessionFolder: true, gitGuard: 'fetch' }],
    ['silent', { image: 'node:22', disposable: true, sessionFolder: true }],
    ['old', { image: 'node:22', disposable: true, sessionFolder: true, gitGuard: 'bind' }],
  ] as [string, Record<string, unknown>][]) {
    const { user, error } = await guardOf(join(dir, `${key}.json`), { claude: profile });
    expect(error, key).toBeUndefined();
    expect(user, key).toBe(me);
  }

  // And the old word is not silent about it: one line, naming the profile.
  const lines: string[] = [];
  await load(
    { command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: join(dir, 'log.json') },
      profiles: { claude: { image: 'node:22', gitGuard: 'bind' } } },
    {},
    (line) => lines.push(line),
  );
  expect(lines.filter((line) => line.includes('profiles.claude.gitGuard is bind'))).toHaveLength(1);

  // `open` is unchanged: at a repository root it keeps the image's user.
  const opened = await guardOf(join(dir, 'open.json'), {
    claude: { image: 'node:22', disposable: true, sessionFolder: true, gitGuard: 'open' },
  });
  expect(opened.error).toBeUndefined();
  expect(opened.user).toBeUndefined();

  // And a third answer is refused, naming the three a profile may give.
  const refused = await guardOf(join(dir, 'closed.json'), {
    claude: { image: 'node:22', gitGuard: 'closed' },
  });
  expect(refused.error).toMatch(/profiles\.claude\.gitGuard/);
  expect(refused.error).toMatch(/fetch/);
  expect(refused.error).toMatch(/open/);
  expect(refused.error).toMatch(/bind/);
});

/*
 * Plan host/67 task 09: a profile's `sessionTree` is `shared`, the default, or
 * `copy` - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 *
 * `shared` is the layout every task before this one built: the host's tree is
 * bound into the machine at its own path, read-write, so the host sees the
 * agent's edits as it makes them. `copy` gives the machine a checkout of its
 * own in the volume it commits into, mounted at the tree's own path, with
 * nothing of the host's tree bound - what reaches the host of the agent's work
 * is what the fetch brings back.
 *
 * A folder that is not a repository has nothing to copy: the machine is refused
 * rather than made with the host's folder bound, which is what `copy` promises
 * it does not do.
 */
it('reads a profile\'s sessionTree as shared, and copies the tree where it says copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-computer-tree-'));
  loose = dir;
  const { repo } = repositoryAt(dir);
  // A volume of the machine's own, its own path marked by the name it carries.
  const ownVolume = (argv: string[]): string[] =>
    argv.filter((one) => one.startsWith('ahpd-git-') && one.endsWith(`:${repo}`));

  // Spelled out, and left out: both are `shared`, and the host's tree is bound
  // into the machine at its own path, with the machine's git directory in its
  // volume beside it.
  for (const [key, profile] of [
    ['spelled', { image: 'node:22', disposable: true, sessionFolder: true, sessionTree: 'shared' }],
    ['silent', { image: 'node:22', disposable: true, sessionFolder: true }],
  ] as [string, Record<string, unknown>][]) {
    const { argv, error } = await guardOf(join(dir, `${key}.json`), { claude: profile });
    expect(error, key).toBeUndefined();
    expect(argv, key).toContain(`${repo}:${repo}`);
    expect(ownVolume(argv), key).toEqual([]);
  }

  // Under `copy` the tree is the machine's own: nothing of the host's folder is
  // bound, and the volume is mounted at the tree's own path instead.
  const copied = await guardOf(join(dir, 'copy.json'), {
    claude: { image: 'node:22', disposable: true, sessionFolder: true, sessionTree: 'copy' },
  });
  expect(copied.error).toBeUndefined();
  expect(copied.argv).not.toContain(`${repo}:${repo}`);
  expect(ownVolume(copied.argv)).toHaveLength(1);
});

it('refuses a profile whose sessionTree is neither shared nor copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-computer-tree-'));
  loose = dir;
  repositoryAt(dir);
  // A third answer is refused at load, naming the two a profile may give.
  const refused = await guardOf(join(dir, 'both.json'), {
    claude: { image: 'node:22', sessionTree: 'both' },
  });
  expect(refused.error).toMatch(/profiles\.claude\.sessionTree/);
  expect(refused.error).toMatch(/shared/);
  expect(refused.error).toMatch(/copy/);
});

it('refuses a machine asked to copy a folder that is not a repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-computer-plain-'));
  loose = dir;
  mkdirSync(join(dir, 'plain'));
  /*
   * A folder that is not a repository has no commit for a copy to be made at,
   * so there is no checkout for the machine to work in and nothing for a fetch
   * to bring back. The machine is refused - rather than made with the host's
   * folder bound, which is exactly what `copy` promises it does not do, or with
   * an empty volume, which would lose everything the agent wrote in it.
   */
  const plain = await guardOf(join(dir, 'plain.json'), {
    claude: { image: 'node:22', disposable: true, sessionFolder: true, sessionTree: 'copy' },
  }, join(dir, 'plain'));
  expect(plain.error).toMatch(/sessionTree copy/);
  expect(plain.error).toMatch(/not a repository/);

  // While `shared`, which binds the folder as it always did, is made as before.
  const shared = await guardOf(join(dir, 'shared.json'), {
    claude: { image: 'node:22', disposable: true, sessionFolder: true },
  }, join(dir, 'plain'));
  expect(shared.error).toBeUndefined();
  expect(shared.argv).toContain(`${join(dir, 'plain')}:${join(dir, 'plain')}`);
});

/*
 * A container this provider did not make is not a computer.
 *
 * The listing always filtered on the label and nothing else did, so a name
 * that reached `inspect` was inspected: `computer://<anything docker runs>`
 * read another container's whole record - its environment, its mounts - and
 * the verbs that go through `inspect` first reached it too, which made
 * `computer:write` a way to stop and destroy containers nobody here made.
 */
/*
 * A pattern the matcher will not read is an operator's mistake, said out loud.
 *
 * A `*` inside a name is partial matching within a component, which is where
 * the subtle holes live. Read as a literal it would be a rule that matches
 * nothing - an allowlist entry that quietly allows nothing is worse than one
 * that fails to load.
 */
/*
 * The key a plugin contributed answers its own picker.
 *
 * A contributed key reaches every client through the session schema, and a
 * property with no `enum` reads as a fact somebody types rather than a
 * question with answers - so `computer` arrived at VS Code and at a terminal
 * client as a text box, and only a client holding code for that key by name
 * could draw a machine picker. The plugin knows what is running; nothing else
 * does.
 */
it('answers the computer picker with the machines it has', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-picker-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
  });
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  };
  await provider.write('computer://box', { data: '{}', encoding: 'utf-8' });
  await provider.write('computer://other', { data: '{}', encoding: 'utf-8' });

  // The fold marks the property, because the pair has to agree: a schema that
  // claimed `enumDynamic` with nobody registered would draw an empty picker.
  expect(options.sessionConfig?.computer).toMatchObject({ type: 'string', enumDynamic: true });

  const answerer = options.sessionConfigCompletions?.computer;
  expect(answerer).toBeDefined();
  const all = await (answerer as NonNullable<typeof answerer>)({ property: 'computer', query: '' });
  // Empty first, because it is the default and the way back: a session with no
  // machine runs on this host.
  expect(all[0]).toMatchObject({ value: '', label: 'This host' });
  expect(all.map((one) => one.value)).toEqual(['', 'computer://box', 'computer://other']);
  expect(all[1]?.description).toContain('debian:bookworm-slim');

  // What was typed narrows it, and drops the one that is not a machine.
  const some = await (answerer as NonNullable<typeof answerer>)({ property: 'computer', query: 'oth' });
  expect(some.map((one) => one.value)).toEqual(['computer://other']);
});

it('will not load with an image pattern it cannot read', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-pattern-'));
  const state = join(loose, 'docker.json');
  const { problems, loaded } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    images: ['node:22-*'],
  });
  expect(loaded).toEqual([]);
  expect(problems.map((one) => String(one))).toContainEqual(
    expect.stringMatching(/has a \* inside 22-\*/),
  );
});

it('will not read, stop or destroy a container it did not make', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-scope-'));
  const state = join(loose, 'docker.json');
  // Something else's, running on the same daemon, with no label of ours.
  writeFileSync(state, JSON.stringify({
    machines: [{ name: 'someone-elses', image: 'redis:7', labels: {}, bare: true }],
    calls: [],
  }));
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });
  const provider = options.resourceProviders?.computer as {
    read(uri: string): Promise<{ data: string }>;
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
    remove(uri: string): Promise<void>;
    list(uri: string): Promise<{ name: string }[]>;
  };

  // Not listed, which it never was, and now not reachable by name either.
  expect((await provider.list('computer://')).map((one) => one.name)).toEqual([]);
  await expect(provider.read('computer://someone-elses/status')).rejects.toThrow(/No computer resource/);
  await expect(provider.write('computer://someone-elses/state', { data: 'stopped', encoding: 'utf-8' }))
    .rejects.toThrow(/No computer resource/);
  await expect(provider.remove('computer://someone-elses')).rejects.toThrow(/No computer resource/);

  // And nothing was run at it: the refusal is this host's, not docker's.
  const held = JSON.parse(readFileSync(state, 'utf-8')) as { calls: string[][] };
  expect(held.calls.some((one) => one.includes('stop') || one.includes('rm'))).toBe(false);
});

it('starts, stops and restarts a machine by writing what it should be', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-state-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
  });
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
    read(uri: string): Promise<{ data: string }>;
    list(uri: string): Promise<{ name: string }[]>;
  };
  const put = (uri: string, said: string): Promise<void> =>
    provider.write(uri, { data: said, encoding: 'utf-8' });

  await put('computer://box', JSON.stringify({}));
  expect((await provider.list('computer://box')).map((one) => one.name)).toContain('state');
  expect((await provider.read('computer://box/state')).data.trim()).toBe('running');

  /*
   * A resource scheme has no `restart` verb, so the action is a write to what
   * the machine is. That keeps it inside `computer:write`, the same grant that
   * makes and destroys one, rather than needing a method of its own.
   */
  await put('computer://box/state', 'stopped');
  // The word it answers is one the write takes, so a client that reads this
  // leaf and writes it back is not refused its own reading.
  expect((await provider.read('computer://box/state')).data.trim()).toBe('stopped');
  await put('computer://box/state', 'running');
  expect((await provider.read('computer://box/state')).data.trim()).toBe('running');
  await put('computer://box/state', 'restarted');
  expect((await provider.read('computer://box/state')).data.trim()).toBe('running');

  // A word nobody serves is a sentence about the body, not a docker error.
  await expect(put('computer://box/state', 'rebooted'))
    .rejects.toThrow(/state is one of running, stopped, restarted/);
  // And a leaf that is not writable says what is.
  await expect(put('computer://box/status', 'anything'))
    .rejects.toThrow(/not something to write/);
  // A machine that is not there is not a thing to start.
  await expect(put('computer://gone/state', 'running')).rejects.toThrow();
});
