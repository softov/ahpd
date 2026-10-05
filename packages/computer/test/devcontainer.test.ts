import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { devContainer, hasDefinition, parseUp, pluginInstallLine, reachOf } from '../src/devcontainer.js';
import type { Probe } from '../src/devcontainer.js';
import { adoptedDevContainer } from '../src/runtime.js';
import type { DockerOptions } from '../src/runtime.js';
import type { ContainerSink } from '../../sdk/src/types/containers.js';

/*
 * The launcher: the Dev Container CLI, the host inside, and the pipes.
 *
 * The CLI is a fake and the host is a script, because `pnpm test` has no Docker
 * and this machine has no `devcontainer`. What is asserted is what the launcher
 * runs, what it refuses, and what crosses the pipes - not the CLI's own work.
 */

const CLI = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));

let root: string;
let state: string;
let dockerState: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-devcontainer-'));
  state = join(root, 'cli.json');
  dockerState = join(root, 'docker.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A folder that is a dev container, and one that is not. */
function workspace(withDefinition = true): string {
  const folder = mkdtempSync(join(root, 'work-'));
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
const at = (folder: string): string => `/workspaces/${basename(folder)}`;

const wrote = (extra: Record<string, unknown> = {}): void => {
  writeFileSync(state, JSON.stringify({ calls: [], commands: [], ...extra }));
  /*
   * The scripted Docker's half as well, from the same record.
   *
   * `up` puts the container in there, and everything after it - whether the
   * host inside is present, what a command answers, which line is refused - is
   * that container's own property rather than the CLI's, so one set of answers
   * reaches both.
   */
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], ...extra }));
};
const read = (): { calls: string[][]; commands: string[] } =>
  JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][]; commands: string[] };

/** A sink that keeps everything it was told, in order. */
function sink(): ContainerSink & { said: string[]; out: string[]; closed: (string | undefined)[] } {
  const said: string[] = [];
  const out: string[] = [];
  const closed: (string | undefined)[] = [];
  return { said, out, closed, message: (t) => { said.push(t); }, output: (t) => { out.push(t); }, close: (why) => { closed.push(why); } };
}

/**
 * The launcher, with the fake CLI making the container and the fake Docker
 * answering for it.
 *
 * The CLI runs `up` and nothing else, so every command inside the container is
 * the Docker fixture's `exec` - which is where this test now reads what the
 * launcher ran.
 */
const launcher = (extra: Record<string, unknown> = {}, options: { docker?: string } = {}) => devContainer({
  command: process.execPath,
  args: [CLI],
  docker: options.docker === undefined
    ? { command: process.execPath, args: [DOCKER], env: { DOCKER_FAKE_STATE: dockerState } }
    : { command: options.docker, args: [] },
  env: { DEVCONTAINER_FAKE_STATE: state, DOCKER_FAKE_STATE: dockerState },
  host: [process.execPath, HOST],
  // A backend, because `connect` refuses a host inside that would have none.
  // The fake host below never reads the configuration, so this only has to be
  // a spec; the refusal itself is checked with an empty list further down.
  plugins: ['@ahpd/agent-cofold'],
  ...extra,
});

/** What the scripted Docker recorded, as its own calls and the commands it ran. */
const ran = (): {
  calls: string[][];
  machines: { id?: string; name: string; labels?: Record<string, string>; state?: string }[];
  commands: { id: string; user?: string; workdir?: string; env: Record<string, string>; command: string[] }[];
} =>
  (existsSync(dockerState)
    ? JSON.parse(readFileSync(dockerState, 'utf8'))
    : { calls: [], machines: [], commands: [] }) as never;

/**
 * The shell lines the relay ran inside the container.
 *
 * Every command is a `docker exec ... /bin/sh -c <line>`, and the derivation's
 * own two probes are in there too: what is asserted is what the launcher asked
 * the container to do, not how it worked out how to ask.
 */
const shell = (): string[] => ran().commands
  .map((one) => one.command.join(' ').replace(/^\/bin\/sh -c /, ''))
  .filter((one) => !one.startsWith('getent passwd') && !one.includes('/proc/self/environ'));

