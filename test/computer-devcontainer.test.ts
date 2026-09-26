import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { dockerRuntime } from '../packages/computer/src/runtime.js';
import { loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { MachineNeed } from '../packages/sdk/src/types/machine.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A dev container is a computer, made from a folder's `devcontainer.json`.
 *
 * Both programs are scripted: the `devcontainer` fixture is the CLI and the
 * `docker` fixture is the runtime, and the first writes what it made into the
 * second, so a test sees the pair of them as one machine. What is under test
 * is what this package asks each of them for - the labels, the command, the
 * listing, the picker - and not the CLI's own work.
 */

const REPO = join(import.meta.dirname, '..');
const SOURCE = './packages/computer/src/index.ts';
const DEV = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-devc-'));
  return loose;
};

/** A folder that is a dev container, and one that is not. */
function workspace(root: string, withDefinition = true): string {
  const folder = mkdtempSync(join(root, 'work-'));
  if (withDefinition) {
    mkdirSync(join(folder, '.devcontainer'), { recursive: true });
    writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{}');
  }
  return folder;
}

/** What the scripted CLI recorded. */
interface DevHeld {
  calls: string[][];
  commands: string[];
}
const devHeld = (state: string): DevHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DevHeld
  : { calls: [], commands: [] });

/** What the scripted Docker holds. */
interface DockerHeld {
  machines: { name: string; image: string; labels?: Record<string, string>; mounts?: string[] }[];
  calls: string[][];
}
const dockerHeld = (state: string): DockerHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DockerHeld
  : { machines: [], calls: [] });

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

const load = (pluginOptions: Record<string, unknown>, agents: Agent[] = []) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: { path: '/tmp/computer-devcontainer', agents, resources: fileResources() }, configDir: REPO, cwd: REPO, log: () => {} },
);

const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }): Promise<void>;
  list(uri: string): Promise<{ name: string }[]>;
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
  // every later call about this container repeats.
  expect(devHeld(devState).calls[0]).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
  ]);
  // The container the CLI reported is what the provider lists, under the name
  // a listing reports, and the folder is what the machine is read by.
  expect((await provider.list('computer://')).map((one) => one.name)).toEqual(['abc123']);
  const runtime = dockerRuntime({
    command: process.execPath,
    args: [DOCKER],
    env: { DOCKER_FAKE_STATE: dockerState },
    label: 'ahpd.computer=1',
  });
  expect((await runtime.list())[0]).toMatchObject({ id: 'abc123', folder });
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
});

/*
 * Task 02: reached through the CLI, by the folder's own label.
 */
it('reaches it through devcontainer exec, with the folder from its label', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  const { options: loaded } = await load(optionsOf(devState, dockerState));
  await providerOf(loaded).write('computer://box', {
    data: JSON.stringify({ devcontainer: { folder } }),
    encoding: 'utf-8',
  });

  const how = await loaded.computers?.how('abc123', { command: 'node', args: ['server.mjs'] });
  expect(how).toEqual({
    command: process.execPath,
    args: [
      DEV, 'exec',
      '--workspace-folder', folder,
      '--id-label', 'ahpd.computer=1',
      '--id-label', `ahpd.devcontainer.folder=${folder}`,
      'node', 'server.mjs',
    ],
    // The CLI's own environment, which is the program's and not the machine's.
    env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
  });
  // A caller's environment travels as the CLI's own `--remote-env`.
  expect((await loaded.computers?.how('abc123', {
    command: 'node', args: ['server.mjs'], env: { A: '1' },
  }))?.args).toEqual([
    DEV, 'exec',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
    '--remote-env', 'A=1',
    'node', 'server.mjs',
  ]);

  // And a backend spawned through that descriptor really goes through the CLI:
  // the fixture records the command line, which is the proof the spawn is not
  // a `docker exec` wearing a dev container's name.
  const before = devHeld(devState).calls.length;
  spawnSync(how?.command as string, how?.args as string[], {
    encoding: 'utf8',
    env: { ...process.env, DEVCONTAINER_FAKE_STATE: devState },
  });
  expect(devHeld(devState).calls.length).toBe(before + 1);
  expect(devHeld(devState).calls.at(-1)).toContain('--workspace-folder');
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
});

it('makes it at session start, with the harness needs as --mount and --remote-env', async () => {
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
  ]);
  const { client, open } = await room(loaded);
  const opened = await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder) as {
    snapshot: { state: { config?: { values?: Record<string, unknown> } } };
  };

  const up = devHeld(devState).calls.find((one) => one[0] === 'up');
  expect(up).toEqual([
    'up',
    '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
    // The need the harness declared, as the CLI's own two flags.
    '--mount', `type=bind,source=${configDir},target=/ahpd/config`,
    '--remote-env', 'ANTHROPIC_API_KEY=from-the-agent',
  ]);

  // What the session actually runs in is the machine the CLI named, not the
  // source the person picked.
  expect(opened.snapshot.state.config?.values?.computer).toBe('computer://abc123');
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
});

/*
 * Task 05: VS Code's connect finds or makes the same computer.
 */
it('connect twice for one folder makes one container', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const folder = workspace(dir);
  // The host inside is the fake, run for real through the CLI's exec: the
  // launcher holds the pipes, and a `passthrough` prefix is what makes the
  // fixture spawn it rather than only record the line.
  writeFileSync(devState, JSON.stringify({ calls: [], commands: [], passthrough: [process.execPath] }));
  const { options: loaded } = await load(optionsOf(devState, dockerState, {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: dockerState },
      host: [process.execPath, HOST],
      install: false,
      plugins: ['@ahpd/agent-cofold'],
    },
  }), [agentWith()]);

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
});
