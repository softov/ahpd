import { machinePathOf } from '@ahpd/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { originOf, SEED_BUNDLE } from '../src/clone.js';
import { fetchedInto } from '../src/machinegit.js';
import { dockerRuntime } from '../src/runtime.js';

/*
 * A session's code on another box's Docker, on a real Docker.
 *
 * The runtime is made `remote`, as one for a profile with a `server` is, and
 * talks to this host's Docker: what is under test is that nothing of this
 * host's is bound, that the checkout comes from a bundle, and that the work
 * comes back by bring-back. These run the real program, and skip where there
 * is none.
 */

const IMAGE = 'node:22';
const LABEL = 'ahpd.fargit=1';
const ME = process.getuid === undefined ? undefined : `${String(process.getuid())}:${String(process.getgid?.())}`;
const AS_ME = ME === undefined ? {} : { user: ME };
const DOCKER_CASE = 120_000;

const answers = (): boolean => {
  try {
    return execFileSync('docker', ['version', '--format', '{{.Server.Os}}'], { stdio: 'pipe' }).toString().trim() === 'linux';
  }
  catch { return false; }
};
const DOCKER = answers();

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A real repository with one commit, and an `origin` whose address holds a password. */
const repository = () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-far-git-'));
  const repo = join(loose, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('remote', 'add', 'origin', 'https://ana:hunter2@git.example.com/team/repo.git');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  return { repo, run, gitDir: join(repo, '.git'), state: join(loose, 'config') };
};

const headOf = (repo: string, ref: string): string =>
  execFileSync('git', ['-C', repo, 'rev-parse', ref], { stdio: 'pipe' }).toString().trim();

const far = (state: string) => dockerRuntime({ command: 'docker', label: LABEL, configDir: state, remote: true });

const inMachine = (docker: ReturnType<typeof far>, name: string, tree: string, args: string[]) =>
  docker.exec(name, ['git', '-C', machinePathOf(tree), ...args]);

const commitInside = async (docker: ReturnType<typeof far>, name: string, tree: string, file: string, subject: string): Promise<string> => {
  expect((await docker.exec(name, ['sh', '-c', `printf '${subject}\\n' > ${machinePathOf(join(tree, file))}`])).code).toBe(0);
  expect((await inMachine(docker, name, tree, ['add', file])).code).toBe(0);
  expect((await inMachine(docker, name, tree, ['commit', '-q', '-m', subject])).code).toBe(0);
  return (await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output;
};

/** The sources of a container's binds: a path of this host's each, where it has any. */
const bindsOf = (name: string): string[] => {
  const mounts = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Mounts}}', name], { stdio: 'pipe' }).toString()) as { Type: string; Source: string }[];
  return mounts.filter((one) => one.Type === 'bind').map((one) => one.Source);
};

it('names an origin without the user and password its address holds', () => {
  const { repo, run } = repository();
  expect(originOf(repo)).toBe('https://git.example.com/team/repo.git');
  run('remote', 'set-url', 'origin', 'git@git.example.com:team/repo.git');
  expect(originOf(repo)).toBe('git@git.example.com:team/repo.git');
  run('remote', 'remove', 'origin');
  expect(originOf(repo)).toBeUndefined();
});

/*
 * The address the machine is told to fetch, read from the command that sets
 * it: a GitHub SSH origin by GitHub's HTTPS origin, as VS Code's agent host
 * clones one, and any other as written.
 */
it('fetches a GitHub SSH origin by its HTTPS origin, and any other origin as written', async () => {
  const { repo, run } = repository();
  const fetchedBy = async (origin: string): Promise<string | undefined> => {
    run('remote', 'set-url', 'origin', origin);
    const asked: string[][] = [];
    await fetchedInto({
      name: 'box',
      must: async (command) => { asked.push(command); return 'abc123\n'; },
      ran: async (command) => { asked.push(command); return { code: 0, stdout: '', stderr: '' }; },
      put: async () => {},
      drop: async () => {},
    }, repo, '/work/.git', 'main');
    return asked.find((one) => one.includes('remote.origin.url'))?.at(-1);
  };
  expect(await fetchedBy('git@github.com:softov/ahpd.git')).toBe('https://github.com/softov/ahpd.git');
  expect(await fetchedBy('ssh://git@github.com/softov/ahpd.git')).toBe('https://github.com/softov/ahpd.git');
  expect(await fetchedBy('git@git.example.com:team/repo.git')).toBe('git@git.example.com:team/repo.git');
  expect(await fetchedBy('ssh://git@git.example.com:2222/team/repo.git')).toBe('ssh://git@git.example.com:2222/team/repo.git');
  expect(await fetchedBy('https://git.example.com/team/repo.git')).toBe('https://git.example.com/team/repo.git');
});

it.skipIf(!DOCKER)('seeds a machine on another Docker from a bundle, binds nothing of this host\'s, and brings its commit back', async () => {
  const { repo, gitDir, state } = repository();
  const docker = far(state);
  const name = `ahpd-fargit-seed-${String(process.pid)}`;
  const head = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, workdir: machinePathOf(repo), ...AS_ME });
  try {
    expect(bindsOf(name)).toEqual([]);
    expect((await inMachine(docker, name, repo, ['rev-parse', 'HEAD'])).output).toBe(head);
    expect((await inMachine(docker, name, repo, ['branch', '--show-current'])).output).toBe('main');
    expect(await inMachine(docker, name, repo, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    // The checkout looks like any other, with no credential in its origin.
    expect((await inMachine(docker, name, repo, ['remote', 'get-url', 'origin'])).output).toBe('https://git.example.com/team/repo.git');
    // The bundle is gone once fetched.
    expect((await docker.exec(name, ['test', '-e', SEED_BUNDLE])).code).not.toBe(0);

    const made = await commitInside(docker, name, repo, 'far.txt', 'from the box');
    expect(existsSync(join(repo, 'far.txt'))).toBe(false);
    expect(await docker.bringBack(name)).toEqual({ moved: true });
    expect(headOf(repo, 'main')).toBe(made);
    expect(readFileSync(join(repo, 'far.txt'), 'utf8')).toBe('from the box\n');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('brings a machine\'s work back to a hidden ref when the host committed after the seed', async () => {
  const { repo, run, gitDir, state } = repository();
  const docker = far(state);
  const name = `ahpd-fargit-moved-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, workdir: machinePathOf(repo), ...AS_ME });
  try {
    // A commit the machine never received: its bundle is measured from the seed instead.
    writeFileSync(join(repo, 'host.txt'), 'the host\n');
    run('add', 'host.txt');
    run('commit', '-q', '-m', 'on the host');
    const host = headOf(repo, 'main');
    const made = await commitInside(docker, name, repo, 'far.txt', 'from the box');

    expect(await docker.bringBack(name)).toEqual({ moved: false, waiting: `refs/ahpd/machines/${name}/main` });
    expect(headOf(repo, 'main')).toBe(host);
    expect(headOf(repo, `refs/ahpd/machines/${name}/main`)).toBe(made);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it('refuses a folder that is not a repository on another Docker, before anything is made', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-far-git-'));
  const folder = join(loose, 'plain');
  mkdirSync(folder);
  const docker = dockerRuntime({ command: '/nonexistent/docker', label: LABEL, configDir: join(loose, 'config'), remote: true });
  await expect(docker.run({ name: 'plain', image: IMAGE, label: LABEL, folder }))
    .rejects.toThrow(`plain is made on another box's Docker, and ${folder} is not a repository it may be given, so its code cannot be sent there`);
});