const until = async (check: () => boolean, times = 600): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

const connect = { connectionId: 'a', workspaceFolder: '', name: 'Box' };

/** The same Docker the launcher runs, as the runtime's own options. */
const dockered = (): DockerOptions => ({
  command: process.execPath,
  args: [DOCKER],
  env: { DOCKER_FAKE_STATE: dockerState },
  label: 'ahpd.computer=1',
});

it('answers Docker and the launcher as two questions', async () => {
  wrote();
  expect(await launcher().docker()).toBe(true);
  expect(await launcher().available()).toBe(true);
  // No Docker is no to both.
  expect(await launcher({}, { docker: '/nonexistent/docker' }).docker()).toBe(false);
  expect(await launcher({}, { docker: '/nonexistent/docker' }).available()).toBe(false);
  // No CLI is a yes to Docker and a no to a container, which is the difference
  // the two methods are for.
  const noCli = devContainer({ command: '/nonexistent/devcontainer', docker: { command: process.execPath, args: [] }, env: { DEVCONTAINER_FAKE_STATE: state } });
  expect(await noCli.docker()).toBe(true);
  expect(await noCli.available()).toBe(false);
});

/*
 * The two questions are asked once, however often they are put.
 *
 * `isDockerAvailable` is ungated, so a connection that never signed in reaches
 * it, and `available()` is asked on every `initialize`: both were a process per
 * call, which made a handshake a way to spawn programs on this host. Whether a
 * program is installed does not change between two connections, so the answer
 * is held for the life of the launcher.
 */
it('asks whether the programs are there once, not once per call', async () => {
  wrote();
  const one = launcher();
  expect(await one.docker()).toBe(true);
  expect(await one.available()).toBe(true);
  // Together, which is the case a cache written after the answer would miss.
  expect(await Promise.all([one.docker(), one.available(), one.docker()]))
    .toEqual([true, true, true]);
  // The CLI is the half this fixture sees; the Docker half is the same code.
  expect(read().calls.filter((call) => call.includes('--version'))).toHaveLength(1);

  // And it is the launcher's own, not shared between two of them.
  const other = launcher();
  expect(await other.available()).toBe(true);
  expect(read().calls.filter((call) => call.includes('--version'))).toHaveLength(2);
});

it('knows a dev container by the CLI\'s own two names', () => {
  expect(hasDefinition(workspace())).toBe(true);
  const bare = mkdtempSync(join(root, 'bare-'));
  expect(hasDefinition(bare)).toBe(false);
  // The file at the root of the folder, which is the other name.
  writeFileSync(join(bare, '.devcontainer.json'), '{}');
  expect(hasDefinition(bare)).toBe(true);
});

it('reads the CLI\'s result from whichever line carries it', () => {
  expect(parseUp('{"type":"progress"}\n{"outcome":"success","containerId":"c1","remoteWorkspaceFolder":"/w"}\n'))
    .toEqual({ containerId: 'c1', remoteWorkspaceFolder: '/w' });
  // A failure outcome and a half-written result are not results.
  expect(parseUp('{"outcome":"error"}')).toBeUndefined();
  expect(parseUp('{"outcome":"success","containerId":"c1"}')).toBeUndefined();
  expect(parseUp('not json at all')).toBeUndefined();
});

it('refuses a folder that is not a dev container, and runs nothing', async () => {
  wrote();
  const where = sink();
  const bare = mkdtempSync(join(root, 'bare-'));
  await expect(launcher().connect({ ...connect, workspaceFolder: bare }, where)).rejects.toThrow(/no devcontainer\.json/);
  expect(read().calls).toEqual([]);
});

