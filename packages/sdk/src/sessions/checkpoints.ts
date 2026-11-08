/** The commits a session's turns leave in its folder, under a ref of its own. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINE_TURN } from '../types/changes.js';
import { runGit } from '../repo/hardened.js';

/*
 * Why a checkpoint at all.
 *
 * Git answers what a working tree looks like now, which is not what a session
 * did: a commit takes that answer to zero, and two sessions in one folder have
 * the same one. A checkpoint is the tree as it was at a moment only the
 * session knows about - before its first turn, and at the end of each of them
 * - so the difference between two of them is that session's own work. It is a
 * commit because a tree that is not committed is collected, and it is a ref of
 * the session's own because the person's branch is theirs.
 */

/**
 * One `git` run, as text, or nothing when it would not run.
 *
 * The same shape as the source's own runner, with an environment a caller can
 * add to: staging into an index of this call's own is the whole trick below,
 * and `GIT_INDEX_FILE` is what says which index.
 */
const git = (dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | undefined> =>
  new Promise((answer) => {
    runGit(dir, args, {
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env },
      // No console window on Windows, where each checkpoint's `git.exe` would
      // open one.
      windowsHide: true,
    }, (error, out) => answer(error ? undefined : out));
  });

/**
 * A session's own words, as a ref name can hold them.
 *
 * A ref name may not carry a space, a `~`, a `^` or a colon, and both a
 * session's id and a turn's are the backend's to spell. Everything outside the
 * set git allows becomes a dash, which is the reference host's rule for the
 * same problem.
 */
const segment = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, '-');

/** Where a session's checkpoints live: one ref per turn. */
const refFor = (session: string, turn: string): string =>
  `refs/agents/${segment(session)}/checkpoints/turn/${segment(turn)}`;

/** The same, as the prefix every ref of one session shares. */
const refsOf = (session: string): string => `refs/agents/${segment(session)}/checkpoints/`;

/**
 * The captures of one session, one at a time.
 *
 * A baseline and the turn that follows it are two writes to one repository,
 * and the second is only worth writing where the first has landed: the host
 * asks for the baseline as a session starts and does not wait for it, so the
 * first turn of a fast session can end before its baseline is written. Chained
 * rather than guarded, so the order the host asked in is the order they run.
 */
const capturing = new Map<string, Promise<void>>();

const inOrder = async (key: string, work: () => Promise<void>): Promise<void> => {
  const before = capturing.get(key) ?? Promise.resolve();
  // The work runs after a failure as well: one capture that could not be
  // written is not a reason the next one is not.
  const next = before.then(work, work);
  capturing.set(key, next);
  await next;
  // The last one out takes the entry with it, so a host that has checkpointed
  // a thousand sessions holds a thousand settled promises for none of them.
  if (capturing.get(key) === next) capturing.delete(key);
};

/**
 * The working tree, written as a commit of the session's own.
 *
 * Three commands and an index of this call's own: `add -A` fills it from the
 * working tree, `write-tree` turns it into a tree object, and `commit-tree`
 * makes a commit of that tree with no parent. Nothing moves the person's
 * branch, index or working tree - the index `add` writes is `GIT_INDEX_FILE`'s,
 * `commit-tree` writes to no ref, and `update-ref` writes under `refs/agents/`,
 * which is nobody's branch.
 *
 * A commit with no parent, because the refs are the history: a checkpoint is a
 * tree that was, rather than a step somebody might walk from one to the next.
 */
