import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { gitWorktrees } from '../../sdk/src/repo/worktrees.js';
import { fileUsers } from '../../sdk/src/users.js';
import { MACHINE_OBJECTS } from '../src/gitdir.js';
import { dockerRuntime } from '../src/runtime.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions, HostTool, ToolCall } from '../../sdk/src/types/host.js';
import type { MachineNeed } from '../../sdk/src/types/machine.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Vault } from '../../sdk/src/types/vault.js';

/*
 * A dev container is a computer, made from a folder's `devcontainer.json`.
 *
 * Both programs are scripted: the `devcontainer` fixture is the CLI and the
 * `docker` fixture is the runtime, and the first writes what it made into the
 * second, so a test sees the pair of them as one machine. What is under test
 * is what this package asks each of them for - the labels, the command, the
 * listing, the picker - and not the CLI's own work.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const DEV = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));

/** Temporary directories, removed after the test that made them. */
const loose: string[] = [];
afterEach(() => {
  for (const one of loose.splice(0)) rmSync(one, { recursive: true, force: true });
});

const temp = (): string => {
  const one = mkdtempSync(join(tmpdir(), 'ahpd-computer-devc-'));
  loose.push(one);
  return one;
};

/** A folder that is a dev container, and one that is not. */
function workspace(root: string, withDefinition = true, name = 'work-'): string {
  const folder = mkdtempSync(join(root, name));
  if (withDefinition) {
    mkdirSync(join(folder, '.devcontainer'), { recursive: true });
    writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  }
  return folder;
}

/**
 * Where the CLI mounts a folder, which is `/workspaces/<basename>` unless the
 * override says `workspaceMount` - the path the real CLI works out, so a test
 * reads it rather than naming it.
 */
const mounted = (folder: string): string => `/workspaces/${basename(folder)}`;

/** What the scripted CLI recorded. */
interface DevHeld {
  calls: string[][];
  commands: string[];
  /** Every override config an `up` was handed, as it was on disk. */
  overrides?: { where: string; mode: number; config: Record<string, unknown> }[];
}
const devHeld = (state: string): DevHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DevHeld
  : { calls: [], commands: [] });

/**
 * What one `up` was asked, with the override config's own path put out of the
 * way: it is a fresh temporary directory's path and is gone after the call.
 */
const upOf = (state: string): string[] | undefined => {
  const argv = devHeld(state).calls.find((one) => one[0] === 'up');
  if (argv === undefined) return undefined;
  const at = argv.indexOf('--override-config');
  return at === -1 ? argv : [...argv.slice(0, at), '--override-config', '<override>'];
};

/** The override config the CLI was handed, its mode, and whether it is gone. */
const overrideOf = (state: string): { mode: number; config: Record<string, unknown>; gone: boolean } | undefined => {
  const said = devHeld(state).overrides?.[0];
  return said === undefined ? undefined : { mode: said.mode, config: said.config, gone: !existsSync(said.where) };
};

/** What the scripted Docker holds. */
interface DockerHeld {
  machines: { name: string; image: string; labels?: Record<string, string>; mounts?: string[]; state?: string }[];
  calls: string[][];
  /** Every command run in a container, with the flags it was reached under. */
  commands: { id: string; user?: string; workdir?: string; env: Record<string, string>; command: string[] }[];
}
const dockerHeld = (state: string): DockerHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DockerHeld
  : { machines: [], calls: [], commands: [] });

/**
 * Wait until the scripted Docker has answered every call a case made of it:
 * its state file records `calls` of them and no call still holds the lock.
 *
 * Loading the plugin starts a listing that nothing awaits, so a case can reach
 * its last assertion while that `docker ps` is still to write the state file,
 * and `afterEach` then removes a folder the fixture is writing into. The lock
 * is the last thing a call lets go of, on its exit.
 */
const answered = async (state: string, calls: number): Promise<void> => {
  const limit = Date.now() + 4_000;
  while (dockerHeld(state).calls.length < calls || existsSync(`${state}.lock`)) {
    if (Date.now() > limit) {
      throw new Error(`the scripted docker never finished ${calls} calls on ${state}: ${dockerHeld(state).calls.length} recorded`);
    }
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

/**
 * The plugin's options: the Docker fixture as the runtime, the CLI fixture as
 * the launcher and the maker, and both state files pointed at the same run.
 */
const optionsOf = (devState: string, dockerState: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: process.execPath,
  args: [DOCKER],
  env: { DOCKER_FAKE_STATE: dockerState },
  devcontainer: {
    command: process.execPath,
    args: [DEV],
    env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
  },
  ...more,
});

/**
 * Load the plugin, with its configuration directory somewhere of its own.
 *
 * That directory is where the daemon keeps `computers.json`, which is where a
 * dev container's probed environment is kept - a load that defaulted to the
 * repository would write one there.
 *
 * `people` gives the host a users directory, which is what makes it a host more
 * than one person uses: a plugin is told whether there is one, and reads
 * nothing of it.
 */
const load = (pluginOptions: Record<string, unknown>, agents: Agent[] = [], configDir = temp(), people = false) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  {
    base: {
      path: '/tmp/computer-devcontainer',
      agents,
      resources: fileResources(),
      ...(people ? { users: fileUsers({ path: join(configDir, 'users.json') }) } : {}),
    },
    configDir,
    cwd: REPO,
    log: () => {},
  },
);

const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  list(uri: string): Promise<{ name: string }[]>;
  remove(uri: string): Promise<void>;
};

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

/** The echo backend, declaring what a machine needs for it to run. */
const agentWith = (needs: Record<string, MachineNeed> = {}): Agent => ({
  ...echo({ path: '/tmp/computer-devcontainer', pace: 0 }),
  machine: () => needs,
});

/** One client and the session half of the tests. */
async function room(hostOptions: HostOptions) {
  const p = peer();
  const client = createHost(hostOptions).accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return {
    client,
    peer: p,
    open: async (uri: string, config: Record<string, unknown>, folder?: string): Promise<unknown> => {
      await client.handle({
        method: 'createSession',
        params: {
          channel: uri,
          provider: 'echo',
          config,
          ...(folder === undefined ? {} : { workingDirectories: [folder] }),
        },
      });
      return client.handle({ method: 'subscribe', params: { channel: uri } });
    },
  };
}

const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

/*
 * Task 01: made from the folder, with the CLI's own two labels.
 */
it('makes a computer from a folder\'s devcontainer.json, and lists it by its folder', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded, problems } = await load(optionsOf(devState, dockerState));
  expect(problems).toEqual([]);

  const provider = providerOf(loaded);
  await provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });

  // The exact line, which is the whole create: the folder and the two labels
  // every later call about this container repeats, and the override config
  // this host adds to the folder's own definition.
  expect(upOf(devState)).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
    '--override-config', '<override>',
  ]);
  /*
   * The override is the folder's whole definition with the name over it, not
   * only what this host adds: the CLI replaces the file rather than merging
   * with it, so an override naming no recipe would be refused by name.
   */
  expect(overrideOf(devState)?.config).toEqual({ image: 'base', runArgs: ['--label', 'ahpd.name=box'] });
  // Only its own user may read it while it holds environment values, and it is
  // gone once `up` is answered.
  expect(overrideOf(devState)?.mode).toBe(0o600);
  expect(overrideOf(devState)?.gone).toBe(true);
  // The container the CLI reported is what the provider lists, under the name
  // the create gave it, and the folder is what the machine is read by.
  expect((await provider.list('computer://')).map((one) => one.name)).toEqual(['box']);
  const runtime = dockerRuntime({
    command: process.execPath,
    args: [DOCKER],
    env: { DOCKER_FAKE_STATE: dockerState },
    label: 'ahpd.computer=1',
  });
  expect((await runtime.list())[0]).toMatchObject({ id: 'box', folder });
  await answered(dockerState, 6);
});

