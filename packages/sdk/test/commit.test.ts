import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { metaKeys } from '../../../tools/wire.mjs';
import { gitChanges } from '../src/changes.js';
import type { ChangesetOperationContext } from '../src/types/changes.js';

/*
 * Staging and the commit form's arguments, on a real repository.
 *
 * Git is real because the question is what the index holds: the `_meta` a row
 * carries is `git status`'s two letters, and a commit that covers a selection
 * is `git add` and `git commit` run against that selection. A scripted source
 * would only prove the script.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

/** Porcelain status with its two columns kept, which `git`'s trim would eat. */
const porcelain = (dir: string): string =>
  execFileSync('git', ['-C', dir, 'status', '--porcelain'], { stdio: 'pipe' }).toString().trimEnd();

/** A repository on `main` with one committed file. */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-commit-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
};

const invoke = (
  dir: string,
  meta: Record<string, unknown>,
  context: ChangesetOperationContext = {},
) => {
  const source = gitChanges();
  if (source.invoke === undefined) throw new Error('gitChanges() no longer runs operations');
  return source.invoke({ ...context, dir, session: 'ahp-session:/s', scope: 'uncommitted', operationId: 'commit', meta });
};

/** One invocation of any operation, pointed at a `file://` resource. */
const operate = (
  dir: string,
  operationId: string,
  resource?: string,
  context: ChangesetOperationContext = {},
) => {
  const source = gitChanges();
  if (source.invoke === undefined) throw new Error('gitChanges() no longer runs operations');
  return source.invoke({
    ...context,
    dir,
    session: 'ahp-session:/s',
    scope: 'uncommitted',
    operationId,
    ...(resource === undefined ? {} : { target: { kind: 'resource' as const, resource } }),
  });
};

describe('staging, as the changeset reports it', () => {
  it('marks a staged change and a working-tree change apart, and an untracked file as unstaged', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    writeFileSync(join(dir, 'fresh.txt'), 'new\n');
    git(dir, 'add', 'tracked.txt');
    const source = gitChanges();
    const state = await source.state?.(dir, 'ahp-session:/s', 'uncommitted');
    const meta = Object.fromEntries((state?.files ?? []).map((file) => [file.id, file._meta]));
    expect(meta[`file://${dir}/tracked.txt`]).toEqual({ staged: true, unstaged: false });
    expect(meta[`file://${dir}/fresh.txt`]).toEqual({ staged: false, unstaged: true });
  });

  it('says both when a staged file changed again, because a commit form must not hide half', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    git(dir, 'add', 'tracked.txt');
    writeFileSync(join(dir, 'tracked.txt'), 'three\n');
    const source = gitChanges();
    const state = await source.state?.(dir, 'ahp-session:/s', 'uncommitted');
    expect(state?.files?.[0]?._meta).toEqual({ staged: true, unstaged: true });
  });

  it('writes no `_meta` key on a row but the two a commit form is drawn from', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    writeFileSync(join(dir, 'fresh.txt'), 'new\n');
    git(dir, 'add', 'tracked.txt');
    const source = gitChanges();
    const state = await source.state?.(dir, 'ahp-session:/s', 'uncommitted');
    /*
     * The same census the wire test runs over the whole capture, over the rows
     * this file makes. `_meta` is the protocol's one open bag, so nothing else
     * closes it: a third key here reaches every client with no schema
     * noticing, and the two that are there are what a commit form is drawn
     * from.
     */
    expect([...new Set(metaKeys({ state }).map((one) => one.key))].sort()).toEqual(['staged', 'unstaged']);
  });

  it('keeps a staged rename as one row under its new name', async () => {
    const dir = repository();
    git(dir, 'mv', 'tracked.txt', 'new.txt');
    const source = gitChanges();
    const state = await source.state?.(dir, 'ahp-session:/s', 'uncommitted');
    const rows = state?.files ?? [];
    expect(rows.map((one) => one.id)).toEqual([`file://${dir}/new.txt`]);
    expect(rows[0]?._meta).toEqual({ staged: true, unstaged: false });
  });

  it('keeps a working-tree rename as one row under its new name', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'Data.txt'), 'data\n');
    git(dir, 'add', 'Data.txt');
    git(dir, 'commit', '-q', '-m', 'data');
    renameSync(join(dir, 'Data.txt'), join(dir, 'new.txt'));
    git(dir, 'add', '-N', 'new.txt');
    // Git's own view: the rename is in the working-tree column.
    expect(porcelain(dir)).toBe(' R Data.txt -> new.txt');
    const source = gitChanges();
    const state = await source.state?.(dir, 'ahp-session:/s', 'uncommitted');
    const rows = state?.files ?? [];
    expect(rows.map((one) => one.id)).toEqual([`file://${dir}/new.txt`]);
    expect(rows[0]?.edit.after).toBeDefined();
  });
});

