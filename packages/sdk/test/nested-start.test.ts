import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * How the computers port starts a whole host inside a machine.
 *
 * The command is built from the machine's profile, and the machine remembers
 * which profile made it - so a daemon that did not make it still starts the
 * host the profile named. The `docker` is the scripted fixture, so what is
 * under test is the exec line this package builds rather than Docker.
 *
 * The last case is the host's own choice rather than the port's: a session in
 * a machine the port says is off this host runs nested, even for a backend
 * that never declared it.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('../../computer/test/fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
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
const stateDir = (): string => (home ??= mkdtempSync(join(tmpdir(), 'ahpd-nested-start-config-')));

const base = (): HostOptions => ({
  path: '/tmp/nested-start',
  agents: [{ ...echo({ path: '/tmp/nested-start', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const load = (options: Record<string, unknown>) => loadPlugins(
  [{ name: SOURCE, options }],
  { base: base(), configDir: stateDir(), cwd: REPO, log: () => {} },
);

const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }): Promise<void>;
};

type Bag = Record<string, any>;

/** Wait for something the host does asynchronously, without a fixed sleep. */
const until = async (check: () => boolean, times = 600): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

/** A peer that keeps what the host told it, for the half that answers with a notification. */
const watching = (): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

/** Every `docker exec` the port answered, as one flat argument list. */
const execOf = (spawn: { command: string; args: string[] } | undefined): string[] => {
  const args = spawn?.args ?? [];
  const at = args.indexOf('exec');
  return at === -1 ? [] : args.slice(at);
};

it('starts the host a profile names, and ahpd when it names none', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-nested-start-'));
  const state = join(loose, 'docker.json');
  // A host path the mount reads is checked at create, so it has to be there.
  const work = join(loose, 'work');
  mkdirSync(work);
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    // The mount is what makes a host path a path inside the machine, which is
    // what a caller's `cwd` is read through.
    profiles: {
      plain: { mounts: [`${work}:/work`] },
      nodejs: { host: ['node', '/work/ahpd.js'], mounts: [`${work}:/work`] },
    },
  });
  expect(problems).toEqual([]);

  const provider = providerOf(options);
  await provider.write('computer://plain', { data: JSON.stringify({ profile: 'plain' }), encoding: 'utf-8' });
  await provider.write('computer://nodejs', { data: JSON.stringify({ profile: 'nodejs' }), encoding: 'utf-8' });

  const computers = options.computers;
  if (computers?.nested === undefined) throw new Error('the plugin registered no nested start');

  // The default: the command the container's install step provides.
  const plain = await computers.nested('plain', { plugins: ['@ahpd/agent-cofold'], cwd: work });
  expect(plain?.command).toBe(process.execPath);
  expect(execOf(plain)).toEqual(['exec', '-i', '-w', '/work', 'plain', 'ahpd', '--stdio', '--no-plugins', '--plugin', '@ahpd/agent-cofold']);

  // A profile's own host, with the same `--stdio --no-plugins --plugin` argv after it.
  const nodejs = await computers.nested('nodejs', { plugins: ['@ahpd/agent-cofold'], cwd: work });
  expect(execOf(nodejs)).toEqual([
    'exec', '-i', '-w', '/work', 'nodejs',
    'node', '/work/ahpd.js', '--stdio', '--no-plugins', '--plugin', '@ahpd/agent-cofold',
  ]);

  // More than one plugin, in the order the caller named them.
  const many = await computers.nested('plain', { plugins: ['@ahpd/agent-cofold', '@ahpd/some-other'], cwd: work });
  expect(execOf(many)).toEqual([
    'exec', '-i', '-w', '/work', 'plain',
    'ahpd', '--stdio', '--no-plugins', '--plugin', '@ahpd/agent-cofold', '--plugin', '@ahpd/some-other',
  ]);

  // A machine that is not there is nothing, the same answer `how` gives.
  expect(await computers.nested('gone', { plugins: ['@ahpd/agent-cofold'] })).toBeUndefined();
});

it('answers the path inside the machine the session folder is mounted at', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-nested-inside-'));
  const state = join(loose, 'docker.json');
  // The folder a session names on this host, mounted as /workspaces/app.
  const app = join(loose, 'srv-app');
  mkdirSync(join(app, 'x'), { recursive: true });
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { plain: { mounts: [`${app}:/workspaces/app`] } },
  });
  await providerOf(options).write('computer://plain', { data: JSON.stringify({ profile: 'plain' }), encoding: 'utf-8' });
  const computers = options.computers;
  if (computers?.nested === undefined) throw new Error('the plugin registered no nested start');

  const covered = await computers.nested('plain', { plugins: ['@ahpd/agent-cofold'], cwd: join(app, 'x') });
  expect(covered?.workingDirectory).toBe('/workspaces/app/x');
  // A folder no mount covers is the machine's own directory, or nothing when it has none.
  const elsewhere = await computers.nested('plain', { plugins: ['@ahpd/agent-cofold'], cwd: '/nowhere/mounted' });
  expect(elsewhere?.workingDirectory).not.toBe('/nowhere/mounted');
});

it('records the profile on the machine, so a later daemon starts the same host', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-nested-label-'));
  const state = join(loose, 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { nodejs: { host: ['node', '/work/ahpd.js'] } },
  });
  await providerOf(options).write('computer://box', { data: JSON.stringify({ profile: 'nodejs' }), encoding: 'utf-8' });

  const calls = JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][] };
  const run = calls.calls.find((one) => one[0] === 'run') ?? [];
  expect(run).toContain('ahpd.profile=nodejs');
});

it('nests a session in a machine the port says is off this host', async () => {
  // The choice itself, at the one place it is made: a backend that never
  // declared `runsNested` is nested anyway when its machine is one this host
  // cannot reach, so the backend's own `create` must not run.
  let started = 0;
  let asked: { plugins: string[] } | undefined;
  let release: () => void = () => { /* replaced below */ };
  const opened = new Promise<void>((resolve) => { release = resolve; });
  const plain: Agent = {
    provider: 'plain',
    displayName: 'Plain backend',
    schema: () => ({ properties: {} }),
    defaults: () => ({}),
    create: () => { started += 1; throw new Error('the backend must not be started on this host'); },
  };
  const host = createHost({
    path: '/tmp/nested-start-off-host',
    agents: [plain],
    // The package that registered the backend, which the host inside loads.
    agentPlugins: { plain: '@ahpd/agent-cofold' },
    // A port whose start is held open until the client is watching, so the
    // answer is delivered rather than raced.
    computers: {
      how: async () => ({ command: 'true', args: [] }),
      remote: (id: string) => id === 'box',
      nested: async (_id, start) => { asked = start; await opened; return undefined; },
    },
  });
  const peer = watching();
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'] } });
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/off-host', provider: 'plain', config: { computer: 'computer://box' } },
  });
  // The choice is already made: the backend's own `create` would have thrown.
  expect(started).toBe(0);
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/off-host' } });
  release();
  await until(() => peer.seen.some(({ method, params }) => method === 'action' && params?.action?.type === 'session/creationFailed'));

  // The plugin is the one that registered this backend, which the port is
  // asked to run the host with.
  expect(asked?.plugins).toEqual(['@ahpd/agent-cofold']);
  const said = peer.seen.find(({ method, params }) => method === 'action' && params?.action?.type === 'session/creationFailed');
  expect(said?.params.action.error.message).toMatch(/There is no computer called computer:\/\/box/);
});