it('makes the container the folder asks for, and answers the reference shape', async () => {
  wrote();
  const folder = workspace();
  const where = sink();
  const made = await launcher().connect({ ...connect, workspaceFolder: folder }, where);

  expect(made).toEqual({
    address: 'devcontainer:abc123',
    remoteWorkspaceFolder: at(folder),
    hostWorkspaceFolder: folder,
  });
  // The id labels are the same pair every other call about this folder uses,
  // so the CLI finds the folder's own container rather than making another.
  expect(read().calls[0]).toEqual([
    'up', '--log-level', 'debug', '--workspace-folder', folder,
    '--id-label', 'ahpd.computer=1',
    '--id-label', `ahpd.devcontainer.folder=${folder}`,
  ]);
  // The command is echoed and the CLI's own progress is a person's to read.
  expect(where.out.join('')).toContain('devcontainer');
  expect(where.out.join('')).toContain('building');
  // What the host inside says is the next test's; this one is about the CLI.
});

it('refuses with the CLI\'s own words when there is no container', async () => {
  wrote({ upFailure: 'docker: command not found' });
  await expect(launcher().connect({ ...connect, workspaceFolder: workspace() }, sink()))
    .rejects.toThrow(/command not found/);

  wrote({ up: { outcome: 'error', message: 'no image' } });
  await expect(launcher().connect({ ...connect, workspaceFolder: workspace() }, sink()))
    .rejects.toThrow(/reported no container/);
});

it('installs a host when the image has none, and configures it either way', async () => {
  wrote({ hostPresent: false, passthrough: [process.execPath] });
  const where = sink();
  const folder = workspace();
  await launcher().connect({ ...connect, workspaceFolder: folder }, where);
  const commands = shell();
  // The program `host` actually names, not the default's: a deployment that
  // runs a checkout mounted into the container was told its image had no host
  // and watched a package it will never run being installed.
  expect(commands[0]).toBe(`command -v '${process.execPath}'`);
  // No version given, so the published latest.
  expect(commands[1]).toBe('npm i -g @ahpd/server --allow-scripts=node-pty');
  // The backend, installed into the configuration directory inside the
  // container: a bare name is resolved from there and from nowhere else, so a
  // global install would leave the nested host exiting on startup.
  expect(commands[2]).toBe(pluginInstallLine([process.execPath, HOST], ['@ahpd/agent-cofold']));
  // The configuration is written through a shell, owner-only, from base64.
  expect(commands[3]).toContain('chmod 600');
  const encoded = /printf %s ([A-Za-z0-9+/=]+) \| base64 -d/.exec(commands[3] ?? '')?.[1];
  expect(encoded).toBeDefined();
  expect(JSON.parse(Buffer.from(encoded as string, 'base64').toString('utf8'))).toEqual({
    paths: [at(folder)],
    sessions: 'memory',
    automations: 'memory',
    // Always written, and never empty: the host inside needs a backend the
    // way this one does, and `connect` refused before this if it had none.
    plugins: ['@ahpd/agent-cofold'],
  });
  // The host itself is the next exec, which is a stream rather than a
  // collection: it is recorded by the fake as it starts.
  await until(() => shell().length >= 5);
  // And it is started in stdio mode on that file, with no port.
  expect(shell()[4]).toContain('--stdio');
  expect(shell()[4]).toContain('--path');
  expect(shell()[4]).toContain('--config-file');
  expect(shell()[4]).not.toContain('--port');
  await until(() => where.said.length > 0 || where.closed.length > 0);
});

it('pins the host it installs to the version it was given', async () => {
  wrote({ hostPresent: false, passthrough: [process.execPath] });
  const where = sink();
  await launcher({ version: '0.8.77' }).connect({ ...connect, workspaceFolder: workspace() }, where);
  expect(shell()[1]).toBe('npm i -g @ahpd/server@0.8.77 --allow-scripts=node-pty');
  await until(() => where.said.length > 0 || where.closed.length > 0);
});