describe('a session in a subfolder of its repository', () => {
  /** A repository with a committed `sub/kept.txt`, a new `sub/new.txt` and a new file at the root. */
  const nested = (): { dir: string; sub: string } => {
    const dir = repository();
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'kept.txt'), 'kept\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'sub');
    writeFileSync(join(sub, 'new.txt'), 'one\ntwo\nthree\n');
    writeFileSync(join(dir, 'root.txt'), 'root\n');
    return { dir, sub };
  };

  it('lists a new file under its real path, and nothing outside the folder', async () => {
    const { dir, sub } = nested();
    const state = await gitChanges().state?.(sub, 'ahp-session:/s', 'uncommitted');
    const rows = state?.files ?? [];
    expect(rows.map((one) => one.id)).toEqual([`file://${dir}/sub/new.txt`]);
    expect(rows[0]?.edit.after?.uri).toBe(`file://${dir}/sub/new.txt`);
    expect(rows[0]?.edit.diff).toEqual({ added: 3, removed: 0 });
  });

  it('reads a changed file\'s before from the commit, and counts it', async () => {
    const { dir, sub } = nested();
    writeFileSync(join(sub, 'kept.txt'), 'kept\nmore\n');
    const source = gitChanges();
    await source.refresh?.(sub);
    const state = await source.state?.(sub, 'ahp-session:/s', 'uncommitted');
    const row = (state?.files ?? []).find((one) => one.id === `file://${dir}/sub/kept.txt`);
    expect(row?.edit.diff).toEqual({ added: 1, removed: 0 });
    const before = row?.edit.before?.content?.uri;
    expect(before).toBeDefined();
    expect((await source.read?.(before as string))?.data).toBe('kept\n');
  });

  it('stages and unstages a file from its row', async () => {
    const { dir, sub } = nested();
    const state = await gitChanges().state?.(sub, 'ahp-session:/s', 'uncommitted');
    const id = state?.files?.[0]?.id as string;
    await operate(sub, 'stage', id);
    expect(porcelain(dir)).toContain('A  sub/new.txt');
    await operate(sub, 'unstage', id);
    expect(porcelain(dir)).toContain('?? sub/new.txt');
  });
});

describe('the commit the changeset offers', () => {
  const offered = async (dir: string, subject: string) => {
    const source = gitChanges();
    await source.refresh?.(dir);
    return source.operations?.(dir, 'ahp-session:/s', 'uncommitted', { subject })
      ?.find((one) => one.id === 'commit')?.confirmation;
  };

  it('asks with the staged count and the subject when anything is staged', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    git(dir, 'add', 'a.txt', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'both');
    writeFileSync(join(dir, 'a.txt'), 'a2\n');
    writeFileSync(join(dir, 'b.txt'), 'b2\n');
    git(dir, 'add', 'a.txt');
    expect(await offered(dir, 'Fix the build')).toBe("Commit 1 staged file as 'Fix the build'?");
  });

  it('counts every file and the untracked ones when nothing is staged', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    git(dir, 'add', 'a.txt', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'both');
    writeFileSync(join(dir, 'a.txt'), 'a2\n');
    writeFileSync(join(dir, 'b.txt'), 'b2\n');
    writeFileSync(join(dir, 'c.txt'), 'c\n');
    expect(await offered(dir, 'Fix the build')).toBe("Commit 3 files, 1 untracked, as 'Fix the build'?");
  });
});

