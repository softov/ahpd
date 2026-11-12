import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { dockerRuntime } from '../src/runtime.js';
import { closeAll, keeping } from './support/closing.js';
import type { HostOptions } from '../../sdk/src/types/host.js';

/*
 * The URL a machine uses for an address of this host's.
 *
 * Docker Desktop publishes the host's loopback at `host.docker.internal`, and
 * other Docker is given the same name where the machine is made. The scripted
 * Docker answers `docker info` with the operating system a case names, so
 * neither Docker nor Docker Desktop is needed. Nothing here talks to a daemon.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const LABEL = 'ahpd.computer=1';
const IMAGE = 'debian:bookworm-slim';

let loose: string | undefined;
afterEach(async () => {
  await closeAll();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-reach-'));
  return loose;
};

interface Held {
  machines: { name: string }[];
  calls: string[][];
}

/** The scripted Docker's state, holding whatever else a case needs. */
const stateAt = (dir: string, extra: Record<string, unknown> = {}): string => {
  const path = join(dir, 'docker.json');
  writeFileSync(path, JSON.stringify({ machines: [], calls: [], ...extra }));
  return path;
};

const held = (path: string): Held => JSON.parse(readFileSync(path, 'utf8')) as Held;

/** The runtime over the scripted Docker, on this host unless `remote` says otherwise. */
const runtime = (path: string, remote = false) => dockerRuntime({
  command: process.execPath,
  args: [FIXTURE],
  env: { DOCKER_FAKE_STATE: path },
  label: LABEL,
  configDir: join(dirname(path), 'config'),
  ...(remote ? { remote: true } : {}),
});

/** The `run` Docker was asked for, which is where the machine's flags are. */
const runAt = (path: string): string[] => held(path).calls.find((one) => one[0] === 'run') ?? [];

it('answers the host at its Docker name on Docker Desktop, for loopback and a wildcard', async () => {
  const dir = temp();
  const docker = runtime(stateAt(dir, { operatingSystem: 'Docker Desktop' }));
  for (const [url, at] of [
    ['http://127.0.0.1:4242/ahp-mcp/one', 'http://host.docker.internal:4242/ahp-mcp/one'],
    ['http://127.1.2.3:4242/ahp-mcp/one', 'http://host.docker.internal:4242/ahp-mcp/one'],
    ['http://localhost:4242/ahp-mcp/one', 'http://host.docker.internal:4242/ahp-mcp/one'],
    ['http://[::1]:4242/ahp-mcp/one', 'http://host.docker.internal:4242/ahp-mcp/one'],
    ['http://0.0.0.0:4242/ahp-mcp/one', 'http://host.docker.internal:4242/ahp-mcp/one'],
    ['http://[::]:4242/ahp-mcp/one', 'http://host.docker.internal:4242/ahp-mcp/one'],
  ] as const) {
    expect(await docker.reach?.('box', url), url).toBe(at);
  }
});

it('answers a wildcard bind on other Docker, and nothing for loopback', async () => {
  const dir = temp();
  const docker = runtime(stateAt(dir));
  expect(await docker.reach?.('box', 'http://0.0.0.0:4242/ahp-mcp/one'))
    .toBe('http://host.docker.internal:4242/ahp-mcp/one');
  expect(await docker.reach?.('box', 'http://[::]:4242/ahp-mcp/one'))
    .toBe('http://host.docker.internal:4242/ahp-mcp/one');
  for (const url of ['http://127.0.0.1:4242/x', 'http://127.1.2.3:4242/x', 'http://localhost:4242/x', 'http://[::1]:4242/x']) {
    expect(await docker.reach?.('box', url), url).toBeUndefined();
  }
});

it('answers nothing for an address a machine already reaches, or for no URL', async () => {
  const dir = temp();
  const docker = runtime(stateAt(dir, { operatingSystem: 'Docker Desktop' }));
  expect(await docker.reach?.('box', 'http://10.0.0.5:4242/x')).toBeUndefined();
  expect(await docker.reach?.('box', 'not a url')).toBeUndefined();
});

it('answers a dev container only on Docker Desktop, which resolves the name for it', async () => {
  const dir = temp();
  // A machine carrying the label the Dev Container CLI is given: its create
  // has no `--add-host`, so on other Docker the name does not resolve inside.
  const machines = [{ name: 'box', labels: { 'ahpd.devcontainer.folder': '/work/app' } }];
  const path = stateAt(dir, { machines });
  expect(await runtime(path).reach?.('box', 'http://0.0.0.0:4242/ahp-mcp/one')).toBeUndefined();

  stateAt(dir, { machines, operatingSystem: 'Docker Desktop' });
  expect(await runtime(path).reach?.('box', 'http://0.0.0.0:4242/ahp-mcp/one'))
    .toBe('http://host.docker.internal:4242/ahp-mcp/one');
});

it('answers nothing for another box\'s Docker, and asks it nothing', async () => {
  const dir = temp();
  const path = stateAt(dir, { operatingSystem: 'Docker Desktop' });
  const docker = runtime(path, true);
  expect(await docker.reach?.('box', 'http://127.0.0.1:4242/x')).toBeUndefined();
  // Not even `docker info`: this host's loopback is not that box's.
  expect(held(path).calls).toEqual([]);
});

it('points the host name at its gateway when a machine is made on other Docker', async () => {
  const dir = temp();
  const path = stateAt(dir);
  const docker = runtime(path);
  await docker.run({ name: 'one', image: IMAGE, label: LABEL });

  const made = runAt(path);
  const at = made.indexOf('--add-host');
  expect(at).toBeGreaterThan(-1);
  expect(made.slice(at, at + 2)).toEqual(['--add-host', 'host.docker.internal:host-gateway']);
});

it('leaves the flag off on Docker Desktop, which publishes the name itself', async () => {
  const dir = temp();
  const path = stateAt(dir, { operatingSystem: 'Docker Desktop' });
  const docker = runtime(path);
  await docker.run({ name: 'one', image: IMAGE, label: LABEL });

  expect(runAt(path)).not.toContain('--add-host');
});

it('leaves the flag off on another box\'s Docker, where the host is not this host', async () => {
  const dir = temp();
  const path = stateAt(dir);
  const docker = runtime(path, true);
  await docker.run({ name: 'one', image: IMAGE, label: LABEL });

  expect(runAt(path)).not.toContain('--add-host');
});

it('answers from the plugin\'s port, as the runtime its id names does', async () => {
  const dir = temp();
  const path = stateAt(dir, { operatingSystem: 'Docker Desktop' });
  const base: HostOptions = {
    path: '/tmp/computer-reach',
    hostName: 'reach.local',
    agents: [],
    resources: fileResources(),
  };
  const result = await loadPlugins(
    [{ name: SOURCE, options: {
      command: process.execPath,
      args: [FIXTURE],
      env: { DOCKER_FAKE_STATE: path },
    } }],
    { base, configDir: join(dir, 'config'), cwd: REPO, log: () => {} },
  );
  keeping(result.options);

  expect(await result.options.computers?.reach?.('box', 'http://127.0.0.1:4242/ahp-mcp/one'))
    .toBe('http://host.docker.internal:4242/ahp-mcp/one');
});
