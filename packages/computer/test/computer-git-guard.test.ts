import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dockerRuntime } from '../src/runtime.js';

/*
 * What `gitGuard: "bind"` leaves writable in a machine, on a real Docker -
 * decision `a-machines-git-directory-is-read-only-but-what-a-commit-writes`.
 *
 * The rest of this package's cases ask the scripted Docker what the runtime
 * asked it for. That answers the binds and nothing about what git inside a
 * container does with them, and the allowlist is a claim about exactly that:
 * that a commit needs `objects/`, `refs/` and `logs/`, that a main checkout
 * needs its root, and that nothing else in the git directory is enough. So
 * these run the real program, and skip where there is none.
 */

/** The image: one with `git` in it and no entrypoint, which the runtime's `sleep infinity` would replace. */
const IMAGE = 'node:22';
const LABEL = 'ahpd.gitguard=1';
const ME = `${String(process.getuid?.())}:${String(process.getgid?.())}`;

/**
 * The budget of a case that runs a real container: a fresh runner pulls
 * `node:22` first, which alone takes far longer than vitest's 5 s default.
 */
const DOCKER_CASE = 120_000;

/** Whether a Docker daemon answers here, which is what these cases need. */
const answers = (): boolean => {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
    return true;
  }
  catch { return false; }
};

const DOCKER = answers();

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A real repository with one commit and one linked worktree, every path resolved. */
const repository = () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-git-guard-'));
  const repo = join(loose, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  const tree = join(loose, 'tree');
  run('worktree', 'add', '-q', '-b', 'work', tree);
  return { repo, tree, gitDir: join(repo, '.git') };
};

/** The branch a worktree has checked out, as the host's git answers it. */
const headOf = (repo: string, branch: string): string =>
  execFileSync('git', ['-C', repo, 'log', '--oneline', '-1', branch], { encoding: 'utf8' }).trim();

it.skipIf(!DOCKER)('commits in a machine on a linked worktree, and writes nothing else in the git directory', async () => {
  const { repo, tree, gitDir } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL });
  const name = `ahpd-gitguard-worktree-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'bind', user: ME });
  try {
    writeFileSync(join(tree, 'src', 'tracked.txt'), 'changed in the machine\n');
    // A commit in the machine, which is what the writable objects, refs and
    // logs are for. It prints the `packed-refs.lock` line and exits zero.
    expect((await docker.exec(name, ['git', '-C', tree, 'add', '-A'])).code).toBe(0);
    expect((await docker.exec(name, ['git', '-C', tree, 'commit', '-q', '-m', 'from the machine'])).code).toBe(0);
    // And it landed on the host's branch, not on a copy of the repository.
    expect(headOf(repo, 'work')).toContain('from the machine');
    // Nothing git on the host reads for config or for where things are can be
    // written, and the git directory cannot be moved aside and replaced.
    for (const path of [join(gitDir, 'commondir'), join(gitDir, 'config.worktree'), join(gitDir, 'info', 'attributes')])
      expect((await docker.exec(name, ['touch', path])).code, path).not.toBe(0);
    expect((await docker.exec(name, ['mv', join(tree, '.git'), join(tree, '.old')])).code).not.toBe(0);
    // The data directories a commit writes are writable, so the refusals above
    // are the guard rather than a machine with no git directory in it.
    expect((await docker.exec(name, ['touch', join(gitDir, 'objects', 'probe'), join(gitDir, 'refs', 'probe'), join(gitDir, 'logs', 'probe')])).code).toBe(0);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('commits in a machine on a main checkout, whose git directory root stays writable', async () => {
  const { repo, gitDir } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL });
  const name = `ahpd-gitguard-checkout-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'bind', user: ME });
  try {
    writeFileSync(join(repo, 'src', 'tracked.txt'), 'changed in the machine\n');
    // A main checkout's `index`, `HEAD` and `COMMIT_EDITMSG` are files in the
    // git directory's root, which is why that root is writable there.
    expect((await docker.exec(name, ['git', '-C', repo, 'add', '-A'])).code).toBe(0);
    expect((await docker.exec(name, ['git', '-C', repo, 'commit', '-q', '-m', 'from the machine'])).code).toBe(0);
    expect(headOf(repo, 'main')).toContain('from the machine');
    // And the paths pinned over it are not writable - the root's own names, and
    // the two below it: a sibling worktree's `commondir`, which is the one this
    // repository has, and `objects/info/alternates`.
    for (const path of [
      join(gitDir, 'commondir'),
      join(gitDir, 'config.worktree'),
      join(gitDir, 'packed-refs'),
      join(gitDir, 'worktrees', 'tree', 'commondir'),
      join(gitDir, 'objects', 'info', 'alternates'),
    ]) expect((await docker.exec(name, ['touch', path])).code, path).not.toBe(0);
    expect((await docker.exec(name, ['mv', gitDir, join(repo, '.old')])).code).not.toBe(0);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);
