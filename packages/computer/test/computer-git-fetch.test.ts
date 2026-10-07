import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MACHINE_OBJECTS } from '../src/gitdir.js';
import { dockerRuntime } from '../src/runtime.js';
import { computerTools } from '../src/tools.js';
import type { HostTool, ToolCall } from '../../sdk/src/types/host.js';

/*
 * What a machine with a repository can reach of the host's git directory, on a
 * real Docker - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 *
 * The rest of this package's cases ask the scripted Docker what the runtime
 * asked it for. That answers the mounts and nothing about what a container then
 * does with them, and this layout is a claim about exactly that: that the
 * machine's git directory is its own, that the host's is not mounted anywhere
 * but `objects/` read-only, and that the host's own git cannot be made to write
 * through a link a machine planted. So these run the real program, and skip
 * where there is none.
 */

/** The image: one with `git` in it and no entrypoint, which the runtime's `sleep infinity` would replace. */
const IMAGE = 'node:22';
const LABEL = 'ahpd.gitfetch=1';
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

/** One tool of the provider's, by name, and a call to it with nothing else. */
const tool = (tools: HostTool[], name: string): HostTool =>
  tools.find((one) => one.definition.name === name) as HostTool;

const at = {} as ToolCall;

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A real repository with one commit and one linked worktree, every path resolved. */
const repository = () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-git-fetch-'));
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
  return { repo, tree, gitDir: join(repo, '.git'), state: join(loose as string, 'config') };
};

/** The commit a branch is at, as the host's own git answers it. */
const headOf = (repo: string, branch: string): string =>
  execFileSync('git', ['-C', repo, 'rev-parse', branch], { stdio: 'pipe' }).toString().trim();

/** One git command in the machine, in the tree the machine was given. */
const inMachine = (docker: ReturnType<typeof dockerRuntime>, name: string, tree: string, args: string[]) =>
  docker.exec(name, ['git', '-C', tree, ...args]);

