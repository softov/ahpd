import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileResources } from '../packages/sdk/src/resources.js';
import { loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';

/*
 * How the computers port starts a whole host inside a machine.
 *
 * The command is built from the machine's profile, and the machine remembers
 * which profile made it - so a daemon that did not make it still starts the
 * host the profile named. The `docker` is the scripted fixture, so what is
 * under test is the exec line this package builds rather than Docker.
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

const base = (): HostOptions => ({
  path: '/tmp/nested-start',
  agents: [{ ...echo({ path: '/tmp/nested-start', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const load = (options: Record<string, unknown>) => loadPlugins(
  [{ name: SOURCE, options }],
  { base: base(), configDir: REPO, cwd: REPO, log: () => {} },
);

const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }): Promise<void>;
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
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    // The mount is what makes a host path a path inside the machine, which is
    // what a caller's `cwd` is read through.
    profiles: {
      plain: { mounts: ['/work:/work'] },
      nodejs: { host: ['node', '/work/ahpd.js'], mounts: ['/work:/work'] },
    },
  });
  expect(problems).toEqual([]);

  const provider = providerOf(options);
  await provider.write('computer://plain', { data: JSON.stringify({ profile: 'plain' }), encoding: 'utf-8' });
  await provider.write('computer://nodejs', { data: JSON.stringify({ profile: 'nodejs' }), encoding: 'utf-8' });

  const computers = options.computers;
  if (computers?.nested === undefined) throw new Error('the plugin registered no nested start');

  // The default: the command the container's install step provides.
  const plain = await computers.nested('plain', { plugins: ['@ahpd/agent-cofold'], cwd: '/work' });
  expect(plain?.command).toBe(process.execPath);
  expect(execOf(plain)).toEqual(['exec', '-i', '-w', '/work', 'plain', 'ahpd', '--stdio', '--plugin', '@ahpd/agent-cofold']);

  // A profile's own host, with the same `--stdio --plugin` argv after it.
  const nodejs = await computers.nested('nodejs', { plugins: ['@ahpd/agent-cofold'], cwd: '/work' });
  expect(execOf(nodejs)).toEqual([
    'exec', '-i', '-w', '/work', 'nodejs',
    'node', '/work/ahpd.js', '--stdio', '--plugin', '@ahpd/agent-cofold',
  ]);

  // More than one plugin, in the order the caller named them.
  const many = await computers.nested('plain', { plugins: ['@ahpd/agent-cofold', '@ahpd/some-other'], cwd: '/work' });
  expect(execOf(many)).toEqual([
    'exec', '-i', '-w', '/work', 'plain',
    'ahpd', '--stdio', '--plugin', '@ahpd/agent-cofold', '--plugin', '@ahpd/some-other',
  ]);

  // A machine that is not there is nothing, the same answer `how` gives.
  expect(await computers.nested('gone', { plugins: ['@ahpd/agent-cofold'] })).toBeUndefined();
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