it('refuses a folder with no devcontainer.json, and a CLI that is not there', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const bare = workspace(dir, false);
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const provider = providerOf(loaded);

  // The folder is refused by this host, with the CLI's own two names in the
  // sentence, and nothing was spawned to find it out.
  await expect(provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder: bare } }),
    encoding: 'utf-8',
  })).rejects.toThrow(/no devcontainer\.json/);
  expect(devHeld(devState).calls).toEqual([]);

  // A CLI that is not installed is the launcher's own refusal, worded for
  // this route: the folder is fine and the program is the thing missing.
  const otherDir = join(dir, 'other');
  mkdirSync(otherDir);
  const otherDev = join(otherDir, 'dev.json');
  const otherDocker = join(otherDir, 'docker.json');
  const good = workspace(otherDir);
  const { options: noCli } = await load(optionsOf(otherDev, otherDocker, {
    devcontainer: { command: '/nonexistent/devcontainer', args: [] },
  }));
  await expect(providerOf(noCli).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder: good } }),
    encoding: 'utf-8',
  })).rejects.toThrow(/Dev Container CLI/);
  expect(dockerHeld(otherDocker).machines).toEqual([]);
  await answered(dockerState, 1);
  await answered(otherDocker, 3);
});

/*
 * Task 18: reached by `docker exec`, the way the CLI itself reaches it.
 *
 * The user's own login shell is probed for what it was holding, and that answer
 * is what the command runs with - which is the whole of the derivation, and the
 * reason a definition's `remoteEnv` reaches a command nobody set it on.
 */
it('reaches it by docker exec, as the folder\'s own user in its own environment', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(devState, JSON.stringify({
    calls: [],
    metadata: [{ remoteUser: 'vscode', remoteEnv: { GREETING: 'hello' } }],
  }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });

  const how = await loaded.computers?.how('box', { command: 'node', args: ['server.mjs'] });
  expect(how).toEqual({
    command: process.execPath,
    args: [
      DOCKER, 'exec', '-i',
      // The user the folder's own configuration asks for, and the environment
      // that user's shell was holding with the folder's `remoteEnv` over it.
      '-u', 'vscode',
      '-e', 'PATH=/usr/bin',
      '-e', 'HOME=/root',
      // The folder's own `remoteEnv` by name, its value in docker's environment.
      '-e', 'GREETING',
      // And where in the machine the workspace is mounted.
      '-w', mounted(folder),
      'abc123',
      'node', 'server.mjs',
    ],
    // The docker program's own environment, which is the program's and not the
    // machine's, and the values passed by name.
    env: { DOCKER_FAKE_STATE: dockerState, GREETING: 'hello' },
  });
  // A caller's environment is the last of the `-e` flags, beside the machine's
  // own rather than instead of it, by name with its value in docker's own
  // environment.
  const asked = await loaded.computers?.how('box', {
    command: 'node', args: ['server.mjs'], env: { A: '1' },
  });
  expect(asked?.args).toEqual([
    DOCKER, 'exec', '-i', '-u', 'vscode',
    '-e', 'PATH=/usr/bin', '-e', 'HOME=/root', '-e', 'GREETING',
    '-w', mounted(folder), '-e', 'A',
    'abc123', 'node', 'server.mjs',
  ]);
  expect(asked?.env).toEqual({ DOCKER_FAKE_STATE: dockerState, GREETING: 'hello', A: '1' });

  // And a backend spawned through that descriptor really lands there: the
  // scripted Docker records the command line, which is the proof the spawn is
  // not a shell line that would have looked the same.
  const before = dockerHeld(dockerState).calls.length;
  spawnSync(how?.command as string, how?.args as string[], {
    encoding: 'utf8',
    env: { ...process.env, ...how?.env },
  });
  expect(dockerHeld(dockerState).calls.length).toBe(before + 1);
  expect(dockerHeld(dockerState).commands.at(-1)).toMatchObject({
    id: 'abc123',
    user: 'vscode',
    workdir: mounted(folder),
    command: ['node', 'server.mjs'],
  });
  await answered(dockerState, 6);
});

/*
 * The directory a command starts in is the caller's, read through the machine's
 * mounts: a path under the folder the container was made from is the same place
 * under its name inside, and a path no mount covers is a directory that machine
 * does not have, so the workspace stands instead. No `cd` in a shell line, and
 * `within` is the one mapping either branch of it uses.
 */
it('keeps the working directory a caller asks for, mapped through the mounts', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  mkdirSync(join(folder, 'sub'));
  writeFileSync(devState, JSON.stringify({ calls: [], metadata: [{ remoteUser: 'vscode' }] }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [] }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });

  const inside = async (cwd?: string): Promise<string | undefined> => {
    const args = (await loaded.computers?.how('box', {
      command: 'node', args: ['server.mjs'], ...(cwd === undefined ? {} : { cwd }),
    }))?.args ?? [];
    return args[args.indexOf('-w') + 1];
  };

  expect(await inside(join(folder, 'sub'))).toBe(`${mounted(folder)}/sub`);
  // A path on this host that the container has no mount for is not a directory
  // in there, and the workspace is where the command belongs.
  expect(await inside('/elsewhere')).toBe(mounted(folder));
  // And a caller that names nowhere gets the workspace too.
  expect(await inside()).toBe(mounted(folder));
  await answered(dockerState, 6);
});

/*
 * The tool a backend runs a command with, on the same road.
 *
 * `how` describes a spawn for a backend to make itself; `computer_exec` is the
 * daemon making it. Both go through the runtime, so both derive the same user
 * and the same environment - a machine reachable by one and not the other
 * would be a machine whose login shell depends on who asked.
 */
it('runs `computer_exec` on it with the same flags a backend is reached with', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(devState, JSON.stringify({ calls: [], metadata: [{ remoteUser: 'vscode' }] }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], execOut: 'v22.14.0\n' }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });

  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  const ran = String(await tool.run({ id: 'box', command: 'node --version' }, {} as ToolCall));
  expect(ran).toContain('v22.14.0');
  expect(ran).toContain('exit 0');
  // By the container id, as `how` and the relay reach it, and not by the name
  // Docker gave the container.
  expect(dockerHeld(dockerState).commands.at(-1)).toMatchObject({
    id: 'abc123',
    user: 'vscode',
    workdir: mounted(folder),
    command: ['sh', '-lc', 'node --version'],
  });
  await answered(dockerState, 6);
});

/*
 * Task 03: the form's own shape, as ahpapp sends it.
 */
it('makes one from the body a form sends, and still refuses an image beside it', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const provider = providerOf(loaded);

  // What ahpapp draws from the schema and sends: every field as a string, and
  // the image field carrying the default nobody touched.
  const schema = loaded.resourceProviders?.computer as {
    describe(): { manifest?: { properties?: Record<string, { default?: string }> } };
  };
  expect(schema.describe().manifest?.properties?.source?.default).toBe('image');
  expect(schema.describe().manifest?.properties?.devcontainer).toMatchObject({ type: 'string' });
  await provider.write('computer://box', {
    data: JSON.stringify({
      source: 'devcontainer',
      runtime: 'docker',
      image: 'debian:bookworm-slim',
      devcontainer: folder,
      cpus: '',
      memory: '',
      workdir: '',
    }),
    encoding: 'utf-8',
  });
  expect(upOf(devState)).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
    '--override-config', '<override>',
  ]);

  // An image somebody typed beside the folder is still two sources, and is
  // refused with the sentence that says so.
  await expect(provider.write('computer://other', {
    data: JSON.stringify({ source: 'devcontainer', devcontainer: folder, image: 'node:22' }),
    encoding: 'utf-8',
  })).rejects.toThrow(/names both/);
  await answered(dockerState, 4);
});

/*
 * The source beside the two fields, read by the host rather than the form.
 */