it('skips the install entirely when the operator says the host is there', async () => {
  wrote({ hostPresent: false, passthrough: [] });
  await launcher({ install: false }).connect({ ...connect, workspaceFolder: workspace() }, sink());
  // The launch is a stream rather than a collection, so it is recorded as it
  // starts; the configuration write has already returned by now.
  await until(() => shell().some((one) => one.includes('--stdio')));
  const commands = shell();
  // No probe and no install: the two commands are the configuration and the
  // launch, which is what a checkout mounted into the container needs.
  expect(commands.filter((one) => one.startsWith('command -v'))).toEqual([]);
  expect(commands.filter((one) => one.startsWith('npm i -g'))).toEqual([]);
  // And no backend install either: the image is declared complete, plugins
  // included, so nothing here reaches npm.
  expect(commands.filter((one) => one.includes('plugin install'))).toEqual([]);
  expect(commands.some((one) => one.includes('--stdio'))).toBe(true);
});

it('installs with the command it was given instead of the default', async () => {
  wrote({ hostPresent: false, passthrough: [] });
  await launcher({ install: 'echo installed' }).connect({ ...connect, workspaceFolder: workspace() }, sink());
  expect(shell()).toContain('echo installed');
});

it('does not install over a host the image already has', async () => {
  wrote({ hostPresent: true, passthrough: [process.execPath] });
  await launcher().connect({ ...connect, workspaceFolder: workspace() }, sink());
  expect(shell().filter((one) => one.startsWith('npm i -g'))).toEqual([]);
  // The backend is still installed, because an image built with the server
  // may still have none - which is the gap this line closes.
  expect(shell().filter((one) => one.includes('plugin install'))).toHaveLength(1);
});

it('installs only the package names, leaving a path for the container', async () => {
  wrote({ hostPresent: true, passthrough: [process.execPath] });
  await launcher({ plugins: ['@ahpd/agent-cofold', './mounted-plugin', 'npm:@ahpd/agent-acp'] })
    .connect({ ...connect, workspaceFolder: workspace() }, sink());
  // A path is resolved against the container's own working directory and a
  // scheme is the runtime's to resolve, so neither is this launcher's to
  // install.
  expect(shell().filter((one) => one.includes('plugin install')))
    .toEqual([pluginInstallLine([process.execPath, HOST], ['@ahpd/agent-cofold'])]);
});

