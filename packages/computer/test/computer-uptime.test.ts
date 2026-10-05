import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { memorySessions } from '../../sdk/src/sessions.js';
import { raise } from '../../sdk/src/plugins.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Principal, Users } from '../../sdk/src/types/users.js';
import type { Usage, UsageEntry, UsageTotal } from '../../sdk/src/types/usage.js';

/*
 * The up time a machine is charged for.
 *
 * A stretch opens when a machine starts and is written whole when it stops,
 * charged to whoever made the machine - decision
 * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`. Only the
 * clock is faked, so the seconds a record carries are the ones this test chose
 * rather than however long a subprocess took.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const DEV = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  vi.useRealTimers();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-uptime-'));
  return loose;
};

/** One machine the fixture already holds, with the state and labels given. */
interface Seeded {
  name: string;
  labels: Record<string, string>;
  state?: string;
}

const seeded = (state: string, ...machines: Seeded[]): void =>
  writeFileSync(state, JSON.stringify({
    machines: machines.map((one) => ({ ...one, image: 'node:22' })),
    calls: [],
  }));

/** What the scripted Docker holds. */
interface DockerHeld {
  machines: { name: string; image: string; state?: string }[];
  calls: string[][];
}
const dockerHeld = (state: string): DockerHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DockerHeld
  : { machines: [], calls: [] });

const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

/**
 * Wait for the plugin's unawaited startup listing to have opened what it found.
 *
 * Opening a stretch answers nothing anywhere, so the wait is for the one line
 * the plugin says after it: a disposable machine found at startup is logged by
 * its own id, and the log comes after its stretch opened.
 */
const listed = async (lines: string[], id: string): Promise<void> => {
  await until(() => lines.some((one) => one.includes(`found the disposable machine ${id}`)));
};

/** The store in memory, so a test can read what the plugin wrote. */
function meter(): Usage & { entries: UsageEntry[] } {
  const entries: UsageEntry[] = [];
  return {
    entries,
    record: async (entry: UsageEntry) => { entries.push(entry); },
    total: async (): Promise<UsageTotal> => ({}),
    pools: async () => [],
    records: async () => [],
  };
}

const base = (usage?: Usage): HostOptions => ({
  path: '/tmp/computer-uptime',
  hostName: 'box.local',
  agents: [{ ...echo({ path: '/tmp/computer-uptime', pace: 0 }), provider: 'echo', displayName: 'Echo' }],
  resources: fileResources(),
  // So a connection is somebody's, which is what a relay container is owned by.
  users: directory(),
  ...(usage === undefined ? {} : { usage }),
});

/** The plugin as loaded, with what it said kept. */
function load(hostOptions: HostOptions, state: string, more: Record<string, unknown> = {}, configDir = REPO) {
  const lines: string[] = [];
  return {
    lines,
    loaded: loadPlugins(
      [{
        name: SOURCE,
        options: {
          command: process.execPath,
          args: [FIXTURE],
          env: { DOCKER_FAKE_STATE: state },
          ...more,
        },
      }],
      { base: hostOptions, configDir, cwd: REPO, log: (line) => { lines.push(line); } },
    ),
  };
}

/** The provider as this host serves it, which is where every state change goes. */
const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
  remove(uri: string): Promise<void>;
};

/** What a body is, as a client writes it. */
const said = (body: string) => ({ data: body, encoding: 'utf-8' });

/** When every stretch in these tests opens. */
const at = new Date('2026-10-02T12:00:00.000Z');

/** The one person these tests sign in as. */
const ana: Principal = {
  id: 'ana',
  roles: [],
  can: () => true,
  memberships: ['backend:*'],
  primary: 'backend:ahpd',
  projects: [{ id: 'ahpd' }],
  teams: [{ id: 'backend' }],
};

const directory = (): Users => ({
  resource: {
    resource: 'ahpd://users',
    resource_name: 'ahpd users',
    authorization_servers: ['https://example.test/users'],
    required: false,
  },
  verify: async (token) => (token === 'ana' ? ana : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [{ id: 'backend' }],
  projects: async () => [{ id: 'ahpd' }],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** A host opened on one connection, signed in as ana. */
async function serving(options: HostOptions) {
  const client = createHost(options).accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: 'ahpd://users', token: 'ana' },
  });
  return client;
}