it('reads only the recipe the source names, and refuses a source that names none', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const provider = providerOf(loaded);

  // An image beside a folder, with the source saying which of the two is read:
  // the folder is ignored, and what the CLI is asked for is a `docker run`.
  await provider.write('computer://box', {
    data: JSON.stringify({ source: 'image', image: 'debian:bookworm-slim', devcontainer: folder }),
    encoding: 'utf-8',
  });
  await answered(dockerState, 4);
  expect(devHeld(devState).calls).toEqual([]);
  expect(dockerHeld(dockerState).calls.some((one) => one[0] === 'run')).toBe(true);

  // A dev container with no folder beside it is a recipe naming no recipe: a
  // folder the form left blank, which is not the same as not choosing one.
  await expect(provider.write('computer://other', {
    data: JSON.stringify({ source: 'devcontainer', devcontainer: '', image: 'debian:bookworm-slim' }),
    encoding: 'utf-8',
  })).rejects.toThrow(/names no folder/);

  // And a source this host does not know is refused rather than guessed at.
  await expect(provider.write('computer://third', {
    data: JSON.stringify({ source: 'compose', devcontainer: folder }),
    encoding: 'utf-8',
  })).rejects.toThrow(/source is "image" or "devcontainer"/);
});

/*
 * Task 04: the picker's row, and the machine it becomes.
 */
it('offers the session folder\'s dev container, and not once one exists', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const withDefinition = workspace(dir);
  const bare = workspace(dir, false);
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];

  // A folder with the file, offered; a folder without it, not.
  const offered = await answerer({ property: 'computer', query: '', workingDirectory: `file://${withDefinition}` });
  expect(offered.find((one) => one.value === `devcontainer://${withDefinition}`)).toMatchObject({ label: 'Dev container' });
  const without = await answerer({ property: 'computer', query: '', workingDirectory: `file://${bare}` });
  expect(without.some((one) => one.value.startsWith('devcontainer://'))).toBe(false);

  // Once a computer carries the folder, the ordinary row is what a person
  // picks, and the source that would make a second one is gone.
  const existing = join(dir, 'docker-existing.json');
  const existingDev = join(dir, 'dev-existing.json');
  writeFileSync(existing, JSON.stringify({
    machines: [{
      name: 'existing',
      image: 'node:22',
      labels: { 'ahpd.computer': '1', 'ahpd.devcontainer.folder': withDefinition },
    }],
    calls: [],
  }));
  const { options: again } = await load(optionsOf(existingDev, existing));
  const answererAgain = again.sessionConfigCompletions?.computer as NonNullable<typeof again.sessionConfigCompletions>['computer'];
  const rows = await answererAgain({ property: 'computer', query: '', workingDirectory: `file://${withDefinition}` });
  expect(rows.map((one) => one.value)).toContain('computer://existing');
  expect(rows.some((one) => one.value === `devcontainer://${withDefinition}`)).toBe(false);
  // Each load's own listing, and each answer's.
  await answered(dockerState, 3);
  await answered(existing, 2);
});

it('reads a folder holding a comma whole, so the picker offers no second container', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir, true, 'work, two-');
  const existing = join(dir, 'docker-existing.json');
  const existingDev = join(dir, 'dev-existing.json');
  // The machine this folder already became, labelled with the whole path.
  writeFileSync(existing, JSON.stringify({
    machines: [{
      name: 'existing',
      image: 'node:22',
      labels: { 'ahpd.computer': '1', 'ahpd.devcontainer.folder': folder },
    }],
    calls: [],
  }));
  const { options: loaded } = await load(optionsOf(existingDev, existing));
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];

  // The label's value holds the same comma the listing's own column is joined
  // by, so a listing that read that column would report a folder that is not
  // this one - and offer to make a second container beside the first.
  const rows = await answerer({ property: 'computer', query: '', workingDirectory: `file://${folder}` });
  expect(rows.map((one) => one.value)).toContain('computer://existing');
  expect(rows.some((one) => one.value === `devcontainer://${folder}`)).toBe(false);

  // A daemon with no machine for the folder offers the container as before.
  const { options: fresh } = await load(optionsOf(devState, dockerState));
  const freshAnswerer = fresh.sessionConfigCompletions?.computer as NonNullable<typeof fresh.sessionConfigCompletions>['computer'];
  const offered = await freshAnswerer({ property: 'computer', query: '', workingDirectory: `file://${folder}` });
  expect(offered.map((one) => one.value)).toContain(`devcontainer://${folder}`);

  // Each answer's own listing.
  await answered(existing, 2);
  await answered(dockerState, 1);
});

/*
 * The same row for a folder whose name a URI had to escape: `file:///w/my%20app`
 * is the same folder as `/w/my app`, and only a decode says so.
 */
it('offers the dev container of a folder whose name a URI had to escape', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = mkdtempSync(join(dir, 'my app'));
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];

  const offered = await answerer({
    property: 'computer',
    query: '',
    workingDirectory: pathToFileURL(folder).href,
  });
  expect(offered.some((one) => one.value === `devcontainer://${folder}`)).toBe(true);
  await answered(dockerState, 2);
});

it('makes it at session start, with the harness needs in the override config', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'claude-home');
  const folder = workspace(dir);
  mkdirSync(configDir);

  const { options: loaded } = await load(optionsOf(devState, dockerState), [
    agentWith({
      config: { directory: configDir, target: '/ahpd/config', required: true },
      key: { name: 'ANTHROPIC_API_KEY', default: 'from-the-agent' },
    }),
  ], join(dir, 'config'));
  const { client, open } = await room(loaded);
  const opened = await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder) as {
    snapshot: { state: { config?: { values?: Record<string, unknown> } } };
  };

  expect(upOf(devState)).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
    // The need the harness declared that names a host path, which the CLI's
    // own `--mount` takes.
    '--mount', `type=bind,source=${configDir},target=/ahpd/config`,
    '--override-config', '<override>',
  ]);
  /*
   * And the need that names a variable, as `containerEnv`: the container's own
   * environment, which every later `docker exec` in there inherits, where
   * `up --remote-env` reaches only the lifecycle commands `up` runs.
   */
  expect(overrideOf(devState)?.config).toMatchObject({
    image: 'base',
    containerEnv: { ANTHROPIC_API_KEY: 'from-the-agent' },
  });
  expect(upOf(devState)).not.toContain('--remote-env');

  // What the session actually runs in is the machine this host made for it,
  // under the name the create gave, not the source the person picked.
  expect(opened.snapshot.state.config?.values?.computer).toMatch(/^computer:\/\/ahpd-computer-\w{8}$/);
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await answered(dockerState, 2);
});

it('counts a machine made for a session against max, as one made from the form is', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  // A machine the host already holds, made from somewhere else entirely.
  writeFileSync(dockerState, JSON.stringify({
    machines: [{ name: 'held', image: 'node:22', labels: { 'ahpd.computer': '1' } }],
    calls: [],
  }));

  const { options: loaded } = await load(optionsOf(devState, dockerState, { max: 1 }), [agentWith()], join(dir, 'config'));
  const { open } = await room(loaded);
  await expect(open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder))
    .rejects.toThrow(/This host holds 1 computers already/);
  // Nothing was asked of the CLI, which is what the count is for.
  expect(devHeld(devState).calls).toEqual([]);
});

it('binds one entry where a copy-in is the same bind as a need', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const shared = join(dir, 'shared');
  mkdirSync(shared);
  const folder = workspace(dir);

  const { options: loaded } = await load(optionsOf(devState, dockerState), [
    agentWith({
      config: { directory: shared, target: '/ahpd/shared', required: true },
      // The same bind by another road. The target check already accepts the
      // pair, so the CLI has to collapse it: the CLI's own `devcontainer up`
      // refuses two `--mount`s landing at one place.
      copy: { source: shared, target: '/ahpd/shared', required: true },
    }),
  ], join(dir, 'config'));
  const { client, open } = await room(loaded);
  await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder);

  const up = devHeld(devState).calls.find((one) => one[0] === 'up');
  const bind = `type=bind,source=${shared},target=/ahpd/shared`;
  expect(up?.filter((one) => one === bind)).toHaveLength(1);
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await answered(dockerState, 2);
});