describe('committing what is staged', () => {
  it('commits the index when anything is staged, and leaves the rest uncommitted', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    git(dir, 'add', 'a.txt', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'both');
    writeFileSync(join(dir, 'a.txt'), 'a2\n');
    writeFileSync(join(dir, 'b.txt'), 'b2\n');
    writeFileSync(join(dir, 'c.txt'), 'c\n');
    git(dir, 'add', 'a.txt');
    const said = await invoke(dir, { 'ahp.commit': { message: 'Only a\n\nand why' } });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Only a');
    expect(git(dir, 'log', '-1', '--format=%b')).toBe('and why');
    expect(git(dir, 'show', 'HEAD:a.txt')).toBe('a2');
    expect(git(dir, 'show', 'HEAD:b.txt')).toBe('b');
    // The file nobody staged and the untracked one are still there.
    expect(porcelain(dir)).toBe(' M b.txt\n?? c.txt');
    expect(said?.message).toContain('Only a');
  });

  it('commits the staged half of a file whose working tree moved on', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    git(dir, 'add', 'tracked.txt');
    writeFileSync(join(dir, 'tracked.txt'), 'three\n');
    await invoke(dir, { 'ahp.commit': { message: 'Staged half' } });
    expect(git(dir, 'show', 'HEAD:tracked.txt')).toBe('two');
    expect(porcelain(dir)).toBe(' M tracked.txt');
  });

  it('falls back to the session title when no message is given', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    const source = gitChanges();
    if (source.invoke === undefined) throw new Error('gitChanges() no longer runs operations');
    await source.invoke({ dir, session: 'ahp-session:/s', scope: 'uncommitted', operationId: 'commit', subject: 'Fix the kqueue build' });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the kqueue build');
  });

  it('stages everything and commits it when the index holds nothing', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    writeFileSync(join(dir, 'fresh.txt'), 'new\n');
    await invoke(dir, { 'ahp.commit': { message: 'All of it' } });
    expect(porcelain(dir)).toBe('');
    expect(git(dir, 'show', '--stat', '--format=', 'HEAD')).toContain('fresh.txt');
  });

  it('counts any staged entry in a repository with no commit yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-commit-'));
    made.push(dir);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    writeFileSync(join(dir, 'first.txt'), 'one\n');
    git(dir, 'add', 'first.txt');
    await invoke(dir, { 'ahp.commit': { message: 'First' } });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('First');
    expect(git(dir, 'show', '--stat', '--format=', 'HEAD')).toContain('first.txt');
  });
});

describe('the key a commit message arrives under', () => {
  /** What the commit on top of `main` went in with. */
  const subjectOf = (dir: string): string => git(dir, 'log', '-1', '--format=%s');

  it('takes the message from `ahpd.commit`, this host\'s own name for it', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await invoke(dir, { 'ahpd.commit': { message: 'Under my own name' } });
    expect(subjectOf(dir)).toBe('Under my own name');
  });

  it('still takes it from `ahp.commit`, the name it had before the prefix', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await invoke(dir, { 'ahp.commit': { message: 'Under the old name' } });
    expect(subjectOf(dir)).toBe('Under the old name');
  });

  it('lets `ahpd.commit` win when a client sends both', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await invoke(dir, { 'ahpd.commit': { message: 'The new name' }, 'ahp.commit': { message: 'The old name' } });
    expect(subjectOf(dir)).toBe('The new name');
  });
});