it('writes one record for a machine that ran and then stopped', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { loaded } = load(base(usage), held);
  const { options, problems } = await loaded;
  expect(problems).toEqual([]);

  const provider = providerOf(options);
  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22' })), 'user:ana');
  await until(() => dockerHeld(held).machines.length === 1);

  vi.setSystemTime(new Date(at.getTime() + 90_000));
  await provider.write('computer://box/state', said('stopped'));

  // One record, whole: from when the machine started to when it stopped.
  expect(usage.entries).toEqual([{
    kind: 'computer',
    source: 'computer',
    at: '2026-10-02T12:00:00.000Z',
    seconds: 90,
    computer: 'box',
    owner: 'user:ana',
    pools: ['user:ana'],
  }]);

  // Stopping what is already stopped writes nothing: there is no stretch left
  // to close.
  await provider.write('computer://box/state', said('stopped'));
  expect(usage.entries).toHaveLength(1);
});

it('charges a machine it found already running, to its team and its project', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const usage = meter();
  // What a daemon before this one left behind, which recorded who made it.
  seeded(held, {
    name: 'left-behind',
    labels: {
      'ahpd.computer': '1',
      'ahpd.disposable': 'claude',
      'ahpd.owner': 'user:ana',
      'ahpd.team': 'backend',
      'ahpd.project': 'ahpd',
    },
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { lines, loaded } = load(base(usage), held);
  const { options } = await loaded;
  // Up when this daemon started, so its stretch began then rather than at some
  // moment this plugin never saw.
  await listed(lines, 'left-behind');

  vi.setSystemTime(new Date(at.getTime() + 2_700_000));
  await providerOf(options).write('computer://left-behind/state', said('stopped'));

  expect(usage.entries).toEqual([{
    kind: 'computer',
    source: 'computer',
    at: '2026-10-02T12:00:00.000Z',
    seconds: 2700,
    computer: 'left-behind',
    owner: 'user:ana',
    team: 'backend',
    project: 'ahpd',
    // The owner as written, the team, and the project within it - decision
    // `agent-usage-is-charged-to-owner-team-and-project-pools`.
    pools: ['user:ana', 'team:backend', 'project:backend:ahpd'],
  }]);
});

it('charges a machine nobody is recorded as owning to the host', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const usage = meter();
  // Running, labelled as a computer, and with nobody's name on it.
  seeded(held, { name: 'theirs', labels: { 'ahpd.computer': '1', 'ahpd.disposable': 'claude' } });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { lines, loaded } = load(base(usage), held);
  const { options } = await loaded;
  await listed(lines, 'theirs');

  vi.setSystemTime(new Date(at.getTime() + 600_000));
  await providerOf(options).write('computer://theirs/state', said('stopped'));

  expect(usage.entries).toEqual([{
    kind: 'computer',
    source: 'computer',
    at: '2026-10-02T12:00:00.000Z',
    seconds: 600,
    computer: 'theirs',
    owner: 'root:box.local',
    pools: ['root:box.local'],
  }]);
});

it('opens no stretch for a machine it finds stopped', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const usage = meter();
  // A listing is `docker ps -a`, so this is what a daemon finds beside the
  // machines that are up: one that was stopped, by a client or by a crash.
  seeded(held, { name: 'down', state: 'exited', labels: { 'ahpd.computer': '1', 'ahpd.disposable': 'claude' } });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { lines, loaded } = load(base(usage), held);
  const { options } = await loaded;
  // The disposable log line comes after the listing, so this is the startup
  // pass having been made.
  await listed(lines, 'down');

  vi.setSystemTime(new Date(at.getTime() + 600_000));
  await providerOf(options).write('computer://down/state', said('stopped'));

  // Nothing: a machine that was never up this daemon's time has no stretch to
  // close, and a record here would charge an hour of a machine that was not
  // there for it.
  expect(usage.entries).toEqual([]);
});