/*
 * Task 05: VS Code's connect finds or makes the same computer.
 */
it('connect twice for one folder makes one container', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  // The host inside is the fake, run for real through the Docker exec: the
  // launcher holds the pipes, and a `passthrough` prefix is what makes the
  // fixture spawn it rather than only record the line.
  writeFileSync(devState, JSON.stringify({ calls: [] }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], passthrough: [process.execPath] }));
  const { options: loaded } = await load(optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      host: [process.execPath, HOST],
      install: false,
      plugins: ['@ahpd/agent-cofold'],
    },
  }), [agentWith()], join(dir, 'config'));

  const p = peer();
  const client = createHost(loaded).accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'] },
  });
  const connect = (connectionId: string) => client.handle({
    method: 'vscode/devContainers/connect',
    params: { connectionId, workspaceFolder: folder, name: 'Box' },
  });

  await connect('one');
  await connect('two');

  // One container, whichever way it was asked for: the second connect found
  // the computer the first one made.
  expect(devHeld(devState).calls.filter((one) => one[0] === 'up')).toHaveLength(1);
  expect(dockerHeld(dockerState).machines).toHaveLength(1);
  expect(dockerHeld(dockerState).machines[0]?.labels).toMatchObject({
    'ahpd.computer': '1',
    'ahpd.devcontainer.folder': folder,
  });

  // Ending the relays leaves the computer where it is.
  await client.handle({ method: 'vscode/devContainers/disconnect', params: { connectionId: 'one' } });
  await client.handle({ method: 'vscode/devContainers/disconnect', params: { connectionId: 'two' } });
  await until(() => devHeld(devState).calls.some((one) => one[0] === 'up'));
  expect(dockerHeld(dockerState).machines).toHaveLength(1);
  await answered(dockerState, 3);
});

it('installs the server in a container at the daemon\'s version, from the plugin\'s context', async () => {
  const root = temp();
  const devState = join(root, 'dev.json');
  const dockerState = join(root, 'docker.json');
  writeFileSync(devState, JSON.stringify({ calls: [], commands: [], hostPresent: false, passthrough: [process.execPath] }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], hostPresent: false, passthrough: [process.execPath] }));
  const { options, problems } = await loadPlugins(
    [{ name: SOURCE, options: optionsOf(devState, dockerState, {
      devcontainer: {
        command: process.execPath,
        args: [DEV],
        env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
        host: [process.execPath, HOST],
        plugins: ['@ahpd/agent-cofold'],
      },
    }) }],
    { base: { path: '/tmp/computer-devcontainer', agents: [], resources: fileResources() }, configDir: join(root, 'config'), cwd: REPO, log: () => {}, version: '0.10.4' },
  );
  expect(problems).toEqual([]);
  const closed: (string | undefined)[] = [];
  const said: string[] = [];
  await options.containers?.connect(
    { connectionId: 'a', workspaceFolder: workspace(root), name: 'Box' },
    { message: (t) => { said.push(t); }, output: () => {}, close: (why) => { closed.push(why); } },
  );
  expect(dockerHeld(dockerState).commands.map((one) => one.command.at(-1)))
    .toContain('npm i -g @ahpd/server@0.10.4 --allow-scripts=node-pty');
  for (let i = 0; i < 600 && said.length === 0 && closed.length === 0; i++) await new Promise((r) => { setTimeout(r, 5); });
  await answered(dockerState, 2);
});

/*
 * Task 08: only the folders the operator named, on every route.
 */
it('refuses a folder outside the list on every route, and makes one inside it', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const allowed = workspace(dir);
  const outside = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      folders: [allowed],
    },
  }), [], join(dir, 'config'));
  const provider = providerOf(loaded);
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const silent = { message: () => {}, output: () => {}, close: () => {} };
  const computers = loaded.computers;
  /** What the session route does when a session names this source. */
  const starting = async (source: string): Promise<unknown> => {
    if (computers?.create === undefined) throw new Error('the plugin registered no create on its computers port');
    return computers.create({ source, session: 'ahp-session:/one', provider: 'echo' });
  };

  // The create body, the session setting and the relay's connect are refused
  // with the one sentence, and the folder outside is never built.
  await expect(provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder: outside } }),
    encoding: 'utf-8',
  })).rejects.toThrow(new RegExp(`${outside} is not one of them`));
  await expect(starting(`devcontainer://${outside}`)).rejects.toThrow(new RegExp(`${outside} is not one of them`));
  await expect(loaded.containers?.connect(
    { connectionId: 'a', workspaceFolder: outside, name: 'Box' },
    silent,
  )).rejects.toThrow(new RegExp(`${outside} is not one of them`));

  // The picker's row is gone for it and still there for the folder named.
  const rowFor = async (where: string): Promise<boolean> =>
    (await answerer({ property: 'computer', query: '', workingDirectory: `file://${where}` }))
      .some((one) => one.value === `devcontainer://${where}`);
  expect(await rowFor(outside)).toBe(false);
  expect(await rowFor(allowed)).toBe(true);
  expect(devHeld(devState).calls).toEqual([]);

  // And a folder the list names is made, on the create body.
  await provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder: allowed } }),
    encoding: 'utf-8',
  });
  expect(upOf(devState)).toEqual([
    'up',
    '--workspace-folder', allowed,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${allowed}`,
    '--override-config', '<override>',
  ]);
  await answered(dockerState, 6);
});

/*
 * Task 07: a host more than one person uses makes no dev container until its
 * operator names the folders it may be made from.
 */
it('makes no dev container on a host with users until the operator names the folders', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  const options = optionsOf(devState, dockerState);
  const { options: loaded } = await load(options, [], configDir, true);
  const provider = providerOf(loaded);
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const silent = { message: () => {}, output: () => {}, close: () => {} };
  const computers = loaded.computers;
  /** What the session route does when a session names this source. */
  const starting = async (source: string): Promise<unknown> => {
    if (computers?.create === undefined) throw new Error('the plugin registered no create on its computers port');
    return computers.create({ source, session: 'ahp-session:/one', provider: 'echo' });
  };
  const named = /names the folders it may use in devcontainer\.folders/;

  // Every route, with the one sentence: anybody who may write a
  // `devcontainer.json` is otherwise anybody who may ask for `--privileged` on
  // the host several people sign in to.
  await expect(provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  })).rejects.toThrow(named);
  await expect(starting(`devcontainer://${folder}`)).rejects.toThrow(named);
  await expect(loaded.containers?.connect(
    { connectionId: 'a', workspaceFolder: folder, name: 'Box' },
    silent,
  )).rejects.toThrow(named);
  // The picker draws no row either, so the form cannot be filled in.
  expect((await answerer({ property: 'computer', query: '', workingDirectory: `file://${folder}` }))
    .some((one) => one.value.startsWith('devcontainer://'))).toBe(false);
  expect(devHeld(devState).calls).toEqual([]);

  // Naming the folder is the opting in, and it is then built as it always was.
  const { options: naming } = await load(optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      folders: [folder],
    },
  }), [], configDir, true);
  await providerOf(naming).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });
  expect(upOf(devState)).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
    '--override-config', '<override>',
  ]);
  await answered(dockerState, 6);
});