it('installs only what the configuration directory has not got, with the host\'s own command', () => {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-plugin-line-'));
  try {
    mkdirSync(join(home, 'ahpd', 'node_modules', '@ahpd', 'agent-cofold'), { recursive: true });
    writeFileSync(join(home, 'ahpd', 'node_modules', '@ahpd', 'agent-cofold', 'package.json'), '{}');
    const sh = (specs: string[]) => spawnSync('/bin/sh', ['-c', pluginInstallLine(['echo', 'node', '/w/main.js'], specs)], {
      encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: home },
    });
    // Present, so nothing runs: an offline image with its backends starts.
    expect(sh(['@ahpd/agent-cofold']).stdout).toBe('');
    // Missing, so the host's program is asked, with the spec as written.
    expect(sh(['@ahpd/agent-cofold', '@ahpd/agent-acp@0.7.0']).stdout)
      .toBe('node /w/main.js plugin install --no-enable @ahpd/agent-acp@0.7.0\n');
  }
  finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it('refuses with the plugin\'s name when the container cannot install it', async () => {
  wrote({ hostPresent: true, passthrough: [process.execPath], failCommands: ['plugin install'], failErr: 'npm ERR! 404 not found' });
  await expect(launcher().connect({ ...connect, workspaceFolder: workspace() }, sink()))
    .rejects.toThrow(/@ahpd\/agent-cofold.*404 not found/s);
});

it('carries frames both ways, and the container\'s own noise as output', async () => {
  wrote({ hostPresent: true, passthrough: [process.execPath] });
  const where = sink();
  const port = launcher();
  await port.connect({ ...connect, workspaceFolder: workspace() }, where);
  await until(() => where.said.some((one) => one.includes('"method":"ready"')));

  // The line the host wrote that is not a frame is output, not a message.
  expect(where.out.join('')).toContain('nested host ready');
  const frame = where.said.find((one) => one.includes('"method":"ready"'));
  expect(JSON.parse(frame as string)).toMatchObject({ jsonrpc: '2.0', method: 'ready' });
  port.disconnect('a');
});

/*
 * A host inside with nothing to run is refused before a container is built.
 *
 * The daemon bundles no backend and the host inside is one of the same
 * build - decision `the-daemon-bundles-no-agent` - so an empty list is a
 * process that exits on startup. Reported as the list nobody filled in,
 * rather than a minute of `devcontainer up` followed by a container whose
 * host closed for reasons the relay cannot see.
 */
it('does not advertise the capability when no backend would be inside', async () => {
  wrote({ hostPresent: true });
  const said: string[] = [];
  expect(await launcher({ plugins: [], log: (line: string) => said.push(line) }).available()).toBe(false);
  // Said rather than silent: an empty list is a configuration somebody can
  // fix, unlike a machine with no Docker on it.
  expect(said.join('')).toContain('devcontainer.plugins');
  // And nothing was spawned to find it out.
  expect(read().calls).toEqual([]);
});

it('refuses a connection whose host inside would have no backend', async () => {
  wrote({ hostPresent: true });
  await expect(launcher({ plugins: [] }).connect({ ...connect, workspaceFolder: workspace() }, sink()))
    .rejects.toThrow(/no backend and would not start/);
  // Nothing was built: the CLI was never asked to bring a container up.
  expect(read().calls).toEqual([]);
});

it('writes a frame to the host, and stops it on disconnect', async () => {
  wrote({ hostPresent: true, passthrough: [process.execPath] });
  const plain = sink();
  const port = launcher();
  await port.connect({ ...connect, workspaceFolder: workspace() }, plain);
  await until(() => plain.said.some((one) => one.includes('"method":"ready"')));

  port.send('a', '{"jsonrpc":"2.0","id":1,"method":"ping"}');
  await until(() => plain.said.some((one) => one.includes('"echo":"ping"')));
  expect(plain.said.join('')).toContain('"echo":"ping"');
  expect(plain.closed).toEqual([]);

  port.disconnect('a');
  await until(() => plain.closed.length > 0);
  // A process that was told to stop ends the relay, and the port reports it
  // once. Whether the client hears that is the host's decision, and for a
  // disconnect the client asked for, it does not.
  expect(plain.closed.length).toBe(1);
  // And a frame after that goes nowhere rather than throwing.
  port.send('a', '{"jsonrpc":"2.0","id":2,"method":"ping"}');
  port.disconnect('a');
});

/*
 * A container the CLI made for a folder before this host labelled it.
 *
 * It carries the CLI's own record of the folder and none of the two id labels
 * `up` is asked with, so `up` would not find it and would make a second
 * container over one `devcontainer.json`. The connect asks for it by that label
 * and starts it, which is what `up` would have done to it.
 */
it('adopts a container the CLI made for the folder before it labelled it, and makes no second', async () => {
  const folder = workspace();
  writeFileSync(dockerState, JSON.stringify({
    machines: [{
      name: 'older',
      image: 'devcontainer',
      // What the CLI leaves and nothing of this host's: no `ahpd.computer`, no
      // `ahpd.devcontainer.folder`, so a listing answers nothing for it.
      labels: { 'devcontainer.local_folder': folder },
      mounts: [`${folder}:${at(folder)}`],
      env: { PATH: '/usr/bin' },
      // What the user's login shell holds, which is not the image's own: the
      // probe answers this, and a `docker exec` inherits the image's.
      probeEnv: { PATH: '/from-the-shell' },
      state: 'exited',
    }],
    calls: [],
    hostPresent: true,
    passthrough: [],
  }));
  writeFileSync(state, JSON.stringify({ calls: [], commands: [], metadata: [{ remoteUser: 'dev' }] }));

  await launcher({
    // Nothing of ours answers for the folder, which is what an older connect's
    // container looks like from here.
    existing: async () => undefined,
    adopted: async (asked: string) => adoptedDevContainer(dockered(), asked),
  }).connect({ ...connect, workspaceFolder: folder }, sink());

  // The CLI was not asked to bring anything up, and the container it adopted is
  // the one every command went into, after it was started.
  expect(read().calls).toEqual([]);
  expect(ran().machines).toHaveLength(1);
  expect(ran().machines[0]?.state).toBe('running');
  expect(ran().commands.filter((one) => one.id === 'older').length).toBeGreaterThan(4);
  // And it is probed like any other, so every command after the probe runs in
  // the environment that probe answered rather than in this process's.
  expect(ran().commands.filter((one) => one.id === 'older')
    .some((one) => one.env.PATH === '/from-the-shell')).toBe(true);
});

/*
 * `docker start` is the whole of what brings an adopted container up, so a
 * container it will not start is refused there, in Docker's own words, and
 * nothing is run in it.
 */
it('refuses an adopted container that will not start, with Docker\'s own sentence', async () => {
  const folder = workspace();
  writeFileSync(dockerState, JSON.stringify({
    machines: [{
      name: 'older',
      image: 'devcontainer',
      bare: true,
      labels: { 'devcontainer.local_folder': folder },
      mounts: [`${folder}:${at(folder)}`],
      state: 'exited',
    }],
    calls: [],
    failStart: 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /gone',
  }));
  writeFileSync(state, JSON.stringify({ calls: [], commands: [] }));

  await expect(launcher({
    existing: async () => undefined,
    adopted: async (asked: string) => adoptedDevContainer(dockered(), asked),
  }).connect({ ...connect, workspaceFolder: folder }, sink()))
    .rejects.toThrow(/could not be started: Error response from daemon: invalid mount config.*does not exist: \/gone/);
  expect(read().calls).toEqual([]);
  expect(ran().commands ?? []).toEqual([]);
});

/*
 * `${localEnv:NAME}` is read from the environment the CLI is spawned with, the
 * launcher's own `env` option included, which is the environment the CLI
 * resolves it against when it runs the command itself.
 */
it('resolves a localEnv reference from the environment the CLI is spawned with', async () => {
  wrote({
    hostPresent: true,
    passthrough: [],
    metadata: [{ remoteUser: 'vscode', remoteEnv: { FROM_OPTION: '${localEnv:AHPD_TEST_FROM_OPTION}' } }],
  });
  await launcher({
    env: { DEVCONTAINER_FAKE_STATE: state, DOCKER_FAKE_STATE: dockerState, AHPD_TEST_FROM_OPTION: 'the-option' },
  }).connect({ ...connect, workspaceFolder: workspace() }, sink());
  const asked = ran().commands.find((one) => one.command.join(' ').includes('command -v'));
  expect(asked?.env.FROM_OPTION).toBe('the-option');
});

it('falls back to a localEnv reference\'s default when the name is not set', () => {
  const found = {
    Id: 'abc123',
    Config: {
      Labels: { 'devcontainer.metadata': JSON.stringify([{ remoteEnv: { A: '${localEnv:AHPD_UNSET:fallback}', B: '${localEnv:AHPD_SET:fallback}' } }]) },
      Env: [],
    },
  };
  expect(reachOf(found, undefined, { AHPD_SET: 'set' }).env).toEqual({ A: 'fallback', B: 'set' });
});

/*
 * What the CLI prints goes to the client, and the CLI prints the `docker run`
 * it builds with every `-e` on it. A pipe hands that over in pieces cut
 * anywhere, so a value is masked a line at a time, and a value with a space in
 * it is masked whole.
 */
it('masks a value cut across two reads, and a quoted one whole', async () => {
  wrote({
    hostPresent: true,
    passthrough: [],
    probeEnv: { PATH: '/usr/bin', TOKEN: 'probe-secret' },
    upLog: ['Start: Run: docker run -e SECR', 'ET=hunter2 -e "QUOTED=a b c" --env=OTHER=\'d e\' x\n'],
  });
  const where = sink();
  await launcher().connect({ ...connect, workspaceFolder: workspace() }, where);
  const out = where.out.join('');
  expect(out).toContain('SECRET=<set>');
  expect(out).not.toContain('hunter2');
  expect(out).not.toContain('a b c');
  expect(out).not.toContain('d e');
  // The commands the launcher echoes name each variable and never its value.
  expect(out).toContain(`'-e' 'TOKEN'`);
  expect(out).not.toContain('probe-secret');
});

it('masks the values in the error a failed up is refused with', async () => {
  wrote({ upFailure: 'Start: Run: docker run -e SECRET=hunter2 base\nError: the image would not pull' });
  const refused = await launcher().connect({ ...connect, workspaceFolder: workspace() }, sink()).then(() => undefined, (error: unknown) => error as Error);
  expect(refused?.message).toMatch(/would not pull/);
  expect(refused?.message).not.toContain('hunter2');
});

it('starts nothing when the folder has no definition', async () => {
  wrote();
  const where = sink();
  const bare = mkdtempSync(join(root, 'bare-'));
  await launcher().connect({ ...connect, workspaceFolder: bare }, where).catch(() => undefined);
  expect(existsSync(state)).toBe(true);
  expect(read().calls).toEqual([]);
  expect(where.said).toEqual([]);
});

/*
 * Everything inside the container is reached by Docker, against the id `up`
 * answered with - decision `a-dev-container-is-reached-by-docker-exec`.
 *
 * The CLI runs `up` and nothing else, so its own record holds that one verb and
 * every command after it is the scripted docker's. What the id is worth is
 * what the CLI left out of it: nothing here looks a container up by folder.
 */
it('reaches every command by the id the CLI answered with, and asks the CLI only for `up`', async () => {
  wrote({ hostPresent: true, passthrough: [] });
  const folder = workspace();
  await launcher().connect({ ...connect, workspaceFolder: folder }, sink());

  expect(read().calls.map((one) => one[0])).toEqual(['up']);
  const execs = ran().calls.filter((one) => one[0] === 'exec');
  expect(execs.length).toBeGreaterThan(4);
  for (const one of execs) {
    expect(one.slice(0, 4)).toEqual(['exec', '-i', '-u', 'dev']);
    expect(one).toContain('abc123');
  }
  // The launcher's own commands run in the workspace, as every other command
  // in there does; only the probe's two lines are run with no `-w`.
  await until(() => shell().some((one) => one.includes('--stdio')));
  const own = ran().commands.filter((one) => !one.command.join(' ').includes('/proc/self/environ') && one.command[0] !== 'getent');
  expect(own.length).toBeGreaterThan(2);
  expect(own.map((one) => one.workdir)).toEqual(own.map(() => at(folder)));
});

/*
 * A container the folder already has is reached rather than made again, but
 * only while it is up. A stopped one is nothing to `docker exec`, so `up` runs
 * again, and the id labels are what make the CLI answer the same container
 * instead of a second one beside it.
 */
it('runs up for a stopped container before the first command in it, and keeps its id', async () => {
  wrote({ hostPresent: true, passthrough: [] });
  const folder = workspace();
  const relay = launcher({
    // What the plugin hands in: the computer the folder is, and whether it is
    // up, read here from the same record the scripted Docker holds.
    existing: async () => {
      const found = ran().machines.find((one) => (one.labels ?? {})['ahpd.devcontainer.folder'] === folder);
      return found === undefined
        ? undefined
        : { id: found.name, running: (found.state ?? 'running') === 'running' };
    },
  });
  await relay.connect({ ...connect, workspaceFolder: folder }, sink());
  const id = ran().machines[0]?.id as string;
  // This launcher already knows where the folder is inside the container, so
  // the next connect is the one that could skip `up` - if the container is up.
  const stopped = JSON.parse(readFileSync(dockerState, 'utf8')) as { machines: { name: string; state?: string }[] };
  stopped.machines = [{ ...stopped.machines[0]!, state: 'exited' }];
  writeFileSync(dockerState, JSON.stringify(stopped));
  await relay.connect({ ...connect, workspaceFolder: folder }, sink());

  expect(read().calls.filter((one) => one[0] === 'up')).toHaveLength(2);
  expect(ran().machines).toHaveLength(1);
  expect(ran().machines[0]?.id).toBe(id);
  // The commands after the second `up` ran in it, which a stopped container
  // refuses with `container <id> is not running`.
  expect(ran().commands.filter((one) => one.id === id).length).toBeGreaterThan(4);
});

/*
 * The derivation the CLI makes, copied rather than guessed at: the user is the
 * last one any entry of the folder's configuration named, and the environment
 * is the user's own login shell as it was holding it, with the entries'
 * `remoteEnv` laid over it in order - each value read for what it refers to.
 */
it('runs each command as the folder\'s own user, in the environment its shell held', async () => {
  wrote({
    hostPresent: true,
    passthrough: [],
    containerEnv: { USER: 'vscode' },
    metadata: [
      { remoteUser: 'root' },
      { remoteUser: 'vscode', remoteEnv: {
        PATH: 'from-remote',
        GREETING: 'hello',
        WHO: '${containerEnv:USER}',
        FROM_LOCAL: '${localEnv:PATH}',
      } },
    ],
  });
  await launcher().connect({ ...connect, workspaceFolder: workspace() }, sink());

  const asked = ran().commands.find((one) => one.command.join(' ').includes('command -v'));
  // The later entry wins: an image's own user and the folder's are both here,
  // and the folder's is the one the machine is for.
  expect(asked?.user).toBe('vscode');
  expect(asked?.env).toEqual({
    // What the shell held, with the folder's own path over it rather than
    // beside it - a command run in the entry's PATH, not in the image's.
    PATH: 'from-remote',
    HOME: '/root',
    GREETING: 'hello',
    // From the container itself, and from this process, which is what the two
    // references mean.
    WHO: 'vscode',
    FROM_LOCAL: process.env.PATH,
  });
  // The `containerEnv` entry is not among them, and that is the point: the
  // container already holds it and every `docker exec` inherits it, so passing
  // it would put the value in this host's process list for nothing.
  expect(asked?.env.USER).toBeUndefined();
});

/*
 * The probe is run once for a container, and kept beside the daemon's own
 * configuration rather than by the CLI - which keeps none. A container the CLI
 * made again is a container with a shell that has since started afresh, so it
 * is probed again; a daemon that has not seen the container reads back what
 * the last one kept and runs nothing.
 */
it('probes once for a container, and reads the kept probe back on a later daemon', async () => {
  const probed = (): number => ran().commands
    .filter((one) => one.command.join(' ').includes('/proc/self/environ')).length;
  wrote({ hostPresent: true, passthrough: [] });
  const probes = new Map<string, Probe>();
  const store = { of: (id: string) => probes.get(id), keep: (id: string, probe: Probe) => { probes.set(id, probe); } };

  const first = launcher({ probes: store });
  await first.connect({ ...connect, workspaceFolder: workspace() }, sink());
  expect(probed()).toBe(1);
  expect([...probes.keys()]).toEqual(['abc123']);

  // The same container again: it is looked up, and the probe it answered is
  // the one still kept, so the shell is not run a second time.
  await first.connect({ ...connect, workspaceFolder: workspace() }, sink());
  expect(probed()).toBe(1);

  // Another folder's container, which is another container: the kept probe is
  // of the last one and is replaced rather than believed.
  const other = workspace();
  writeFileSync(state, JSON.stringify({
    calls: [],
    up: { outcome: 'success', containerId: 'def456', remoteWorkspaceFolder: '/workspaces/Box' },
    hostPresent: true,
    passthrough: [],
  }));
  await first.connect({ ...connect, workspaceFolder: other }, sink());
  expect(probed()).toBe(2);
  expect([...probes.keys()]).toEqual(['abc123', 'def456']);

  // And a daemon that has not seen either of them reads the second entry back
  // and probes nothing, where a probe would be the same shell answering again.
  const later = launcher({ probes: store });
  await later.connect({ ...connect, workspaceFolder: other }, sink());
  expect(probed()).toBe(2);
});