it('leaves another daemon\'s disposable machine alone: it is neither removed nor charged for', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  // A millisecond rather than the five minutes it usually is, so that a
  // removal this daemon wrongly started has happened before the test looks.
  const profiles = { claude: { title: 'Claude', disposable: true, disposableDelay: 1 } };

  /*
   * Two daemons on one Docker. This one makes a disposable machine for a
   * session; the other starts over the same Docker while that session runs,
   * which is the case the decision is about.
   */
  const { options: mine } = await load({ ...base(), sessions: memorySessions() }, held, { profiles }).loaded;
  const mineClient = await serving(mine);
  await mineClient.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/one',
      provider: 'echo',
      config: { computer: 'disposable:claude' },
      workingDirectories: [dir],
    },
  });
  await until(() => dockerHeld(held).machines.length === 1);
  const box = dockerHeld(held).machines[0]?.name as string;
  expect(box).toBeDefined();

  const second = load(base(usage), held, { profiles });
  const { options: other, problems } = await second.loaded;
  expect(problems).toEqual([]);
  await until(() => second.lines.some((one) => one.includes(`left the disposable machine ${box} alone`)));

  // Nothing is armed for it, so nothing removes it. Waited for rather than
  // asserted at once, because the delay is a millisecond of real time.
  await until(() => dockerHeld(held).calls.some((one) => one[0] === 'rm'), 200);
  expect(dockerHeld(held).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(dockerHeld(held).machines.map((one) => one.name)).toEqual([box]);

  // And no up time is charged for it: this daemon opened no stretch, since the
  // machine is not one of its own to charge.
  vi.setSystemTime(new Date(at.getTime() + 600_000));
  await providerOf(other).write(`computer://${box}/state`, said('stopped'));
  expect(usage.entries).toEqual([]);
});

it('charges a relay container to whoever connected and metered it from the connect', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const devState = join(dir, 'dev.json');
  const configDir = join(dir, 'config');
  const folder = join(dir, 'work');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { loaded } = load(base(usage), held, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      // A host inside with no backend would not start, so the launcher refuses
      // a connect rather than building one.
      plugins: ['@ahpd/agent-cofold'],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: held },
    },
  }, configDir);
  const { options, problems } = await loaded;
  expect(problems).toEqual([]);

  const client = await serving(options);
  await client.handle({
    method: 'vscode/devContainers/connect',
    params: { connectionId: 'window', workspaceFolder: folder, name: 'Box' },
  });
  await until(() => dockerHeld(held).machines.length === 1);

  // Whose the container is, in the file beside the configuration: the CLI
  // labels a container only by what identifies it - decision
  // `a-relay-container-is-owned-by-who-connected`. The entry holds the
  // machine's probed environment beside the owner, which is what a command run
  // in there is reached with.
  // The machine id is the one a listing answers, which for a container the
  // CLI named is its Docker name; the probe is kept against the container id.
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toMatchObject({
    'work-devcontainer': { owner: 'user:ana', probe: { container: 'abc123' } },
  });

  // And metered from the moment the connection brought it up, charged to the
  // connection that did.
  vi.setSystemTime(new Date(at.getTime() + 300_000));
  await providerOf(options).write('computer://work-devcontainer/state', said('stopped'));

  expect(usage.entries).toEqual([{
    kind: 'computer',
    source: 'computer',
    at: '2026-10-02T12:00:00.000Z',
    seconds: 300,
    computer: 'work-devcontainer',
    owner: 'user:ana',
    pools: ['user:ana'],
  }]);
});

/*
 * A container an older connect made carries no label of this host's and
 * cannot be given one, so the connect that adopts it records it beside the
 * configuration under its container id. That record is what makes it a
 * computer: listed, inspected, found again on the next connect rather than made
 * a second time, metered to whoever adopted it, and forgotten when removed.
 */
