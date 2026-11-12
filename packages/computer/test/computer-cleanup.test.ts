import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { gitVolumeOf } from '../src/gitdir.js';
import { dockerRuntime } from '../src/runtime.js';

/*
 * A machine a create did not finish leaves nothing behind.
 *
 * A `run` Docker refused, a copy that did not land, a start that failed and a
 * seed whose git refused each leave a container, the volume mounted into it, or
 * both - and none of them is a machine anything will run in. The scripted
 * Docker fails at each of the two steps a machine is made in, and what is left
 * after the failure is what this file is about.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const LABEL = 'ahpd.computer=1';
const IMAGE = 'debian:bookworm-slim';

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-cleanup-'));
  return loose;
};

interface Held {
  machines: { name: string }[];
  calls: string[][];
  volumes?: Record<string, { files: string[] }>;
}

/** The fake Docker's state, holding whatever else a case needs. */
const state = (dir: string, extra: Record<string, unknown> = {}): string => {
  const path = join(dir, 'docker.json');
  writeFileSync(path, JSON.stringify({ machines: [], calls: [], ...extra }));
  return path;
};

const held = (path: string): Held => JSON.parse(readFileSync(path, 'utf8')) as Held;

/** A real repository with one commit, every path resolved. */
const repository = (dir: string): { repo: string; gitDir: string } => {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  return { repo, gitDir: join(repo, '.git') };
};

/** The runtime over the scripted Docker, keeping what it says in `lines`. */
const runtime = (path: string, lines: string[] = []) => dockerRuntime({
  command: process.execPath,
  args: [FIXTURE],
  env: { DOCKER_FAKE_STATE: path },
  label: LABEL,
  configDir: join(dirname(path), 'config'),
  log: (line) => { lines.push(line); },
});

it('leaves no container when Docker refuses the run, and throws what Docker said', async () => {
  const dir = temp();
  const path = state(dir, { failRun: true });
  const { repo, gitDir } = repository(dir);
  const lines: string[] = [];
  const docker = runtime(path, lines);

  await expect(docker.run({ name: 'one', image: IMAGE, label: LABEL, folder: repo, gitDir }))
    .rejects.toThrow('the scripted docker refuses to make this one');

  const after = held(path);
  // Nothing Docker made, and the removal asked for all the same: `rm -f` is
  // what a machine made part-way is taken away with, and a Docker that answers
  // nothing for it must not turn the first error into a second one.
  expect(after.machines).toEqual([]);
  expect(after.calls).toContainEqual(['rm', '-f', 'one']);
  expect(after.volumes?.[gitVolumeOf('one')]).toBeUndefined();
  // The volume was never made, so removing it fails, and that failure is said
  // rather than thrown: the caller is answered with the run's own error.
  expect(lines.filter((one) => one.includes(`the volume ${gitVolumeOf('one')} was not removed`))).toHaveLength(1);
});

it('removes the container and its git volume when the seed fails, and throws the seed\'s error', async () => {
  const dir = temp();
  const path = state(dir, { failCommands: ['git init'] });
  const { repo, gitDir } = repository(dir);
  const lines: string[] = [];
  const docker = runtime(path, lines);

  await expect(docker.run({ name: 'one', image: IMAGE, label: LABEL, folder: repo, gitDir }))
    .rejects.toThrow('git init failed');

  const after = held(path);
  // Both of what Docker made for a machine nothing will run in: the container,
  // and the volume its git directory was being seeded into.
  expect(after.machines).toEqual([]);
  expect(after.volumes?.[gitVolumeOf('one')]).toBeUndefined();
  expect(after.calls).toContainEqual(['rm', '-f', 'one']);
  expect(after.calls).toContainEqual(['volume', 'rm', gitVolumeOf('one')]);
  // Nothing was left over to say a failure about.
  expect(lines.filter((one) => one.includes('after a failed create'))).toEqual([]);
});