it('switches every route off when devcontainer is false', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState, {
    devcontainer: false,
  }), [], join(dir, 'config'));
  const provider = providerOf(loaded);
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const computers = loaded.computers;
  /** What the session route does when a session names this source. */
  const starting = async (source: string): Promise<unknown> => {
    if (computers?.create === undefined) throw new Error('the plugin registered no create on its computers port');
    return computers.create({ source, session: 'ahp-session:/one', provider: 'echo' });
  };

  // The launcher is not contributed at all, so there is no connect to refuse.
  expect(loaded.containers).toBeUndefined();
  // And the form is drawn no field for the route: a control the host refuses is
  // a form that cannot be filled in.
  const schema = loaded.resourceProviders?.computer as {
    describe(): { manifest?: { properties?: Record<string, unknown> } };
  };
  expect(Object.keys(schema.describe().manifest?.properties ?? {}))
    .toEqual(['runtime', 'image', 'cpus', 'memory', 'workdir']);
  await expect(provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  })).rejects.toThrow(/switched off on this host/);
  await expect(starting(`devcontainer://${folder}`)).rejects.toThrow(/switched off on this host/);
  expect((await answerer({ property: 'computer', query: '', workingDirectory: `file://${folder}` }))
    .some((one) => one.value.startsWith('devcontainer://'))).toBe(false);
  expect(devHeld(devState).calls).toEqual([]);
  expect(dockerHeld(dockerState).machines).toEqual([]);
  await answered(dockerState, 1);
});

/*
 * The routes, and the folder each of them is handed.
 */
it('hands every route the folder as it resolves, and refuses one that is not a path', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const link = join(dir, 'linked');
  symlinkSync(folder, link);
  const there = realpathSync(link);
  const { options: loaded } = await load(optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      folders: [link],
    },
  }), [], join(dir, 'config'));
  const provider = providerOf(loaded);

  // The list names the link and the body names it too, so they are the same
  // folder to the check and only one spelling goes on to the CLI: a container
  // made for one and looked up by the other would be a second container.
  await provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder: link } }),
    encoding: 'utf-8',
  });
  expect(upOf(devState)).toEqual([
    'up',
    '--workspace-folder', there,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${there}`,
    '--override-config', '<override>',
  ]);
  await answered(dockerState, 4);
});

it('refuses a devcontainer.folders entry that is not absolute', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const loaded = await load(optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      folders: ['./work'],
    },
  }));
  expect(loaded.problems.join('\n')).toMatch(/devcontainer\.folders are absolute paths/);
});

/*
 * The fakes refuse what the real ones refuse, so a manifest this host cannot
 * honour fails here rather than passing and failing against the real program.
 */

/*
 * A read-only bind is what `cliMount` used to write as `,readonly`, and
 * `,readonly` is not one of the keys the CLI's `--mount` takes - so the CLI
 * answers "Unmatched argument format" and builds nothing. It is the override
 * config's `mounts` now, which the CLI reads as part of the folder's own
 * definition.
 */
it('mounts a read-only need, once it is in the config the CLI is handed', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'claude-home');
  const folder = workspace(dir);
  mkdirSync(configDir);

  const { options: loaded } = await load(optionsOf(devState, dockerState), [
    agentWith({
      config: { directory: configDir, target: '/ahpd/config', required: true, readOnly: true },
    }),
  ], join(dir, 'config'));
  const { client, open } = await room(loaded);
  await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder);

  // No `--mount` at all: the CLI would refuse this one, and the override is
  // where a read-only mount goes.
  expect(upOf(devState)).not.toContain('--mount');
  // The CLI's string spelling: it renders an object mount as `type`, `source`
  // and `target` and drops `readOnly`, so only the string reaches Docker
  // read-only.
  expect(overrideOf(devState)?.config).toMatchObject({
    image: 'base',
    mounts: [`type=bind,source=${configDir},target=/ahpd/config,readonly`],
  });
  expect(dockerHeld(dockerState).machines).toHaveLength(1);
  expect(dockerHeld(dockerState).machines[0]?.mounts).toContain(`${configDir}:/ahpd/config:ro`);
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
});

/*
 * The override file holds environment values on disk while `up` runs, and it
 * is gone either way: a `up` that fails still must not leave one behind.
 */
it('takes the override file away after a failed up, as after a good one', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(devState, JSON.stringify({ calls: [], upFailure: 'the image would not pull' }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));

  await expect(providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  })).rejects.toThrow(/would not pull/);

  expect(overrideOf(devState)?.mode).toBe(0o600);
  expect(overrideOf(devState)?.gone).toBe(true);
  expect(dockerHeld(dockerState).machines).toEqual([]);
  await answered(dockerState, 2);
});

/*
 * A need's variable, as `containerEnv`, is the container's own environment:
 * every process in there inherits it, so a command run after the create sees
 * it. `up --remote-env` reaches only the lifecycle commands `up` runs and
 * nothing afterwards.
 */
it('gives a command run after the create a need\'s variable, as the container\'s own environment', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(devState, JSON.stringify({ calls: [], metadata: [{ remoteUser: 'vscode' }] }));
  const { options: loaded } = await load(optionsOf(devState, dockerState), [
    agentWith({ key: { name: 'ANTHROPIC_API_KEY', default: 'from-the-agent' } }),
  ], join(dir, 'config'));
  const { client, open } = await room(loaded);
  const opened = await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder) as {
    snapshot: { state: { config?: { values?: Record<string, unknown> } } };
  };

  expect(overrideOf(devState)?.config).toMatchObject({ containerEnv: { ANTHROPIC_API_KEY: 'from-the-agent' } });

  // The variable is the container's own environment, which every `docker exec`
  // inherits: it is on the machine Docker holds, and on no command's flags.
  const id = String(opened.snapshot.state.config?.values?.computer ?? '').slice('computer://'.length);
  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  await tool.run({ id, command: 'true' }, {} as ToolCall);
  const held = dockerHeld(dockerState) as DockerHeld & { machines: { env?: Record<string, string> }[] };
  expect(held.machines[0]?.env).toMatchObject({ ANTHROPIC_API_KEY: 'from-the-agent' });
  expect(held.commands.length).toBeGreaterThan(0);
  expect(held.commands.filter((one) => 'ANTHROPIC_API_KEY' in one.env)).toEqual([]);
  expect(held.calls.flat().filter((one) => one.includes('from-the-agent'))).toEqual([]);
  // And the probe kept beside the configuration holds only what the container
  // does not already hold, so the value is not written there either.
  const kept = readFileSync(join(dir, 'config', 'computers.json'), 'utf8');
  expect(JSON.parse(kept)).toMatchObject({ [id]: { probe: { container: 'abc123' } } });
  expect(kept).not.toContain('from-the-agent');
  expect(kept).not.toContain('ANTHROPIC_API_KEY');
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await answered(dockerState, 4);
});

/*
 * A need named from the vault never goes through `up`: the real CLI writes
 * `containerEnv` into its own `docker run -e NAME=value`, logs that line and
 * leaves it in `docker inspect`. It is held with the machine and given on each
 * `docker exec`, by name, with the value in docker's own environment.
 */

/** A vault holding `values` and nothing else, which records what it was asked for. */
const holding = (values: Record<string, string>): Vault & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    get: async (name) => { asked.push(name); return values[name]; },
    set: async () => {},
    delete: async () => false,
    list: async () => Object.keys(values),
  };
};

/** The plugin with a vault and its log kept, as a daemon starting again loads it. */
const loadVaulted = async (pluginOptions: Record<string, unknown>, agents: Agent[], configDir: string, vault: Vault) => {
  const lines: string[] = [];
  const { options, problems } = await loadPlugins(
    [{ name: SOURCE, options: pluginOptions }],
    {
      base: { path: '/tmp/computer-devcontainer', agents, resources: fileResources(), vault },
      configDir,
      cwd: REPO,
      log: (line) => { lines.push(line); },
    },
  );
  expect(problems).toEqual([]);
  return { options, lines };
};

const VAULTED: Record<string, MachineNeed> = {
  anthropicKey: { name: 'ANTHROPIC_API_KEY' },
  region: { name: 'REGION', default: 'eu' },
};

it('keeps a vault-named need out of the override and every argv, and gives it on each docker exec', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  const { options: loaded, lines } = await loadVaulted(
    optionsOf(devState, dockerState, { needs: { anthropicKey: { $secret: 'user:ada/token' } } }),
    [agentWith(VAULTED)],
    configDir,
    holding({ 'user:ada/token': 'ada-token' }),
  );
  const create = loaded.computers?.create as NonNullable<NonNullable<HostOptions['computers']>['create']>;
  const id = String(await create({ source: `devcontainer://${folder}`, session: 'ahp-session:/one', provider: 'echo', owner: 'user:ada' }));

  // The plain need is the container's own environment; the vault's is not in
  // the file the CLI read, nor in the container Docker holds.
  const override = overrideOf(devState);
  expect(override?.config.containerEnv).toEqual({ REGION: 'eu' });
  expect(JSON.stringify(override?.config)).not.toContain('ANTHROPIC_API_KEY');
  expect(JSON.stringify(override?.config)).not.toContain('ada-token');
  const machine = dockerHeld(dockerState).machines[0] as { env?: Record<string, string> };
  expect(machine.env).toEqual({ REGION: 'eu' });

  // Each command is given it by name, and the command in the container has it.
  const how = await loaded.computers?.how(id, { command: 'node', args: ['server.mjs'] });
  expect(how?.args.slice(-5)).toEqual(['-e', 'ANTHROPIC_API_KEY', 'abc123', 'node', 'server.mjs']);
  expect(how?.env?.ANTHROPIC_API_KEY).toBe('ada-token');
  const outer: Record<string, string | undefined> = { ...process.env };
  delete outer.ANTHROPIC_API_KEY;
  spawnSync(how?.command as string, how?.args as string[], { encoding: 'utf8', env: { ...outer, ...how?.env } });
  expect(dockerHeld(dockerState).commands.at(-1)?.env.ANTHROPIC_API_KEY).toBe('ada-token');

  // A tool's command too.
  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  await tool.run({ id, command: 'true' }, {} as ToolCall);
  expect(dockerHeld(dockerState).commands.at(-1)?.env.ANTHROPIC_API_KEY).toBe('ada-token');

  // And the value is in no argv either program saw, in no file the daemon
  // keeps and in no line it logged.
  expect(dockerHeld(dockerState).calls.flat().filter((one) => one.includes('ada-token'))).toEqual([]);
  expect(devHeld(devState).calls.flat().filter((one) => one.includes('ada-token'))).toEqual([]);
  expect(readFileSync(join(configDir, 'computers.json'), 'utf8')).not.toContain('ada-token');
  expect(lines.join('\n')).not.toContain('ada-token');
  await answered(dockerState, dockerHeld(dockerState).calls.length);
});