describe('what a resource target may name', () => {
  /**
   * A repository with `top.txt` and `sub/inside.txt` committed and then
   * changed, so the session's folder `sub/` is a subdirectory of the
   * repository and `../top.txt` is still inside git.
   */
  const nested = (): { repo: string; dir: string } => {
    const repo = repository();
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'top.txt'), 'one\n');
    writeFileSync(join(repo, 'sub', 'inside.txt'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'nested');
    writeFileSync(join(repo, 'top.txt'), 'two\n');
    writeFileSync(join(repo, 'sub', 'inside.txt'), 'two\n');
    return { repo, dir: join(repo, 'sub') };
  };

  it('refuses a target above the folder, by `..`, by a decoded one and by a symlink', async () => {
    const { repo, dir } = nested();
    symlinkSync(join(repo, 'top.txt'), join(dir, 'link.txt'));
    const refused = 'That file is not in this directory.';
    await expect(operate(dir, 'discard', `file://${repo}/sub/../top.txt`)).rejects.toThrow(refused);
    await expect(operate(dir, 'discard', `file://${repo}/sub/%2E%2E/top.txt`)).rejects.toThrow(refused);
    await expect(operate(dir, 'discard', `file://${dir}/link.txt`)).rejects.toThrow(refused);
    expect(porcelain(repo)).toContain(' M top.txt');
    expect(porcelain(repo)).toContain(' M sub/inside.txt');
  });

  it('stages a link inside the folder as the link, not the file it points at', async () => {
    const { repo, dir } = nested();
    symlinkSync('inside.txt', join(dir, 'alias.txt'));
    await operate(dir, 'stage', `file://${dir}/alias.txt`);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('sub/alias.txt');
  });

  it('discards a file inside the folder and refuses the folder itself', async () => {
    const { repo, dir } = nested();
    const said = await operate(dir, 'discard', `file://${dir}/inside.txt`);
    expect(said?.message).toContain('inside.txt');
    expect(porcelain(repo)).toBe(' M top.txt');
    await expect(operate(dir, 'discard', `file://${dir}`)).rejects.toThrow();
  });
});

describe('staging from the changeset', () => {
  /** A tree with `a.txt` and `b.txt` changed and `new/c.txt` untracked. */
  const dirty = (): string => {
    const dir = repository();
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    writeFileSync(join(dir, 'b.txt'), 'one\n');
    git(dir, 'add', 'a.txt', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'both');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    writeFileSync(join(dir, 'b.txt'), 'two\n');
    mkdirSync(join(dir, 'new'));
    writeFileSync(join(dir, 'new', 'c.txt'), 'one\n');
    return dir;
  };

  const offered = async (dir: string, subject: string) => {
    const source = gitChanges();
    await source.refresh?.(dir);
    return source.operations?.(dir, 'ahp-session:/s', 'uncommitted', { subject }) ?? [];
  };

  it('offers stage and unstage on the uncommitted changeset', async () => {
    const ids = (await offered(dirty(), 'Fix the build')).map((one) => one.id);
    expect(ids).toContain('stage');
    expect(ids).toContain('unstage');
  });

  it('stages a file, a folder under it, and the folder itself', async () => {
    const dir = dirty();
    await operate(dir, 'stage', `file://${dir}/a.txt`);
    expect(porcelain(dir)).toBe('M  a.txt\n M b.txt\n?? new/');
    const commit = (await offered(dir, 'Fix the build')).find((one) => one.id === 'commit');
    expect(commit?.confirmation).toBe("Commit 1 staged file as 'Fix the build'?");

    await operate(dir, 'stage', `file://${dir}/new/`);
    expect(porcelain(dir)).toBe('M  a.txt\n M b.txt\nA  new/c.txt');

    await operate(dir, 'stage', `file://${dir}`);
    expect(porcelain(dir)).toBe('M  a.txt\nM  b.txt\nA  new/c.txt');
  });

  it('unstages one file and leaves the rest, and the folder takes everything', async () => {
    const dir = dirty();
    await operate(dir, 'stage', `file://${dir}`);
    expect(porcelain(dir)).toBe('M  a.txt\nM  b.txt\nA  new/c.txt');

    await operate(dir, 'unstage', `file://${dir}/a.txt`);
    expect(porcelain(dir)).toBe(' M a.txt\nM  b.txt\nA  new/c.txt');

    await operate(dir, 'unstage', `file://${dir}`);
    expect(porcelain(dir)).toBe(' M a.txt\n M b.txt\n?? new/');
  });

  it('stages a clean file without an error', async () => {
    const dir = repository();
    const said = await operate(dir, 'stage', `file://${dir}/tracked.txt`);
    expect(said?.message).toContain('tracked.txt');
  });

  it('unstages in a repository with no commit yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-commit-'));
    made.push(dir);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    writeFileSync(join(dir, 'first.txt'), 'one\n');
    git(dir, 'add', 'first.txt');
    await operate(dir, 'unstage', `file://${dir}/first.txt`);
    expect(porcelain(dir)).toBe('?? first.txt');
  });
});
