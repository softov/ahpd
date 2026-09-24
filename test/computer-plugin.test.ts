import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { describePlugin, loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions, HostTool, ToolCall } from '../packages/sdk/src/types/host.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The package as a plugin: the loader, the scheme and the tools.
 *
 * The `docker` the runtime spawns is the scripted fixture, so what is under
 * test is that the provider and the tools reach a command at all and that the
 * host serves what came back. No daemon is asked for anything.
 */

const REPO = join(import.meta.dirname, '..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** One backend the daemon would have had anyway, so the provider is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/computer',
  agents: [{ ...echo({ path: '/tmp/computer', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const load = (options: Record<string, unknown>) => loadPlugins(
  [{ name: SOURCE, options }],
  { base: base(), configDir: REPO, cwd: REPO, log: () => {} },
);

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
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { _meta?: Record<string, { [scheme: string]: { title: string; root: string; operations: string[]; manifest: { properties: Record<string, { default?: string }> } } }> };

  const entry = ready._meta?.['ahpd.resourceProviders']?.computer;
  expect(entry?.title).toBe('Computer');
  expect(entry?.root).toBe('computer://');
  // The host derives these from the provider's methods, not from a claim.
  expect(entry?.operations).toEqual(['read', 'list', 'resolve', 'write', 'delete']);
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
    args: [FIXTURE, 'exec', '-i', '-e', 'A=1', 'box', 'node', 'server.mjs'],
    // The docker program's own environment, which is the plugin's and not the machine's.
    env: { DOCKER_FAKE_STATE: state },
  });

  // With no directory named, the machine's own is the only one that means
  // anything in there: a host path would be a `-w` of a directory it lacks.
  const inside = await options.computers?.how('box', { command: 'node' });
  expect(inside?.args).toEqual([FIXTURE, 'exec', '-i', 'box', 'node']);

  // A machine that is not there is not a spawn descriptor.
  expect(await options.computers?.how('nope', { command: 'node' })).toBeUndefined();
});

it('reports a runtime it does not have at load, rather than failing later', async () => {
  const { loaded, problems } = await load({ runtime: 'kvm' });
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('kvm');
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

  const row = await describePlugin(dir, { configDir: REPO, cwd: REPO });
  expect(row.state).toBe('ready');
  expect(row.name).toBe('@ahpd/computer');
  expect(row.title).toBe('Computer');
});

it('reads a host path through the machine mounts, or falls back to its workdir', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-within-'));
  const state = join(loose, 'docker.json');
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
   * The nested one is the case a shortest-match would get wrong: `/srv` covers
   * `/srv/app/x` too, and the answer a person means is the mount that actually
   * holds it.
   */
  await provider.write('computer://box', {
    data: JSON.stringify({
      mounts: ['/srv:/mnt/srv', '/srv/app:/workspaces/app', '/home/me/.claude:/ahpd/claude'],
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
  expect(await where('/srv/app')).toBe('/workspaces/app');
  expect(await where('/srv/app/src/deep')).toBe('/workspaces/app/src/deep');
  // And the outer one still answers for everything it alone covers.
  expect(await where('/srv/other')).toBe('/mnt/srv/other');
  // A mount's own root maps to the target itself, with no trailing slash.
  expect(await where('/home/me/.claude')).toBe('/ahpd/claude');
  // A path no mount covers is not a directory in there at all, so the
  // machine's own working directory stands rather than a host path.
  expect(await where('/elsewhere')).toBe('/workspaces/app');
  // A near miss is not a match: `/srv` must not cover `/srvx`.
  expect(await where('/srvx')).toBe('/workspaces/app');
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
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    // One line the operator writes, which is the whole point: what a machine
    // is given stops being three mount strings a person retypes correctly.
    mounts: ['/shared:/shared'],
    profiles: {
      claude: {
        title: 'Claude',
        description: 'The CLI and this host configuration.',
        image: 'node:22',
        cpus: '2',
        memory: '512m',
        mounts: ['/home/me/.claude:/ahpd/claude'],
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
  expect(box.mounts).toEqual(['/shared:/shared', '/home/me/.claude:/ahpd/claude']);

  // Named and unknown is refused, because silently getting a machine with
  // none of the profile's mounts fails later and further away.
  await expect(provider.write('computer://other', {
    data: JSON.stringify({ profile: 'nope' }),
    encoding: 'utf-8',
  })).rejects.toThrow(/no profile called nope; it has claude, plain/);
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