/*
 * A `remoteEnv` value is the definition's and may be this host's own, pulled in
 * with `${localEnv:NAME}`: it reaches every command by name, and the probe kept
 * beside the config still holds only what the container's `Config.Env` does not.
 */
it('passes a remoteEnv value by name to every command, and keeps it out of the stored probe', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  writeFileSync(devState, JSON.stringify({
    calls: [],
    metadata: [{ remoteUser: 'vscode', remoteEnv: { FROM_HOST: '${localEnv:AHPD_TEST_SECRET}' } }],
  }));
  const { options: loaded } = await load({
    ...optionsOf(devState, dockerState),
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState, AHPD_TEST_SECRET: 'local-secret' },
    },
  }, [], configDir);
  await providerOf(loaded).write('computer://box', { data: JSON.stringify({ devcontainer: { folder } }), encoding: 'utf-8' });

  const how = await loaded.computers?.how('box', { command: 'node' });
  expect(how?.args).toEqual([
    DOCKER, 'exec', '-i', '-u', 'vscode',
    '-e', 'PATH=/usr/bin', '-e', 'HOME=/root', '-e', 'FROM_HOST',
    '-w', mounted(folder), 'abc123', 'node',
  ]);
  expect(how?.env).toEqual({ DOCKER_FAKE_STATE: dockerState, FROM_HOST: 'local-secret' });
  const outer: Record<string, string | undefined> = { ...process.env };
  delete outer.AHPD_TEST_SECRET;
  spawnSync(how?.command as string, how?.args as string[], { encoding: 'utf8', env: { ...outer, ...how?.env } });
  expect(dockerHeld(dockerState).commands.at(-1)?.env.FROM_HOST).toBe('local-secret');

  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  await tool.run({ id: 'box', command: 'true' }, {} as ToolCall);
  expect(dockerHeld(dockerState).commands.at(-1)?.env.FROM_HOST).toBe('local-secret');

  expect(dockerHeld(dockerState).calls.flat().filter((one) => one.includes('local-secret'))).toEqual([]);
  // The stored probe is what the login shell held and the container does not:
  // the fake's two variables, and nothing the definition's `remoteEnv` adds.
  const kept = JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8')) as Record<string, { probe?: { env: Record<string, string> } }>;
  expect(kept.box?.probe?.env).toEqual({ PATH: '/usr/bin', HOME: '/root' });
  expect(JSON.stringify(kept)).not.toContain('local-secret');
  await answered(dockerState, dockerHeld(dockerState).calls.length);
});

it('reads a dev container\'s vault-named need again after a restart, for the owner in its record', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  const pluginOptions = (more: Record<string, unknown>) => optionsOf(devState, dockerState, {
    profiles: { claude: { agents: ['echo'], needs: { anthropicKey: { $secret: 'user:ada/token' } }, ...more } },
  });
  const first = await loadVaulted(pluginOptions({}), [agentWith(VAULTED)], configDir, holding({ 'user:ada/token': 'ada-token' }));
  await (providerOf(first.options) as unknown as {
    write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
  }).write('computer://box', {
    data: JSON.stringify({ profile: 'claude', source: 'devcontainer', devcontainer: folder }),
    encoding: 'utf-8',
  }, 'user:ada');
  expect(overrideOf(devState)?.config.containerEnv).toEqual({ REGION: 'eu' });

  // The daemon again, with the same vault: the value is read again, and Ada's
  // own secret is readable because the record beside the config says the
  // machine is hers.
  const store = holding({ 'user:ada/token': 'ada-token' });
  const again = await loadVaulted(pluginOptions({}), [agentWith(VAULTED)], configDir, store);
  expect((await again.options.computers?.how('box', { command: 'true' }))?.env?.ANTHROPIC_API_KEY).toBe('ada-token');
  expect(store.asked).toEqual(['user:ada/token']);

  // With the secret gone and no say from the profile, every command fails
  // naming the need.
  const gone = await loadVaulted(pluginOptions({}), [agentWith(VAULTED)], configDir, holding({}));
  for (let i = 0; i < 2; i++) {
    const refused = await gone.options.computers?.how('box', { command: 'true' }).catch((error: unknown) => error);
    expect((refused as Error).message).toContain('machine need anthropicKey names user:ada/token');
  }

  // With `drop`, the command runs without it and the line is logged.
  const dropped = await loadVaulted(pluginOptions({ secretUnreadable: 'drop' }), [agentWith(VAULTED)], configDir, holding({}));
  const how = await dropped.options.computers?.how('box', { command: 'true' });
  expect(how?.args).not.toContain('ANTHROPIC_API_KEY');
  expect(how?.env?.ANTHROPIC_API_KEY).toBeUndefined();
  expect(dropped.lines.filter((one) => one.includes('box is reached without ANTHROPIC_API_KEY: machine need anthropicKey'))).toHaveLength(1);
  await answered(dockerState, dockerHeld(dockerState).calls.length);
});

/*
 * The agents a machine was made for are a label a picker reads, and a `docker`
 * machine and a dev container answer it the same way. As a `runArgs` label
 * rather than an id one: the id labels are how the CLI finds the container.
 */
