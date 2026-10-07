import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { claimedBy } from '../src/runtime.js';
import { keepProbe, ownedOf, OWNERS_FILE } from '../src/owners.js';
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
  if (state !== undefined) rmSync(state, { recursive: true, force: true });
  state = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-owner-'));
  return loose;
};

/*
 * The state directory a load is given, which is a temporary one of its own.
 *
 * A load with this repository as its state directory writes into the checkout:
 * a machine made on a linked worktree leaves `computers.gitfile` at whatever
 * `configDir` names, and a test that did that put a file in the repository.
 */
let state: string | undefined;
const stateDir = (): string => (state ??= mkdtempSync(join(tmpdir(), 'ahpd-computer-owner-config-')));

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

const base = (): HostOptions => ({
  path: '/tmp/computer-owner',
  agents: [{ ...echo({ path: '/tmp/computer-owner', pace: 0 }), provider: 'echo', displayName: 'Echo' } as Agent],
  resources: fileResources(),
  users: directory(),
});

/** The Docker fixture as the runtime, and optionally the CLI fixture too. */
const optionsOf = (dockerState: string, devState?: string, more: Record<string, unknown> = {}): Record<string, unknown> => {
  const { folders, ...rest } = more;
  return {
    command: process.execPath,
    args: [DOCKER],
    env: { DOCKER_FAKE_STATE: dockerState },
    ...(devState === undefined ? {} : {
      devcontainer: {
        command: process.execPath,
        args: [DEV],
        env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
        // `base()` below has a users directory, and a host more than one person
        // signs in to makes dev containers only from the folders its operator
        // names - decision
        // `dev-containers-need-allowed-folders-on-a-host-with-users`. A case
        // here names the folder it means to build in.
        ...(Array.isArray(folders) ? { folders } : {}),
      },
    }),
    ...rest,
  };
};

const load = (pluginOptions: Record<string, unknown>, configDir = stateDir()) => loadPlugins(
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
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');

  const { options } = await load(optionsOf(dockerState, devState, { folders: [folder] }), configDir);

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
    // The override config, whose own path is a temporary one: the id labels
    // are the whole of what identifies this container.
    '--override-config', expect.any(String),
  ]);

  // So the creator is in the file beside the configuration, under the name the
  // create gave the machine rather than the one the CLI named it. The entry
  // carries the machine's probed environment beside the owner, which is the
  // other half of what the file keeps.
  // The container id the CLI answered, the name Docker gave it and the name
  // the create gave it are three different things.
  const box = dockerHeld(dockerState).machines[0] as { id?: string; name: string; labels?: Record<string, string> } | undefined;
  expect(box?.id).toBe('abc123');
  expect(box?.name).not.toBe('abc123');
  expect(box?.labels?.['ahpd.name']).toMatch(/^ahpd-computer-\w{8}$/);
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toMatchObject({
    [box?.labels?.['ahpd.name'] ?? '']: { owner: 'user:ana', team: 'backend', project: 'ahpd', probe: { container: 'abc123' } },
  });
});

it('forgets the record of a machine the CLI made once it is removed', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = join(dir, 'work');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');

  const { options } = await load(optionsOf(dockerState, devState, { folders: [folder] }), configDir);
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

  // By the name the create gave it, which is the name the listing answers.
  const id = dockerHeld(dockerState).machines[0]?.labels?.['ahpd.name'] ?? '';
  expect(id).not.toBe('');
  const remove = options.resourceProviders?.computer?.remove as
    ((uri: string) => Promise<void>) | undefined;
  await remove?.(`computer://${id}`);
  await until(() => dockerHeld(dockerState).machines.length === 0);

  // An entry for a machine that is gone is a claim on an id nothing holds, and
  // the folder's next container would be made and charged to the last one.
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toEqual({});
});

it('writes the file private even when a readable scratch at its own name was left behind', () => {
  const dir = temp();
  const configDir = join(dir, 'config');
  mkdirSync(configDir, { recursive: true });
  const path = join(configDir, OWNERS_FILE);
  // What a process that had this pid before left world-readable. `mode` is
  // applied when a file is created and not when one is opened, so a write that
  // opened this scratch would keep its 0644 - and the rename puts that on the
  // file, which holds whose each machine is and the environment probed out of
  // that person's shell.
  const scratch = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(scratch, '{}');
  chmodSync(scratch, 0o644);

  keepProbe(configDir, 'abc123', { container: 'abc123', env: { TOKEN: 'x' } }, () => {});

  expect(statSync(path).mode & 0o777).toBe(0o600);
});

it('does not write over a computers file it could not read', () => {
  const dir = temp();
  const configDir = join(dir, 'config');
  mkdirSync(configDir, { recursive: true });
  const path = join(configDir, OWNERS_FILE);
  // Two machines' records and a trailing comma: whoever wrote it last was
  // interrupted, or edited it by hand. What it holds is not knowable here, and
  // that is the point - the write is the whole file, so making one from a read
  // that failed would drop every machine this daemon cannot name.
  const before = '{\n  "one": { "owner": "user:ana" },\n  "two": { "owner": "user:bo" },\n}\n';
  writeFileSync(path, before);

  const lines: string[] = [];
  keepProbe(configDir, 'three', { container: 'abc123', env: {} }, (line) => lines.push(line));

  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(lines.join('\n')).toContain(path);
  // And the readers answer nothing for it, as they did before: a machine whose
  // record cannot be read is charged to the host rather than to a guess.
  expect(ownedOf(configDir, 'one', () => {})).toBeUndefined();
  expect(lines.join('\n')).toContain('could not read');
});