const writeTree = async (dir: string, session: string, turn: string): Promise<void> => {
  const staging = await mkdtemp(join(tmpdir(), 'ahpd-checkpoint-')).catch(() => undefined);
  if (staging === undefined) return;
  try {
    const env = { GIT_INDEX_FILE: join(staging, 'index') };
    // A checkpoint is this host's, not the person's, so it is signed as this
    // host: `commit-tree` refuses to run where no identity is configured.
    const author = {
      GIT_AUTHOR_NAME: 'ahpd', GIT_AUTHOR_EMAIL: 'ahpd@localhost',
      GIT_COMMITTER_NAME: 'ahpd', GIT_COMMITTER_EMAIL: 'ahpd@localhost',
    };
    // A directory that is not a repository fails at the first command, and
    // that is the answer rather than a problem: it has no trees to write.
    if (await git(dir, ['add', '-A'], env) === undefined) return;
    const tree = (await git(dir, ['write-tree'], env))?.trim();
    if (tree === undefined || tree === '') return;
    const commit = (await git(dir, ['commit-tree', tree, '-m', `checkpoint: turn ${turn}`], { ...env, ...author }))?.trim();
    if (commit === undefined || commit === '') return;
    await git(dir, ['update-ref', refFor(session, turn), commit]);
  }
  catch {
    // A temporary directory this process may not make is the one failure that
    // reaches here, and a session without a checkpoint is still a session.
  }
  finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** The commit a session's baseline is, or nothing where it has none. */
export const baselineOf = async (dir: string, session: string): Promise<string | undefined> => {
  const said = await git(dir, ['rev-parse', '--verify', '--quiet', refFor(session, BASELINE_TURN)]);
  const sha = said?.trim();
  return sha === undefined || sha === '' ? undefined : sha;
};

/**
 * The tree as the session found it, written once.
 *
 * The baseline is what a session's changes are a difference from, so it is the
 * first capture of a session and every later one leaves it alone: a session
 * started again finds the ref already there, and the tree it began from is the
 * one that is kept.
 */
export const captureBaseline = async (dir: string, session: string): Promise<void> => {
  await inOrder(`${dir}\u0000${session}`, async () => {
    if (await baselineOf(dir, session) !== undefined) return;
    await writeTree(dir, session, BASELINE_TURN);
  });
};

/**
 * A finished turn's tree, under the ref of that turn.
 *
 * Nothing where the session has no baseline: a turn is a difference from
 * something, and the baseline is what it is a difference from. A turn the
 * backend named with nothing at all is no ref to write.
 */
export const captureTurn = async (dir: string, session: string, turn: string): Promise<void> => {
  if (turn === '') return;
  await inOrder(`${dir}\u0000${session}`, async () => {
    if (await baselineOf(dir, session) === undefined) return;
    await writeTree(dir, session, turn);
  });
};

/** Which of two refs of one session is the later turn, as a sort wants it. */
const byTurn = (one: string, other: string): number => {
  const [mine, theirs] = [one.slice(one.lastIndexOf('/') + 1), other.slice(other.lastIndexOf('/') + 1)];
  const [mine_, theirs_] = [Number(mine), Number(theirs)];
  // Two turns of one session in one second, where the numbers are the only
  // thing that tells them apart; a backend that names turns its own way is
  // ordered by the name it gave.
  return Number.isInteger(mine_) && Number.isInteger(theirs_)
    ? mine_ - theirs_
    : mine.localeCompare(theirs);
};

/**
 * The newest checkpoint a session has, which is its baseline until a turn has
 * ended.
 *
 * Ordered by the commit's own date, because a turn is named by the backend and
 * this host has no other order to put two of them in - so the refs are read
 * whole rather than asked for by number.
 */
export const latestOf = async (dir: string, session: string): Promise<string | undefined> => {
  const said = await git(dir, ['for-each-ref', '--format=%(committerdate:unix) %(refname)', refsOf(session)]);
  if (said === undefined) return undefined;
  const found = said.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const at = line.indexOf(' ');
      return { at: Number(line.slice(0, at)), ref: line.slice(at + 1) };
    })
    .sort((one, other) => other.at - one.at || byTurn(other.ref, one.ref));
  const newest = found[0];
  if (newest === undefined) return undefined;
  const sha = (await git(dir, ['rev-parse', '--verify', '--quiet', newest.ref]))?.trim();
  return sha === undefined || sha === '' ? undefined : sha;
};

/**
 * Every ref a session left, gone.
 *
 * The commits themselves go when git next collects them, which it will: no ref
 * points at them once these do not. The refs are the session's own namespace
 * under `refs/agents/`, so nothing anybody else wrote is in what is read here.
 */
export const removeAll = async (dir: string, session: string): Promise<void> => {
  const said = await git(dir, ['for-each-ref', '--format=%(refname)', refsOf(session)]);
  if (said === undefined) return;
  for (const ref of said.split('\n').map((line) => line.trim()).filter((line) => line !== '')) {
    await git(dir, ['update-ref', '-d', ref]);
  }
};

/**
 * One checkpoint, as a host asks for it: the baseline under `0`, and a turn
 * under its own name.
 */
export const capture = async (dir: string, session: string, turn: string): Promise<void> => {
  if (turn === BASELINE_TURN) await captureBaseline(dir, session);
  else await captureTurn(dir, session, turn);
};