it('records the agents a body was made for, and the limits, in the override config', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState), [
    agentWith({ config: { directory: folder, target: folder, required: true } }),
  ], join(dir, 'config'));
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ source: 'devcontainer', runtime: 'docker', image: '', devcontainer: folder, cpus: '2', memory: '2g', workdir: '/work' }),
    encoding: 'utf-8',
  });

  expect(overrideOf(devState)?.config).toMatchObject({
    runArgs: ['--label', 'ahpd.name=box', '--cpus', '2', '--memory', '2g'],
    // The working directory is where the folder lands in the container, which
    // is what `-w` reads back through the mount: `workspaceFolder` alone names
    // a directory the CLI does not mount the folder at.
    workspaceFolder: '/work',
    workspaceMount: `source=${folder},target=/work,type=bind`,
  });
  // The agents the profile prepared it for, on the container as a plain label
  // beside exactly the two id labels.
  expect(dockerHeld(dockerState).machines[0]?.labels).toMatchObject({
    'ahpd.computer': '1',
    'ahpd.devcontainer.folder': folder,
    'ahpd.name': 'box',
  });
  await answered(dockerState, 6);
});

/*
 * `--id-label` is what makes a second `up` answer the container the first one
 * made rather than build a second beside it. A fake that always made a new one
 * would pass a test that a real daemon fails.
 *
 * A second name for the same folder is refused rather than ignored: the name
 * is a `runArgs` label, set when the container is made, so a create that found
 * the first one's container cannot rename it.
 */
it('answers the container its labels already name, and refuses a second name for it', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const provider = providerOf(loaded);
  await provider.write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });
  await expect(provider.write('computer://other', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  })).rejects.toThrow(new RegExp(`${folder} is already the computer box`));

  expect(devHeld(devState).calls.filter((one) => one[0] === 'up')).toHaveLength(2);
  // Both answered the same container, the listing holds one machine, and the
  // machine is listed and removed by the name the first create gave it.
  expect((await provider.list('computer://')).map((one) => one.name)).toEqual(['box']);
  expect(dockerHeld(dockerState).machines).toHaveLength(1);
  // The container carries exactly the two id labels, and the name as a plain
  // one: a third id label would give the folder a second container.
  expect(dockerHeld(dockerState).machines[0]?.labels).toEqual({
    'ahpd.computer': '1',
    'ahpd.devcontainer.folder': folder,
    'ahpd.name': 'box',
    'devcontainer.metadata': '[{"remoteUser":"dev"}]',
  });
  await provider.remove('computer://box');
  expect(dockerHeld(dockerState).machines).toEqual([]);
  await answered(dockerState, 8);
});

/*
 * `--override-config` replaces the folder's file rather than merging with it,
 * so an override holding only what this host adds names no recipe at all. The
 * CLI says so by name rather than building an image from nothing, and the fake
 * has to say it too, or an override missing the folder's recipe would pass
 * here and fail there.
 */
it('refuses an override config that names no recipe, as the real CLI does', () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  writeFileSync(devState, JSON.stringify({ calls: [] }));
  const folder = workspace(dir);
  const held = join(dir, 'override.json');
  writeFileSync(held, JSON.stringify({ containerEnv: { A: '1' } }));
  const ran = spawnSync(
    process.execPath,
    [DEV, 'up', '--workspace-folder', folder, '--override-config', held],
    { encoding: 'utf8', env: { ...process.env, DEVCONTAINER_FAKE_STATE: devState } },
  );
  expect(ran.status).not.toBe(0);
  expect(ran.stderr).toContain('missing one of "image", "dockerFile" or "dockerComposeFile"');
});

/*
 * `docker exec` refuses a container that is not running, whatever its state
 * says, and that refusal is the whole of what a stopped dev container is
 * reached through.
 */
it('refuses a command in a container that is not running, with the daemon\'s sentence', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(dockerState, JSON.stringify({
    machines: [{
      name: 'stopped',
      image: 'devcontainer',
      labels: { 'ahpd.computer': '1', 'ahpd.devcontainer.folder': folder },
      state: 'exited',
    }],
    calls: [],
  }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  const ran = String(await tool.run({ id: 'stopped', command: 'true' }, {} as ToolCall));
  expect(ran).toContain('container stopped is not running');
  expect(ran).toContain('exit 1');
  expect(devHeld(devState).calls).toEqual([]);
});

/*
 * A container an older connect made carries the CLI's folder label and none of
 * this host's, and `up` with the id labels would make a second one beside it.
 * The connect that adopts it records it beside the configuration, owner or no
 * owner, so it is a computer from then on: listed, and found again by its folder
 * on the next connect and on the first connect after a restart.
 */
it('finds an adopted container again by its folder, on a second connect and after a restart', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  const id = 'c0ffee00c0ffee00';
  writeFileSync(devState, JSON.stringify({ calls: [] }));
  writeFileSync(dockerState, JSON.stringify({
    machines: [{
      id,
      name: 'older',
      image: 'devcontainer',
      // Somebody else's as far as this host's labels go: no `ahpd.computer`.
      bare: true,
      labels: { 'devcontainer.local_folder': folder },
      mounts: [`${folder}:${mounted(folder)}`],
      state: 'exited',
    }],
    calls: [],
    passthrough: [],
  }));
  const options = optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      host: [process.execPath, HOST],
      install: false,
      plugins: ['@ahpd/agent-cofold'],
    },
  });
  const silent = { message: () => {}, output: () => {}, close: () => {} };
  const { options: loaded } = await load(options, [], configDir);

  // A connect with nobody behind it, which is what a relay with no users is.
  await loaded.containers?.connect({ connectionId: 'one', workspaceFolder: folder, name: 'Box' }, silent);
  expect(JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8'))).toMatchObject({ [id]: { adopted: true } });
  expect((await providerOf(loaded).list('computer://')).map((one) => one.name)).toEqual([id]);

  // The second connect finds it by its folder, from the record.
  await loaded.containers?.connect({ connectionId: 'two', workspaceFolder: folder, name: 'Box' }, silent);
  // And so does a daemon started afterwards, which remembers nothing else.
  const { options: later } = await load(options, [], configDir);
  await later.containers?.connect({ connectionId: 'three', workspaceFolder: folder, name: 'Box' }, silent);

  expect(devHeld(devState).calls.filter((one) => one[0] === 'up')).toEqual([]);
  expect(dockerHeld(dockerState).machines).toHaveLength(1);
  expect(dockerHeld(dockerState).machines[0]?.state).toBe('running');
  loaded.containers?.disconnect('one');
  loaded.containers?.disconnect('two');
  later.containers?.disconnect('three');
});

/*
 * The folder's own definition is read before anything is written, so one that
 * does not parse is refused in its own words, not as a CLI that is missing,
 * and no override directory is left behind.
 */
it('refuses a definition that does not parse in its own words, and leaves no override behind', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": ');
  const scratch = join(dir, 'tmp');
  mkdirSync(scratch);
  const before = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  try {
    const { options: loaded } = await load(optionsOf(devState, dockerState));
    const refused = await providerOf(loaded).write('computer://box', {
      data: JSON.stringify({ devcontainer: { folder } }),
      encoding: 'utf-8',
    }).then(() => undefined, (error: unknown) => error as Error);
    expect(refused?.message).toMatch(/devcontainer\.json and it does not parse/);
    expect(refused?.message).not.toMatch(/Install @devcontainers\/cli/);
    expect(readdirSync(scratch).filter((one) => one.startsWith('ahpd-devcontainer-'))).toEqual([]);
    expect(devHeld(devState).calls).toEqual([]);
  }
  finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
  await answered(dockerState, 1);
});

it('masks the values in the error a failed up is refused with', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(devState, JSON.stringify({ calls: [], upFailure: 'Start: Run: docker run -e SECRET=hunter2 -e "QUOTED=a b" base\nError: the image would not pull' }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const refused = await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  }).then(() => undefined, (error: unknown) => error as Error);
  expect(refused?.message).toMatch(/would not pull/);
  expect(refused?.message).toContain('SECRET=<set>');
  expect(refused?.message).not.toContain('hunter2');
  expect(refused?.message).not.toContain('a b');
  await answered(dockerState, 2);
});

/*
 * The JSONC reader takes a trailing comma out only where it is JSONC's: a comma
 * inside a string is part of the value.
 */