it.skipIf(!DOCKER)('gives a machine on a linked worktree no path into the host\'s git directory', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-worktree-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    /*
     * The link the host's own git would follow: git writes none under `logs/`,
     * and with the machine committing in a volume of its own there is no path
     * there at all - the git directory git answers for the tree is the host's,
     * which is not mounted.
     */
    expect((await docker.exec(name, ['ln', '-sf', '/tmp/x', join(gitDir, 'logs', 'HEAD')])).code).not.toBe(0);
    // Nor is any other path of it there to write to: the host's git directory
    // is mounted nowhere in the machine.
    for (const path of [join(gitDir, 'config'), join(gitDir, 'HEAD'), join(gitDir, 'refs'), join(gitDir, 'logs')]) {
      expect((await docker.exec(name, ['touch', path])).code, path).not.toBe(0);
    }
    // The host's objects are the one thing of it that reaches the machine, and
    // read-only: the machine reads the history and writes none of it.
    expect((await docker.exec(name, ['touch', join(MACHINE_OBJECTS, 'probe')])).code).not.toBe(0);
    // And the tree's own `.git` is a bind of a file this host wrote, so it
    // cannot be moved aside and replaced by a directory the machine fills.
    expect((await docker.exec(name, ['mv', join(tree, '.git'), join(tree, '.old')])).code).not.toBe(0);
    // The host's git directory is what it was: no reflog, no ref, no lock.
    expect(readFileSync(join(gitDir, 'config'), 'utf8')).not.toBe('');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('gives a machine on a main checkout a git directory of its own, at the tree\'s own path', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-checkout-${String(process.pid)}`;
  const before = readFileSync(join(gitDir, 'config'), 'utf8');
  const names = readdirSync(gitDir).sort();
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', user: ME });
  try {
    /*
     * A main checkout's `.git` is a directory, so the machine's volume lands
     * over it: what is at that path in there is the machine's own git
     * directory, and a write in it is the machine writing in its own.
     */
    expect((await docker.exec(name, ['touch', join(gitDir, 'probe')])).code).toBe(0);
    expect(existsSync(join(gitDir, 'probe'))).toBe(false);
    // The one path of the host's that reaches the machine - its objects -
    // read-only, and at a path of ahpd's own, since the tree's `.git` here is
    // the machine's.
    expect((await docker.exec(name, ['touch', join(MACHINE_OBJECTS, 'probe')])).code).not.toBe(0);
    // And the volume is a mount point, so the tree's `.git` cannot be moved
    // aside and replaced by a directory the machine fills.
    expect((await docker.exec(name, ['mv', join(repo, '.git'), join(repo, '.old')])).code).not.toBe(0);
    // The host's git directory is what it was: the machine wrote nothing in it.
    expect(readdirSync(gitDir).sort()).toEqual(names);
    expect(readFileSync(join(gitDir, 'config'), 'utf8')).toBe(before);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * The seed: what the machine's own git directory holds once the machine is up.
 *
 * Nothing of the host's is written to make it, and the repository in there is
 * the tree's own - the same branch, the same commit, the same identity a commit
 * needs - so an agent finds git working in the folder it was given, without a
 * command of its own to make that true.
 */
it.skipIf(!DOCKER)('gives a machine on a linked worktree the tree\'s branch, commit and identity', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-seed-tree-${String(process.pid)}`;
  const head = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // The branch the host's tree is on, at the commit the host's tree is at,
    // and nothing uncommitted: the index is the one the commit names and the
    // working tree is the host's own.
    expect(await inMachine(docker, name, tree, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(head);
    expect((await inMachine(docker, name, tree, ['branch', '--show-current'])).output).toBe('work');
    expect((await inMachine(docker, name, tree, ['log', '-1', '--format=%s'])).output).toBe('first');
    // The identity a commit needs, as the host's tree answers it, and nothing
    // else of the host's config: no remote, so the machine reaches no other
    // repository, and no hooks path, which would be a path of the host's.
    const local = (await inMachine(docker, name, tree, ['config', '--list', '--local'])).output;
    expect(local).toContain('user.name=Test');
    expect(local).toContain('user.email=test@example.com');
    expect(local).not.toContain('remote.');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('gives a machine on a main checkout the branch its tree is on', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-seed-checkout-${String(process.pid)}`;
  const head = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', user: ME });
  try {
    /*
     * A main checkout's git directory is the volume, at the tree's own `.git`:
     * git in the machine reads the host's objects through the alternates and
     * writes its own beside them, so the history is there and the commit is the
     * one the host's own checkout is at.
     */
    expect(await inMachine(docker, name, repo, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    expect((await inMachine(docker, name, repo, ['rev-parse', 'HEAD'])).output).toBe(head);
    expect((await inMachine(docker, name, repo, ['branch', '--show-current'])).output).toBe('main');
    // Read and not written: the host's objects are the one thing of its that
    // reaches the machine, and the machine's own are its own.
    expect((await docker.exec(name, ['touch', join(MACHINE_OBJECTS, 'probe')])).code).not.toBe(0);
    expect((await docker.exec(name, ['touch', join(gitDir, 'objects', 'probe')])).code).toBe(0);
    expect(existsSync(join(gitDir, 'objects', 'probe'))).toBe(false);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * Bringing the work back.
 *
 * A machine commits in a git directory of its own, so nothing of what it did is
 * on the host's branch until ahpd fetches it - and what comes back arrives as a
 * bundle on a pipe, written into a private file of this host's which is the only
 * thing the host's git is ever handed. Decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 */

/** What ahpd left behind in the temporary directory, by the prefix it makes its own. */
const leftOver = (): string[] => readdirSync(tmpdir()).filter((one) => one.startsWith('ahpd-bringback-'));

/**
 * Take a container away as Docker does, for a case whose machine cannot be
 * removed through the runtime.
 *
 * A removal that cannot bring a machine's work out keeps the machine, which is
 * the whole of what those cases are about: the container and the volume holding
 * its git directory are taken away here so that a case which proved that leaves
 * nothing running on the machine the tests run on.
 */
const forceRemove = (name: string): void => {
  execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' });
  execFileSync('docker', ['volume', 'rm', '-f', `ahpd-git-${name}`], { stdio: 'pipe' });
};

/** The commit a ref is at, as the host's own git answers it, and nothing where there is no such ref. */
const refOf = (repo: string, ref: string): string =>
  execFileSync('git', ['-C', repo, 'for-each-ref', '--format=%(objectname)', ref], { stdio: 'pipe' }).toString().trim();

/** One commit in the machine: a file in the tree it was given, staged and committed there. */
const commitIn = async (
  docker: ReturnType<typeof dockerRuntime>,
  name: string,
  tree: string,
  file: string,
  subject: string,
): Promise<string> => {
  writeFileSync(join(tree, file), `${subject}\n`);
  expect((await inMachine(docker, name, tree, ['add', file])).code).toBe(0);
  expect((await inMachine(docker, name, tree, ['commit', '-q', '-m', subject])).code).toBe(0);
  return (await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output;
};

/**
 * One commit on a branch that git itself would never write: no author and no
 * committer, written into the machine's own repository as it is.
 *
 * The machine's git bundles it, since the repository is the machine's own, and
 * the host's git refuses it - an object every later read of the host's
 * repository would trip on. So this is a machine holding work that cannot be
 * brought back, with everything else about it working.
 */
const breakBranch = async (
  docker: ReturnType<typeof dockerRuntime>,
  name: string,
  tree: string,
  branch: string,
): Promise<void> => {
  const broken = `git -C ${tree} update-ref refs/heads/${branch} "$(printf 'tree %s\\n\\nmalformed\\n' "$(git -C ${tree} rev-parse 'HEAD^{tree}')" | git -C ${tree} hash-object -w --literally -t commit --stdin)"`;
  expect((await docker.exec(name, ['sh', '-c', broken])).code).toBe(0);
};

/** One commit on the host, in the tree, while the machine is up. */
const hostCommitIn = (tree: string, file: string, subject: string): string => {
  writeFileSync(join(tree, file), `${subject}\n`);
  execFileSync('git', ['-C', tree, 'add', file], { stdio: 'pipe' });
  execFileSync('git', ['-C', tree, 'commit', '-q', '-m', subject], { stdio: 'pipe' });
  return execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { stdio: 'pipe' }).toString().trim();
};

it.skipIf(!DOCKER)('brings what a machine committed back onto the host\'s branch', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-back-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // A commit in the machine is in the machine's own git directory: the host's
    // branch has never heard of it, and the file the agent wrote is in the tree
    // the two share, as a change nobody on the host has committed.
    const made = await commitIn(docker, name, tree, 'brought.txt', 'from the machine');
    expect(made).not.toBe(before);
    expect(headOf(repo, 'work')).toBe(before);

    expect(await docker.bringBack(name)).toEqual({ moved: true });

    // And now the host's branch is at it, with the host's index agreeing: what
    // the agent wrote reads as committed work rather than as a change nobody
    // made, and the tree is clean.
    expect(headOf(repo, 'work')).toBe(made);
    expect(execFileSync('git', ['-C', tree, 'status', '--porcelain'], { stdio: 'pipe' }).toString()).toBe('');
    // Nothing was fetched twice: the branch holds the machine's work already.
    expect(await docker.bringBack(name)).toEqual({ moved: false });
    // And the file the work came through is gone: what came back is in the
    // repository now, and nothing of the machine's is left on the host's disk.
    expect(leftOver()).toEqual([]);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('refuses a bundle the host\'s git cannot check, and leaves the branch where it was', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-fsck-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  const hidden = `refs/ahpd/machines/${name}/work`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    await commitIn(docker, name, tree, 'fine.txt', 'a commit git would write');
    await breakBranch(docker, name, tree, 'work');

    await expect(docker.bringBack(name)).rejects.toThrow(/fsck/);

    // The host's repository is what it was: no branch moved, and the hidden ref
    // is not there, so a fetch that could not be checked left nothing behind.
    expect(headOf(repo, 'work')).toBe(before);
    expect(refOf(repo, hidden)).toBe('');
    expect(leftOver()).toEqual([]);
  }
  finally {
    // Away with Docker rather than through the runtime: this machine holds a
    // commit the host's git will not read, and a removal that cannot bring a
    // machine's work out keeps it.
    forceRemove(name);
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('leaves the work under the hidden ref where the host\'s branch moved on', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-behind-${String(process.pid)}`;
  const hidden = `refs/ahpd/machines/${name}/work`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    const made = await commitIn(docker, name, tree, 'agent.txt', 'from the machine');
    // A person's own commit on the branch, in the tree, while the machine was
    // working: the machine's branch no longer leads to where the host's does,
    // and moving the branch would throw the person's commit away.
    const moved = hostCommitIn(tree, 'host.txt', 'the host moved on');

    expect(await docker.bringBack(name)).toEqual({ moved: false, waiting: hidden });

    // The work is safe under the hidden ref and nowhere else: the branch is the
    // person's, and what waits is the machine's own commit.
    expect(headOf(repo, 'work')).toBe(moved);
    expect(refOf(repo, hidden)).toBe(made);
    expect(leftOver()).toEqual([]);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('leaves the work under the hidden ref where the host has staged changes', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-staged-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  const hidden = `refs/ahpd/machines/${name}/work`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // The machine's commit is a fast-forward for the host's branch, and the
    // host has something staged: moving the branch would reset the index over
    // it, and a person's staged work is not ahpd's to throw away.
    const made = await commitIn(docker, name, tree, 'agent.txt', 'from the machine');
    writeFileSync(join(tree, 'staged.txt'), 'staged\n');
    execFileSync('git', ['-C', tree, 'add', 'staged.txt'], { stdio: 'pipe' });

    expect(await docker.bringBack(name)).toEqual({ moved: false, waiting: hidden });

    expect(headOf(repo, 'work')).toBe(before);
    expect(refOf(repo, hidden)).toBe(made);
    // And what was staged is still staged, exactly as it was.
    expect(execFileSync('git', ['-C', tree, 'diff', '--cached', '--name-only'], { stdio: 'pipe' }).toString()).toBe('staged.txt\n');
    expect(leftOver()).toEqual([]);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * A branch the host does not have.
 *
 * An agent that runs `git checkout -b` in a machine has made a branch of its
 * own, and the host's repository has never heard of it: `rev-parse` on a ref
 * that is not there answers its own name rather than failing, so a fetch that
 * reads a missing branch as a commit decides the machine is behind a branch
 * that does not exist and leaves the work waiting for ever. A branch the host
 * does not have is made at the machine's commit - there is no history of the
 * host's for it to lead on from, so nothing is checked.
 */
it.skipIf(!DOCKER)('makes a branch on the host that the machine made and the host never had', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-newbranch-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    expect((await inMachine(docker, name, tree, ['checkout', '-q', '-b', 'fix'])).code).toBe(0);
    const made = await commitIn(docker, name, tree, 'fixed.txt', 'a branch of its own');
    expect(refOf(repo, 'refs/heads/fix')).toBe('');

    expect(await docker.bringBack(name)).toEqual({ moved: true });

    // The branch is on the host at the machine's commit, and the branch the
    // host's tree is on is where it was: the machine made a branch nobody else
    // had, and its commit is on it.
    expect(refOf(repo, 'refs/heads/fix')).toBe(made);
    expect(headOf(repo, 'work')).toBe(before);
    // And nothing waits: what was brought back is on a branch of the host's.
    expect(refOf(repo, `refs/ahpd/machines/${name}/fix`)).toBe('');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * Every branch, and not only the one the machine is on.
 *
 * A machine that made a branch of its own and went back to another holds that
 * commit on no branch any fetch would look at, and the volume it is in goes
 * with the machine: an agent's work on a branch nobody is standing on any more
 * is the work most easily lost. So the fetch asks the machine what branches it
 * has rather than which one it is on, and each comes back on its own.
 */
it.skipIf(!DOCKER)('brings back every branch the machine holds, not only the one it is on', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-everybranch-${String(process.pid)}`;
  const before = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // A commit on the branch the machine was seeded with, a branch of its own
    // with a commit on that, and back to the first.
    const first = await commitIn(docker, name, repo, 'main.txt', 'on the branch');
    expect((await inMachine(docker, name, repo, ['checkout', '-q', '-b', 'spike'])).code).toBe(0);
    const second = await commitIn(docker, name, repo, 'spike.txt', 'on a branch of its own');
    expect((await inMachine(docker, name, repo, ['checkout', '-q', 'main'])).code).toBe(0);

    expect(await docker.bringBack(name)).toEqual({ moved: true });

    // Both commits are on the host, each on the branch the machine had it on:
    // the branch the machine is on moved, and the branch it is not on was made.
    expect(headOf(repo, 'main')).toBe(first);
    expect(refOf(repo, 'refs/heads/spike')).toBe(second);
    expect(first).not.toBe(before);
    expect(second).not.toBe(first);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('answers nothing to bring back where the machine has committed nothing', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-nothing-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // A machine that has committed nothing has nothing beyond the host's own
    // commit, and git refuses to write a bundle of nothing: that is not a
    // failure and not a fetch, it is a machine that did no work.
    expect(await docker.bringBack(name)).toEqual({ moved: false });
    expect(headOf(repo, 'work')).toBe(before);
    expect(refOf(repo, `refs/ahpd/machines/${name}/work`)).toBe('');
    expect(leftOver()).toEqual([]);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * The tool that gives a machine back.
 *
 * `release_computer` is how an agent lets a machine go, and the removal is where
 * the machine's commits are fetched out of it: the volume holding its own git
 * directory goes with the container, so the fetch runs in the removal and has
 * nothing but that moment. This case holds the tool to the fetch being made
 * there, and to the commit arriving on the host before the machine does.
 */
it.skipIf(!DOCKER)('releases a machine with the fetch that brings its commit to the host', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-release-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  const tools = computerTools(docker, { image: IMAGE, label: LABEL, max: 4, prefix: 'ahpd-gitfetch' });
  try {
    const made = await commitIn(docker, name, tree, 'released.txt', 'from the machine');
    expect(made).not.toBe(before);

    expect(String(await tool(tools, 'release_computer').run({ id: name }, at))).toContain('gone');

    // The commit is on the host's branch, and the machine is gone: the fetch ran
    // in the removal, before the volume holding it was.
    expect(headOf(repo, 'work')).toBe(made);
    expect((await docker.list()).map((one) => one.id)).not.toContain(name);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * A machine that goes without losing what is in it.
 *
 * The removal is the last moment a machine's work exists anywhere, and the two
 * commands that read it out - the fetch of what it committed and the stash of
 * what it never did - run inside it. `docker exec` refuses a container that is
 * not up, so a stopped machine is started again first, and a machine whose work
 * cannot be read out is kept, with its volumes, and says why in one sentence.
 */
it.skipIf(!DOCKER)('brings back the commits of a stopped machine before it removes it', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-stopped-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    const made = await commitIn(docker, name, tree, 'stopped.txt', 'from the machine');
    expect(made).not.toBe(before);
    // A machine that is not up, which is what a `docker stop` or a daemon that
    // went down leaves behind: its commit is in the volume the removal takes.
    execFileSync('docker', ['stop', '-t', '0', name], { stdio: 'pipe' });

    await docker.remove(name);

    expect(headOf(repo, 'work')).toBe(made);
    expect((await docker.list()).map((one) => one.id)).not.toContain(name);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('keeps the uncommitted files of a stopped copy machine before it removes it', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-stopped-copy-${String(process.pid)}`;
  const kept = `refs/ahpd/machines/${name}/uncommitted`;
  const before = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', sessionTree: 'copy', user: ME });
  try {
    // What the machine committed and what it never did, both in its own
    // checkout inside the volume the removal takes with it.
    await commitInside(docker, name, repo, 'src/tracked.txt', 'committed work');
    await writeInside(docker, name, join(repo, 'src', 'tracked.txt'), 'never committed');
    execFileSync('docker', ['stop', '-t', '0', name], { stdio: 'pipe' });

    await docker.remove(name);

    // The commit is on the host's branch and the file nobody committed is
    // under the ref ahpd keeps such work in: both were read out of a machine
    // that was not running when the removal began.
    expect(headOf(repo, 'main')).not.toBe(before);
    expect(execFileSync('git', ['-C', repo, 'show', `${kept}:src/tracked.txt`], { stdio: 'pipe' }).toString()).toBe('never committed\n');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('keeps a machine whose work cannot be brought back, and says why', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-keeps-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    await commitIn(docker, name, tree, 'fine.txt', 'a commit git would write');
    await breakBranch(docker, name, tree, 'work');

    const refused = await docker.remove(name).then(() => undefined, (error: Error) => error);
    expect(refused?.message).toContain(`Could not remove ${name}`);
    expect(refused?.message).toContain('still here');

    // Kept, with its git directory and its volume: the work is in there, and
    // a volume removed with it is a commit nobody can get back.
    expect((await docker.list()).map((one) => one.id)).toContain(name);
    expect(headOf(repo, 'work')).toBe(before);
  }
  finally {
    forceRemove(name);
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('release_computer answers the refusal and the machine is still there', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-release-keeps-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  const tools = computerTools(docker, { image: IMAGE, label: LABEL, max: 4, prefix: 'ahpd-gitfetch' });
  try {
    await commitIn(docker, name, tree, 'fine.txt', 'a commit git would write');
    await breakBranch(docker, name, tree, 'work');

    // The answer is the sentence the removal refused with, and never a claim
    // that the machine is gone: an agent told that would have nothing left to
    // act on.
    const said = String(await tool(tools, 'release_computer').run({ id: name }, at));
    expect(said).toContain('still here');
    expect(said).not.toContain('is gone');

    expect((await docker.list()).map((one) => one.id)).toContain(name);
  }
  finally {
    forceRemove(name);
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('gives a machine a detached HEAD where the host\'s tree has one', async () => {
  const { repo, tree, gitDir, state } = repository();
  execFileSync('git', ['-C', tree, 'checkout', '-q', '--detach'], { stdio: 'pipe' });
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-seed-detached-${String(process.pid)}`;
  const head = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // A tree on no branch is a machine on no branch, at the same commit: the
    // agent's work is fetched to the hidden ref and reaches no branch of the
    // host's, which is the whole of what a detached host HEAD decides.
    expect(await inMachine(docker, name, tree, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(head);
    expect((await inMachine(docker, name, tree, ['symbolic-ref', '-q', 'HEAD'])).code).not.toBe(0);
    expect((await inMachine(docker, name, tree, ['branch', '--show-current'])).output).toBe('');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * Following the host's branch.
 *
 * The other direction of the same decision: a machine commits in a git
 * directory of its own, so a commit made on the host since it last looked - a
 * person's, in the tree the two share, or one a changeset operation made - is
 * not in the history the agent's git reads. `follow` hands it over, and hands
 * nothing over where the machine holds work the host has not fetched - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 */

it.skipIf(!DOCKER)('moves a machine to the commit the host made between turns', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-follow-${String(process.pid)}`;
  const seeded = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // A person's commit in the tree, after the machine was made: the machine's
    // own git directory has never heard of it, and the file the person wrote
    // reads in there as something nobody committed.
    const moved = hostCommitIn(tree, 'host.txt', 'the host moved on');
    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(seeded);
    expect(await inMachine(docker, name, tree, ['status', '--porcelain'])).toEqual({ output: '?? host.txt', code: 0 });

    await docker.follow(name);

    // The machine is where the host's tree is: the commit, the branch it is on,
    // and an index that names it, so the agent's next turn reads the branch the
    // host is on rather than the one the machine was seeded at.
    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(moved);
    expect((await inMachine(docker, name, tree, ['branch', '--show-current'])).output).toBe('work');
    expect(await inMachine(docker, name, tree, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    // Nothing of the host's was written to hand it over: its branch, its index
    // and its files are what its own git left, and no object was copied - the
    // host's objects are already readable in the machine through the alternates.
    expect(headOf(repo, 'work')).toBe(moved);
    expect(execFileSync('git', ['-C', tree, 'status', '--porcelain'], { stdio: 'pipe' }).toString()).toBe('');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('moves a machine onto the branch the host checks out', async () => {
  const { repo, tree, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-follow-branch-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    /*
     * A person's checkout in the tree, at the same commit: the branch is the
     * half of this a commit does not cover, and it is the branch a machine's
     * work is fetched to the host under - a machine left on the branch it was
     * seeded at would fetch its next commit to a branch the host is not on.
     */
    execFileSync('git', ['-C', tree, 'checkout', '-q', '-b', 'other'], { stdio: 'pipe' });
    expect((await inMachine(docker, name, tree, ['branch', '--show-current'])).output).toBe('work');

    await docker.follow(name);

    expect((await inMachine(docker, name, tree, ['branch', '--show-current'])).output).toBe('other');
    expect((await inMachine(docker, name, tree, ['symbolic-ref', '-q', 'HEAD'])).code).toBe(0);
    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(headOf(repo, 'other'));
    expect(await inMachine(docker, name, tree, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    // A branch of the machine's own is left where it was: the machine only
    // stops being on it, and nothing of the machine's is removed.
    expect((await inMachine(docker, name, tree, ['rev-parse', 'refs/heads/work'])).output).toBe(headOf(repo, 'work'));
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('moves a machine on no branch to a commit made on a host on no branch', async () => {
  const { repo, tree, gitDir, state } = repository();
  execFileSync('git', ['-C', tree, 'checkout', '-q', '--detach'], { stdio: 'pipe' });
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-follow-detached-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    const branches = (await inMachine(docker, name, tree, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).output;
    // A commit on the host's detached HEAD, the machine being detached too: the
    // same hand-over with no branch to name, since a host on no branch has none
    // to hand over.
    const detached = hostCommitIn(tree, 'detached.txt', 'on no branch');
    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(headOf(repo, 'work'));

    await docker.follow(name);

    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(detached);
    expect((await inMachine(docker, name, tree, ['symbolic-ref', '-q', 'HEAD'])).code).not.toBe(0);
    expect(await inMachine(docker, name, tree, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    // And no branch was made for it: a machine on no branch fetches its work to
    // the hidden ref, which is the whole of what a detached host HEAD decides.
    expect((await inMachine(docker, name, tree, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).output).toBe(branches);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('leaves a machine that holds a commit the host has not fetched', async () => {
  const { repo, tree, gitDir, state } = repository();
  const lines: string[] = [];
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state, log: (line) => { lines.push(line); } });
  const name = `ahpd-gitfetch-follow-unfetched-${String(process.pid)}`;
  const before = headOf(repo, 'work');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    // A commit in the machine and no fetch: it exists in the machine's own git
    // directory and nowhere else on this host, so moving the machine off it
    // would leave it behind in a volume the removal takes with the machine.
    const made = await commitIn(docker, name, tree, 'agent.txt', 'from the machine');

    await docker.follow(name);

    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(made);
    expect((await inMachine(docker, name, tree, ['branch', '--show-current'])).output).toBe('work');
    expect(headOf(repo, 'work')).toBe(before);
    // And the log says so: this is not a machine that failed, it is one whose
    // turn has not ended, and the fetch at the turn's end is what moves it.
    expect(lines.some((one) => one.includes(`${name} is not moved`) && one.includes('the host has not fetched'))).toBe(true);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

/*
 * The machine that works in a copy of the tree.
 *
 * `sessionTree: "copy"` is the same decision read the other way: the machine's
 * working tree is the volume it commits into, mounted at the tree's own path,
 * and nothing of the host's folder is in the machine at all. So a file the
 * machine writes is not in the host's folder, the host's tree is moved by the
 * `merge --ff-only` under `bringBack` rather than by an index, the host's own
 * uncommitted change in the same path is what stops that merge, and `follow`
 * writes into the machine's checkout - which is only done where that checkout
 * holds nothing nobody committed. Decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 */

/** One commit in the machine, written and committed in the machine's own checkout. */
const commitInside = async (
  docker: ReturnType<typeof dockerRuntime>,
  name: string,
  tree: string,
  file: string,
  subject: string,
): Promise<string> => {
  expect((await docker.exec(name, ['sh', '-c', `printf '${subject}\\n' > ${join(tree, file)}`])).code).toBe(0);
  expect((await inMachine(docker, name, tree, ['add', file])).code).toBe(0);
  expect((await inMachine(docker, name, tree, ['commit', '-q', '-m', subject])).code).toBe(0);
  return (await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output;
};

/** A file in the machine's own checkout, written at the path the tree has it at. */
const writeInside = async (
  docker: ReturnType<typeof dockerRuntime>,
  name: string,
  path: string,
  said: string,
): Promise<void> => {
  expect((await docker.exec(name, ['sh', '-c', `printf '${said}\\n' > ${path}`])).code).toBe(0);
};

it.skipIf(!DOCKER)('keeps what a copy machine wrote out of the host\'s folder until the fetch brings it back', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-copy-${String(process.pid)}`;
  const head = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', sessionTree: 'copy', user: ME });
  try {
    /*
     * The machine's checkout is its own, at the commit the host's tree is at,
     * with git clean in it: the seed is the whole of where it starts, since the
     * volume it works in held nothing.
     */
    expect((await inMachine(docker, name, repo, ['rev-parse', 'HEAD'])).output).toBe(head);
    expect(await inMachine(docker, name, repo, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    expect((await inMachine(docker, name, repo, ['branch', '--show-current'])).output).toBe('main');

    // A file the machine writes is in the machine's checkout and nowhere else:
    // the host's folder is mounted in the machine not at all.
    await writeInside(docker, name, join(repo, 'copy.txt'), 'the machine wrote this');
    expect((await inMachine(docker, name, repo, ['status', '--porcelain'])).output).toBe('?? copy.txt');
    expect(existsSync(join(repo, 'copy.txt'))).toBe(false);
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { stdio: 'pipe' }).toString()).toBe('');

    // And a commit of it is in the machine's own git directory: the host's
    // branch has never heard of it, and the file is still not in its folder.
    const made = await commitInside(docker, name, repo, 'copy.txt', 'from the machine');
    expect(made).not.toBe(head);
    expect(headOf(repo, 'main')).toBe(head);
    expect(existsSync(join(repo, 'copy.txt'))).toBe(false);

    expect(await docker.bringBack(name)).toEqual({ moved: true });

    // The commit is on the host's branch and in the host's tree: a
    // fast-forward merge writes the machine's work where a person's checkout
    // is, which is the whole of what `copy` promises to hand over.
    expect(headOf(repo, 'main')).toBe(made);
    expect(readFileSync(join(repo, 'copy.txt'), 'utf8')).toBe('from the machine\n');
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { stdio: 'pipe' }).toString()).toBe('');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('leaves a copy machine\'s work waiting where the host changed the same file', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-copy-blocked-${String(process.pid)}`;
  const hidden = `refs/ahpd/machines/${name}/main`;
  const before = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', sessionTree: 'copy', user: ME });
  try {
    const made = await commitInside(docker, name, repo, 'src/tracked.txt', 'from the machine');
    // A person's own change to the same file in the host's tree, uncommitted:
    // the merge would write over it, and their work is not ahpd's to throw
    // away - so the merge refuses and the machine's work waits.
    writeFileSync(join(repo, 'src', 'tracked.txt'), 'a person\'s own\n');

    expect(await docker.bringBack(name)).toEqual({ moved: false, waiting: hidden });

    expect(headOf(repo, 'main')).toBe(before);
    expect(refOf(repo, hidden)).toBe(made);
    // And the person's change is exactly what it was: nothing was merged, so
    // nothing was written over.
    expect(readFileSync(join(repo, 'src', 'tracked.txt'), 'utf8')).toBe('a person\'s own\n');
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('keeps what a copy machine never committed when the machine goes', async () => {
  const { repo, gitDir, state } = repository();
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state });
  const name = `ahpd-gitfetch-copy-stash-${String(process.pid)}`;
  const kept = `refs/ahpd/machines/${name}/uncommitted`;
  const before = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', sessionTree: 'copy', user: ME });
  try {
    /*
     * Work the agent did and never committed: the machine's checkout is in the
     * volume the removal takes with it, so this is the last moment it exists
     * anywhere. It is kept as the commit `git stash create` writes, under a ref
     * of ahpd's own - never on a branch of the host's, which is a person's.
     */
    await commitInside(docker, name, repo, 'src/tracked.txt', 'committed work');
    await writeInside(docker, name, join(repo, 'src', 'tracked.txt'), 'never committed');

    await docker.remove(name);

    expect(refOf(repo, kept)).not.toBe('');
    expect(execFileSync('git', ['-C', repo, 'show', `${kept}:src/tracked.txt`], { stdio: 'pipe' }).toString()).toBe('never committed\n');
    // And what was committed is on the branch, as it is for any machine that
    // goes: the fetch happens before the removal, whatever else it keeps.
    expect(headOf(repo, 'main')).not.toBe(before);
    expect(refOf(repo, kept)).not.toBe(headOf(repo, 'main'));
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('moves a copy machine onto the commit the host made between turns', async () => {
  const { repo, gitDir, state } = repository();
  const lines: string[] = [];
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state, log: (line) => { lines.push(line); } });
  const name = `ahpd-gitfetch-copy-follow-${String(process.pid)}`;
  const seeded = headOf(repo, 'main');
  await docker.run({ name, image: IMAGE, label: LABEL, folder: repo, gitDir, gitGuard: 'fetch', sessionTree: 'copy', user: ME });
  try {
    // A person's commit in the tree, after the machine was made: the machine's
    // own checkout has never heard of it.
    const moved = hostCommitIn(repo, 'host.txt', 'the host moved on');
    expect((await inMachine(docker, name, repo, ['rev-parse', 'HEAD'])).output).toBe(seeded);
    expect((await docker.exec(name, ['test', '-e', join(repo, 'host.txt')])).code).not.toBe(0);

    await docker.follow(name);

    // The machine's checkout is the host's commit, file and all: the hand-over
    // is a fast-forward merge in the machine, which is what writes the file
    // there rather than only naming the commit.
    expect((await inMachine(docker, name, repo, ['rev-parse', 'HEAD'])).output).toBe(moved);
    expect((await docker.exec(name, ['test', '-e', join(repo, 'host.txt')])).code).toBe(0);
    expect(await inMachine(docker, name, repo, ['status', '--porcelain'])).toEqual({ output: '', code: 0 });
    expect((await inMachine(docker, name, repo, ['branch', '--show-current'])).output).toBe('main');

    /*
     * And where the machine's own checkout holds work nobody committed, it is
     * left exactly as it is: merging the host's commit in would write over an
     * agent's work in progress, and the log says which half decided it.
     */
    const again = hostCommitIn(repo, 'more.txt', 'the host moved on again');
    await writeInside(docker, name, join(repo, 'host.txt'), 'work in progress');

    await docker.follow(name);

    expect((await inMachine(docker, name, repo, ['rev-parse', 'HEAD'])).output).toBe(moved);
    expect((await inMachine(docker, name, repo, ['status', '--porcelain'])).output).toBe('M host.txt');
    expect(headOf(repo, 'main')).toBe(again);
    expect(lines.some((one) => one.includes(`${name} is not moved`) && one.includes('changes nobody committed'))).toBe(true);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);

it.skipIf(!DOCKER)('leaves a machine whose fetched commit the host\'s branch does not lead on from', async () => {
  const { repo, tree, gitDir, state } = repository();
  const lines: string[] = [];
  const docker = dockerRuntime({ command: 'docker', label: LABEL, configDir: state, log: (line) => { lines.push(line); } });
  const name = `ahpd-gitfetch-follow-beside-${String(process.pid)}`;
  await docker.run({ name, image: IMAGE, label: LABEL, folder: tree, gitDir, gitGuard: 'fetch', user: ME });
  try {
    const made = await commitIn(docker, name, tree, 'agent.txt', 'from the machine');
    const moved = hostCommitIn(tree, 'host.txt', 'the host moved on');
    /*
     * The fetch puts the machine's commit into the host's repository, under the
     * hidden ref since the branch has moved on - and it is from here that
     * `follow` reads a machine's commit. The host has it and the branch is
     * still not one that leads on from it, which is a person's to settle: the
     * machine stays where it is, and its work waits where the fetch left it.
     */
    expect(await docker.bringBack(name)).toEqual({ moved: false, waiting: `refs/ahpd/machines/${name}/work` });

    await docker.follow(name);

    expect((await inMachine(docker, name, tree, ['rev-parse', 'HEAD'])).output).toBe(made);
    expect(headOf(repo, 'work')).toBe(moved);
    expect(lines.some((one) => one.includes(`${name} is not moved`) && one.includes('does not lead on from'))).toBe(true);
  }
  finally {
    await docker.remove(name).catch(() => {});
  }
}, DOCKER_CASE);
