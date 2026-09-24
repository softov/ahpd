import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { devContainer, hasDefinition, parseUp } from '../packages/computer/src/devcontainer.js';
import type { ContainerSink } from '../packages/sdk/src/types/containers.js';

/*
 * The launcher: the Dev Container CLI, the host inside, and the pipes.
 *
 * The CLI is a fake and the host is a script, because `pnpm test` has no Docker
 * and this machine has no `devcontainer`. What is asserted is what the launcher
 * runs, what it refuses, and what crosses the pipes - not the CLI's own work.
 */

const CLI = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));

let root: string;
let state: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-devcontainer-'));
  state = join(root, 'cli.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A folder that is a dev container, and one that is not. */
function workspace(withDefinition = true): string {
  const folder = mkdtempSync(join(root, 'work-'));
  if (withDefinition) {
    mkdirSync(join(folder, '.devcontainer'), { recursive: true });
    writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{}');
  }
  return folder;
}

const wrote = (extra: Record<string, unknown> = {}): void => {
  writeFileSync(state, JSON.stringify({ calls: [], commands: [], ...extra }));
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

/** The launcher, with the fake CLI, and the fake Docker being this same node. */
const launcher = (extra: Record<string, unknown> = {}, options: { docker?: string } = {}) => devContainer({
  command: process.execPath,
  args: [CLI],
  docker: options.docker ?? process.execPath,
  env: { DEVCONTAINER_FAKE_STATE: state },
  host: [process.execPath, HOST],
  ...extra,
});

const until = async (check: () => boolean, times = 600): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

const connect = { connectionId: 'a', workspaceFolder: '', name: 'Box' };

it('answers Docker and the launcher as two questions', async () => {
  wrote();
  expect(await launcher().docker()).toBe(true);
  expect(await launcher().available()).toBe(true);
  // No Docker is no to both.
  expect(await launcher({}, { docker: '/nonexistent/docker' }).docker()).toBe(false);
  expect(await launcher({}, { docker: '/nonexistent/docker' }).available()).toBe(false);
  // No CLI is a yes to Docker and a no to a container, which is the difference
  // the two methods are for.
  const noCli = devContainer({ command: '/nonexistent/devcontainer', docker: process.execPath, env: { DEVCONTAINER_FAKE_STATE: state } });
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
    remoteWorkspaceFolder: '/workspaces/Box',
    hostWorkspaceFolder: folder,
  });
  expect(read().calls[0]).toEqual(['up', '--log-level', 'debug', '--workspace-folder', folder]);
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
  await launcher().connect({ ...connect, workspaceFolder: workspace() }, where);
  const commands = read().commands;
  // The program `host` actually names, not the default's: a deployment that
  // runs a checkout mounted into the container was told its image had no host
  // and watched a package it will never run being installed.
  expect(commands[0]).toBe(`command -v '${process.execPath}'`);
  expect(commands[1]).toMatch(/^npm i -g @ahpd\/server@\d/);
  // The configuration is written through a shell, owner-only, from base64.
  expect(commands[2]).toContain('chmod 600');
  const encoded = /printf %s ([A-Za-z0-9+/=]+) \| base64 -d/.exec(commands[2] ?? '')?.[1];
  expect(encoded).toBeDefined();
  expect(JSON.parse(Buffer.from(encoded as string, 'base64').toString('utf8'))).toEqual({
    paths: ['/workspaces/Box'],
    sessions: 'memory',
    automations: 'memory',
  });
  // The host itself is the next exec, which is a stream rather than a
  // collection: it is recorded by the fake as it starts.
  await until(() => read().commands.length >= 4);
  // And it is started in stdio mode on that file, with no port.
  expect(read().commands[3]).toContain('--stdio');
  expect(read().commands[3]).toContain('--path');
  expect(read().commands[3]).toContain('--config-file');
  expect(read().commands[3]).not.toContain('--port');
  await until(() => where.said.length > 0 || where.closed.length > 0);
});

it('skips the install entirely when the operator says the host is there', async () => {
  wrote({ hostPresent: false, passthrough: [] });
  await launcher({ install: false }).connect({ ...connect, workspaceFolder: workspace() }, sink());
  // The launch is a stream rather than a collection, so it is recorded as it
  // starts; the configuration write has already returned by now.
  await until(() => read().commands.some((one) => one.includes('--stdio')));
  const commands = read().commands;
  // No probe and no install: the two commands are the configuration and the
  // launch, which is what a checkout mounted into the container needs.
  expect(commands.filter((one) => one.startsWith('command -v'))).toEqual([]);
  expect(commands.filter((one) => one.startsWith('npm i -g'))).toEqual([]);
  expect(commands.some((one) => one.includes('--stdio'))).toBe(true);
});

it('installs with the command it was given instead of the default', async () => {
  wrote({ hostPresent: false, passthrough: [] });
  await launcher({ install: 'echo installed' }).connect({ ...connect, workspaceFolder: workspace() }, sink());
  expect(read().commands).toContain('echo installed');
});

it('does not install over a host the image already has', async () => {
  wrote({ hostPresent: true, passthrough: [process.execPath] });
  await launcher().connect({ ...connect, workspaceFolder: workspace() }, sink());
  expect(read().commands.filter((one) => one.startsWith('npm i -g'))).toEqual([]);
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

it('starts nothing when the folder has no definition', async () => {
  wrote();
  const where = sink();
  const bare = mkdtempSync(join(root, 'bare-'));
  await launcher().connect({ ...connect, workspaceFolder: bare }, where).catch(() => undefined);
  expect(existsSync(state)).toBe(true);
  expect(read().calls).toEqual([]);
  expect(where.said).toEqual([]);
});