it('reads a definition with comments and trailing commas, and keeps a comma inside a string', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), [
    '{',
    '  // the image',
    '  "image": "base", /* and a block */',
    '  "postCreateCommand": "echo a, }",',
    '  "forwardPorts": [3000, ],',
    '}',
  ].join('\n'));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });
  expect(overrideOf(devState)?.config).toMatchObject({
    image: 'base',
    postCreateCommand: 'echo a, }',
    forwardPorts: [3000],
  });
  await answered(dockerState, 6);
});

/*
 * The probe kept for a machine names the container it was taken from, so an
 * entry naming another container is replaced rather than believed.
 */
it('rewrites the kept probe when up answers another container', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'computers.json'), JSON.stringify({
    box: { probe: { container: 'gone', env: { STALE: '1' } } },
  }));
  const { options: loaded } = await load(optionsOf(devState, dockerState), [], configDir);
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });
  const kept = JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8')) as Record<string, { probe?: { container: string; env: Record<string, string> } }>;
  expect(kept.box?.probe).toEqual({ container: 'abc123', env: { PATH: '/usr/bin', HOME: '/root' } });
  await answered(dockerState, 6);
});

/** The probes the scripted Docker was asked to run. */
const probes = (dockerState: string): number => dockerHeld(dockerState).commands
  .filter((one) => one.command.join(' ').includes('/proc/self/environ')).length;

it('reads the kept probe back after a restart, and runs no probe for it', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  const options = optionsOf(devState, dockerState);
  const { options: first } = await load(options, [], configDir);
  await providerOf(first).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });
  expect(probes(dockerState)).toBe(1);

  const { options: later } = await load(options, [], configDir);
  const tool = (later.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  expect(String(await tool.run({ id: 'box', command: 'true' }, {} as ToolCall))).toContain('exit 0');
  expect(probes(dockerState)).toBe(1);
  // And the command ran with what was kept.
  expect(dockerHeld(dockerState).commands.at(-1)?.env).toEqual({ PATH: '/usr/bin', HOME: '/root' });
  await answered(dockerState, 9);
});

it('keeps no probe that answered nothing, and probes again on the next command', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const configDir = join(dir, 'config');
  const folder = workspace(dir);
  // A shell that printed its markers and no environment between them.
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], probeEnv: {} }));
  const { options: loaded } = await load(optionsOf(devState, dockerState), [], configDir);
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });
  expect(probes(dockerState)).toBe(1);
  const kept = existsSync(join(configDir, 'computers.json'))
    ? JSON.parse(readFileSync(join(configDir, 'computers.json'), 'utf8')) as Record<string, { probe?: unknown }>
    : {};
  expect(kept.box?.probe).toBeUndefined();

  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec') as HostTool;
  await tool.run({ id: 'box', command: 'true' }, {} as ToolCall);
  expect(probes(dockerState)).toBe(2);
  await answered(dockerState, 9);
});

/*
 * A working directory no path can be read out of - another host's, or a name
 * holding an escaped `/` - is no folder this machine has, so the picker offers
 * no dev container row for it and still answers every other row.
 */
it('omits the dev container row for a URI it cannot read a folder from, and keeps the others', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  writeFileSync(dockerState, JSON.stringify({
    machines: [{ name: 'held', image: 'node:22', labels: { 'ahpd.computer': '1' } }],
    calls: [],
  }));
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  for (const workingDirectory of ['file://elsewhere/w/app', 'file:///w/a%2Fb']) {
    const rows = await answerer({ property: 'computer', query: '', workingDirectory });
    expect(rows.map((one) => one.value)).toEqual(['', 'computer://held']);
  }
  await answered(dockerState, 3);
});

/*
 * A dev container made for a session records the agent it was made for, and a
 * picker asking for another agent does not offer it: that agent's needs were
 * never put in it.
 */
it('keeps a dev container made for one agent out of another agent\'s picker', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState), [agentWith()], join(dir, 'config'));
  const { client, open } = await room(loaded);
  const opened = await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder) as {
    snapshot: { state: { config?: { values?: Record<string, unknown> } } };
  };
  const made = String(opened.snapshot.state.config?.values?.computer);
  expect(dockerHeld(dockerState).machines[0]?.labels).toMatchObject({ 'ahpd.agents': 'echo' });

  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const offered = async (provider: string): Promise<string[]> =>
    (await answerer({ property: 'computer', query: '', provider })).map((one) => one.value);
  expect(await offered('echo')).toContain(made);
  expect(await offered('cofold')).not.toContain(made);
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await answered(dockerState, 4);
});

/*
 * container/05 p7: a worktree's dev container gets its repository's git
 * directory through the override config, and runs every command as the host user.
 */
it('mounts a worktree folder\'s git directory through the override, and runs each docker exec as the host user', async () => {
  const dir = realpathSync(temp());
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) => spawnSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'first');
  const tree = join(dir, 'tree');
  run('worktree', 'add', '-q', '-b', 'work', tree);
  mkdirSync(join(tree, '.devcontainer'));
  writeFileSync(join(tree, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  const gitDir = join(repo, '.git');
  const me = `${String(process.getuid?.())}:${String(process.getgid?.())}`;

  const { options: loaded, problems } = await loadPlugins(
    [{ name: SOURCE, options: optionsOf(devState, dockerState) }],
    {
      base: { path: '/tmp/computer-devcontainer', agents: [agentWith()], resources: fileResources(), worktrees: gitWorktrees() },
      configDir: join(dir, 'config'),
      cwd: REPO,
      log: () => {},
    },
  );
  expect(problems).toEqual([]);
  const { client, open } = await room(loaded);
  const opened = await open('ahp-session:/one', { computer: `devcontainer://${tree}` }, tree) as {
    snapshot: { state: { config?: { values?: Record<string, unknown> } } };
  };

  const id = String(opened.snapshot.state.config?.values?.computer).replace('computer://', '');
  const config = overrideOf(devState)?.config ?? {};
  /*
   * The machine's own git directory, not the host's: a volume landed at
   * `/opt/ahpd/git`, the file this host wrote standing in for the tree's
   * `.git`, and the one path of the host's git directory a machine reads - its
   * objects, read-only, at the path of ahpd's own that the machine's own
   * `objects/info/alternates` names - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   */
  expect(config.mounts).toEqual([
    `type=bind,source=${gitDir}/objects,target=${MACHINE_OBJECTS},readonly`,
    `type=bind,source=${join(dir, 'config', 'computers.gitfile')},target=${tree}/.git,readonly`,
    `type=volume,source=ahpd-git-${id},target=/opt/ahpd/git`,
  ]);
  // The tree at its own path, so the `.git` file's bind lands on the file.
  expect(config.workspaceMount).toBe(`source=${tree},target=${tree},type=bind`);
  expect(config.workspaceFolder).toBe(tree);
  expect(config.runArgs).toEqual(expect.arrayContaining(['--label', `ahpd.user=${me}`, '--label', 'ahpd.git=fetch']));

  // Every `docker exec` into it as the host user: the probe at create, the
  // seed's own git commands, and a command after.
  const how = await loaded.computers?.how(id, { command: 'true' });
  const args = how?.args ?? [];
  expect(args[args.indexOf('-u') + 1]).toBe(me);
  const commands = dockerHeld(dockerState).commands;
  expect(commands.length).toBeGreaterThan(0);
  /*
   * The one command that is not the host user's is the chown that takes the
   * machine's own git directory for it: a named volume is root's until
   * somebody says otherwise, and only root can say. Every other command - the
   * probe, the seed's git, and the host's own afterwards - is the host user's,
   * so the agent's files in the tree are the host user's too.
   */
  const chowns = commands.filter((one) => one.command.includes('chown'));
  expect(chowns.map((one) => one.user)).toEqual(['0']);
  expect(commands.filter((one) => !one.command.includes('chown')).every((one) => one.user === me)).toBe(true);
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await answered(dockerState, 2);
});