it('records an adopted container, lists, inspects and meters it, and forgets it once removed', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const devState = join(dir, 'dev.json');
  const configDir = join(dir, 'config');
  const folder = join(dir, 'work');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  const id = 'c0ffee00c0ffee00';
  writeFileSync(held, JSON.stringify({
    machines: [{
      id,
      name: 'older',
      image: 'devcontainer',
      bare: true,
      labels: { 'devcontainer.local_folder': folder },
      mounts: [`${folder}:/workspaces/work`],
      state: 'exited',
    }],
    calls: [],
    passthrough: [],
  }));
  writeFileSync(devState, JSON.stringify({ calls: [] }));
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { loaded } = load(base(usage), held, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      plugins: ['@ahpd/agent-cofold'],
      install: false,
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: held },
    },
  }, configDir);
  const { options, problems } = await loaded;
  expect(problems).toEqual([]);

  const client = await serving(options);
  const connect = (connectionId: string) => client.handle({
    method: 'vscode/devContainers/connect',
    params: { connectionId, workspaceFolder: folder, name: 'Box' },
  });
  await connect('one');
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toMatchObject({
    [id]: { owner: 'user:ana', adopted: true },
  });
  const provider = options.resourceProviders?.computer as {
    list(uri: string): Promise<{ name: string }[]>;
    read(uri: string): Promise<unknown>;
    write(uri: string, content: { data: string; encoding: string }): Promise<void>;
    remove(uri: string): Promise<void>;
  };
  expect((await provider.list('computer://')).map((one) => one.name)).toEqual([id]);
  await expect(provider.read(`computer://${id}/status`)).resolves.toBeDefined();

  // The second connect finds the same container by its folder, and `up` is
  // never asked for one.
  await connect('two');
  expect(JSON.parse(readFileSync(devState, 'utf8')).calls.filter((one: string[]) => one[0] === 'up')).toEqual([]);
  expect(dockerHeld(held).machines).toHaveLength(1);

  vi.setSystemTime(new Date(at.getTime() + 120_000));
  await provider.write(`computer://${id}/state`, said('stopped'));
  expect(usage.entries).toEqual([{
    kind: 'computer',
    source: 'computer',
    at: '2026-10-02T12:00:00.000Z',
    seconds: 120,
    computer: id,
    owner: 'user:ana',
    pools: ['user:ana'],
  }]);

  await provider.remove(`computer://${id}`);
  expect(dockerHeld(held).machines).toEqual([]);
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toEqual({});
});

it('closes every open stretch when the daemon stops', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { loaded } = load(base(usage), held);
  const { options, contributions } = await loaded;

  const provider = providerOf(options);
  await provider.write('computer://one', said(JSON.stringify({ image: 'node:22' })), 'user:ana');
  await provider.write('computer://two', said(JSON.stringify({ image: 'node:22' })), 'user:ana');
  await until(() => dockerHeld(held).machines.length === 2);
  vi.setSystemTime(new Date(at.getTime() + 45_000));

  // What the host raises on its way down, through the events this plugin
  // subscribed to rather than through any machine of its own.
  await raise(contributions[0]?.events, { type: 'stopping' });

  expect(usage.entries.map((one) => (one.kind === 'computer' ? [one.computer, one.seconds] : one))).toEqual([
    ['one', 45],
    ['two', 45],
  ]);
});

it('writes nothing, and fails nothing, on a host with no usage port', async () => {
  const dir = temp();
  const held = join(dir, 'docker.json');
  const { loaded } = load(base(), held);
  const { options, problems } = await loaded;
  expect(problems).toEqual([]);

  // There is nowhere to write, which is a host nobody asked to keep usage on
  // rather than a plugin that got it wrong: the machine still starts, stops and
  // goes, and nothing is thrown at any of it.
  const provider = providerOf(options);
  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22' })), 'user:ana');
  await until(() => dockerHeld(held).machines.length === 1);
  await provider.write('computer://box/state', said('stopped'));
  await provider.remove('computer://box');

  expect(dockerHeld(held).calls.map((one) => one[0])).toContain('stop');
  expect(dockerHeld(held).machines).toEqual([]);
});
