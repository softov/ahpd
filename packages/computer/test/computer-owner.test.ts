import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { claimedBy } from '../src/runtime.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Principal, Users } from '../../sdk/src/types/users.js';

/*
 * Whose a machine is, recorded with the machine.
 *
 * The creator's owner outlives the request that made it, so a daemon that
 * restarts knows whose a machine is rather than asking who asked. A
 * `docker run` machine carries it as a label; one the Dev Container CLI made
 * carries it in the file beside the configuration, because the CLI can only
 * label a container through the pairs that identify it.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const DEV = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-owner-'));
  return loose;
};

/** What the scripted Docker holds. */
interface DockerHeld {
  machines: { name: string; image: string; labels?: Record<string, string> }[];
  calls: string[][];
}
const dockerHeld = (state: string): DockerHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DockerHeld
  : { machines: [], calls: [] });

/** What the scripted CLI recorded. */
const devCalls = (state: string): string[][] => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][] }
  : { calls: [] }).calls;

const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

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
  resource: RECORD,
  verify: async (token) => (token === 'ana' ? ana : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
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

const base = (): HostOptions => ({
  path: '/tmp/computer-owner',
  agents: [{ ...echo({ path: '/tmp/computer-owner', pace: 0 }), provider: 'echo', displayName: 'Echo' } as Agent],
  resources: fileResources(),
  users: directory(),
});

/** The Docker fixture as the runtime, and optionally the CLI fixture too. */
const optionsOf = (dockerState: string, devState?: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: process.execPath,
  args: [DOCKER],
  env: { DOCKER_FAKE_STATE: dockerState },
  ...(devState === undefined ? {} : {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
    },
  }),
  ...more,
});

const load = (pluginOptions: Record<string, unknown>, configDir = REPO) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(), configDir, cwd: REPO, log: () => {} },
);

/** A host opened on one connection, signed in as ana. */
async function serving(options: HostOptions) {
  const client = createHost(options).accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' },
  });
  return client;
}

/** The labels the machine carries, as a status read gives them back. */
async function labelsOf(options: HostOptions, id: string): Promise<Record<string, unknown>> {
  const read = options.resourceProviders?.computer?.read as
    ((uri: string) => Promise<{ data: string }>) | undefined;
  const body = JSON.parse((await read?.(`computer://${id}/status`))?.data ?? '{}') as {
    Config?: { Labels?: Record<string, unknown> };
  };
  return body.Config?.Labels ?? {};
}

it('records on a machine made for a session whose it is and what it is charged to', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const { options, problems } = await load(optionsOf(state, undefined, {
    profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true } },
  }));
  expect(problems).toEqual([]);

  const client = await serving(options);
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/one', provider: 'echo', config: { computer: 'disposable:claude' } },
  });
  await until(() => dockerHeld(state).machines.length === 1);

  const box = dockerHeld(state).machines[0];
  expect(box?.labels).toMatchObject({
    'ahpd.owner': 'user:ana',
    'ahpd.team': 'backend',
    'ahpd.project': 'ahpd',
  });
  // And read back off the machine, which is what a listing and a restart see.
  const read = await labelsOf(options, box?.name as string);
  expect(claimedBy(read)).toEqual({ owner: 'user:ana', team: 'backend', project: 'ahpd' });
});

it('records on a machine a person made directly whose it is', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const { options } = await load(optionsOf(state));

  const client = await serving(options);
  await client.handle({
    method: 'resourceWrite',
    params: { channel: ROOT, uri: 'computer://box', data: JSON.stringify({ image: 'node:22' }), encoding: 'utf-8' },
  });
  await until(() => dockerHeld(state).machines.length === 1);

  // The owner and nothing else: a machine made from the form has no session
  // behind it, so there is no scope to record.
  expect(dockerHeld(state).machines[0]?.labels).toMatchObject({ 'ahpd.owner': 'user:ana' });
  const read = await labelsOf(options, 'box');
  expect(claimedBy(read)).toEqual({ owner: 'user:ana' });
});

it('records nothing on a machine this host has no owner for', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const { options } = await load(optionsOf(state));

  const write = options.resourceProviders?.computer?.write as
    ((uri: string, content: { data: string; encoding: string }, owner?: unknown) => Promise<void>) | undefined;
  await write?.('computer://box', { data: JSON.stringify({ image: 'node:22' }), encoding: 'utf-8' });
  await until(() => dockerHeld(state).machines.length === 1);

  // No label at all, rather than an empty one: a machine with nobody's name on
  // it is a machine nobody owns, and is charged to the host.
  expect(dockerHeld(state).machines[0]?.labels).not.toHaveProperty('ahpd.owner');
});

it('keeps the Dev Container CLI on the folder identity and records the owner beside the config', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = join(dir, 'work');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{}');

  const { options } = await load(optionsOf(dockerState, devState), configDir);

  const client = await serving(options);
  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/one',
      provider: 'echo',
      config: { computer: `devcontainer://${folder}` },
      workingDirectories: [folder],
    },
  });
  await until(() => devCalls(devState).length > 0);

  // The two pairs that identify the folder's container and nothing else: the
  // CLI finds an existing one by its labels, so an owner among them would give
  // a folder that already has a container a second one.
  expect(devCalls(devState)[0]).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
  ]);

  // So the creator is in the file beside the configuration, under the id the
  // listing answers this machine by.
  const box = dockerHeld(dockerState).machines[0];
  expect(box?.name).toBe('abc123');
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toEqual({
    abc123: { owner: 'user:ana', team: 'backend', project: 'ahpd' },
  });
});

it('forgets the record of a machine the CLI made once it is removed', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = join(dir, 'work');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{}');

  const { options } = await load(optionsOf(dockerState, devState), configDir);
  const client = await serving(options);
  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/one',
      provider: 'echo',
      config: { computer: `devcontainer://${folder}` },
      workingDirectories: [folder],
    },
  });
  await until(() => devCalls(devState).length > 0);

  const remove = options.resourceProviders?.computer?.remove as
    ((uri: string) => Promise<void>) | undefined;
  await remove?.('computer://abc123');
  await until(() => dockerHeld(dockerState).machines.length === 0);

  // An entry for a machine that is gone is a claim on an id nothing holds, and
  // the folder's next container would be made and charged to the last one.
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toEqual({});
});
