/**
 * The sessions this backend can list, from two places at once.
 *
 * pi writes every conversation to a file of its own, so a catalogue row can
 * exist for a session this daemon never ran - one somebody had from the `pi`
 * command in the same directory. Those are read from disk. On top of them sit
 * the sessions this process is watching, whose turns are read back from what
 * it watched rather than rebuilt from the file.
 *
 * The registry is process-wide rather than per session, because it has to
 * outlive any one of them: a client asks for a transcript after the session
 * that produced it was closed.
 */

import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Listed } from '@ahpd/sdk';
import { loadedPi, loadPi } from './pi.js';
import type { PiOptions, WatchedSession } from './types.js';

/** What this process watched, by provider and then by pi's own id. */
const watched = new Map<string, Map<string, WatchedSession>>();

/** Record a session this process is running, and answer with the record. */
export function watch(provider: string, session: WatchedSession): WatchedSession {
  let held = watched.get(provider);
  if (held === undefined) {
    held = new Map();
    watched.set(provider, held);
  }
  held.set(session.id, session);
  return session;
}

/** What this process watched of one session, or nothing for one it never opened. */
export function watchedSession(provider: string, id: string): WatchedSession | undefined {
  return watched.get(provider)?.get(id);
}

/** Forget a provider's records, or every provider's. */
export function forget(provider?: string): void {
  if (provider === undefined) watched.clear();
  else watched.delete(provider);
}

/** Forget one session's record, leaving the rest of its provider's alone. */
export function forgotten(provider: string, id: string): void {
  watched.get(provider)?.delete(id);
}

/**
 * Where pi keeps this session's file.
 *
 * What the reference window's "open session state file" opens. pi writes one
 * per conversation, so this is a real answer rather than the nothing a backend
 * without a record has to give.
 *
 * Synchronous, as `Agent.stateFile` is, so it answers from pi only once pi has
 * loaded, and nothing before that, as for a session with no file.
 */
export function stateFile(options: PiOptions, id: string, directory: string): string | undefined {
  const pi = loadedPi();
  if (pi === undefined) return undefined;
  try { return pi.SessionManager.findById(directory, id, options.sessionDir); }
  // A directory pi has never been run in has no session store, which is not a
  // failure worth raising: the honest answer is that there is no such file.
  catch { return undefined; }
}

/**
 * Where pi keeps this session's file, and whether it is one of pi's.
 *
 * The same lookup `stateFile` does, read for the delete rather than for the
 * window: the second half is what keeps a delete a delete of a *session*
 * rather than of whatever path an id worked out to be.
 */
const fileOf = (options: PiOptions, id: string, directory: string): { file: string; mine: boolean } | undefined => {
  const pi = loadedPi();
  if (pi === undefined) return undefined;
  let file: string | undefined;
  try { file = pi.SessionManager.findById(directory, id, options.sessionDir); }
  // A directory pi has never been run in has no session store, which is not a
  // failure worth raising: there is no such file, so there is nothing to
  // delete.
  catch { return undefined; }
  if (file === undefined) return undefined;
  /*
   * Whether the file is one of pi's.
   *
   * The lookup builds the path out of pi's own directory and an id, so it
   * should always answer inside it - and an answer that is not is the one case
   * `rm` would take a client's word for something it did not check. The answer
   * is checked rather than assumed, because the caller named a session and a
   * session is a file under pi's store, not a path.
   *
   * With no configured store the root is pi's own `sessions` directory under its
   * agent directory, which is where a per-project folder of files lives. pi
   * names that directory itself but does not export it, and the two answers it
   * publishes - the agent directory - spell it the same way it does.
   */
  const root = options.sessionDir ?? join(pi.getAgentDir(), 'sessions');
  const at = relative(resolve(root), resolve(file));
  return { file, mine: at !== '' && !at.startsWith('..') && !isAbsolute(at) };
};

/**
 * Delete a session's own file, and this process's record of it.
 *
 * pi 0.87.1's `SessionManager` writes one file per conversation and has no
 * delete of its own, so the file is what a delete is. `directory` is where
 * the session ran, which is what tells pi which project's folder holds it.
 *
 * The record goes with the file, and it has to: `catalogue` lists what this
 * process watched over what is on disk, so a session whose file was removed
 * but whose record was kept is listed again by the next read - which is the
 * exact shape of the bug this closes.
 *
 * No file is deleted. A session deleted twice is deleted, and a row this
 * daemon only listed for a project pi has no store for is not a failure worth
 * raising.
 *
 * A path outside pi's own session directory is refused, because the caller
 * named a session and a session is a file under pi's store.
 *
 * `node:fs/promises` is imported here rather than at the top of the file, for
 * the same reason pi is: this module is on the path of a plugin that has to
 * apply without waiting for anything, and a delete is asked for once in a while
 * rather than on every read.
 */
export async function forgetSession(
  options: PiOptions,
  provider: string,
  id: string,
  directory: string | undefined,
): Promise<void> {
  const found = directory === undefined ? undefined : fileOf(options, id, directory);
  if (found?.mine === true) {
    const { rm } = await import('node:fs/promises');
    await rm(found.file, { force: true });
  }
  else if (found !== undefined)
    throw new Error(`${found.file} is not one of pi's own session files, so it was not deleted`);
  forgotten(provider, id);
}

/**
 * Every session in the directories this host serves, newest last.
 *
 * pi lists by directory, so each is asked and the answers are merged. A
 * directory it has never run in answers nothing rather than throwing, and one
 * that fails to read costs its own rows rather than the whole catalogue: a
 * listing that disappears because one project's store is unreadable is worse
 * than one that is short.
 */
export async function catalogue(
  options: PiOptions,
  provider: string,
  directories: readonly string[],
): Promise<Listed[]> {
  const rows = new Map<string, Listed>();
  const { SessionManager } = await loadPi();

  for (const directory of directories) {
    let found;
    try { found = await SessionManager.list(directory, options.sessionDir); }
    catch { continue; }
    for (const one of found) {
      rows.set(one.id, {
        id: one.id,
        title: one.name ?? firstLine(one.firstMessage),
        createdAt: one.created.toISOString(),
        modifiedAt: one.modified.toISOString(),
        workingDirectories: [`file://${one.cwd === '' ? directory : one.cwd}`],
      });
    }
  }

  // What this process is running wins over what is on disk: it has the title
  // a client just set and a modification time the file has not been given yet.
  for (const one of watched.get(provider)?.values() ?? []) {
    rows.set(one.id, {
      id: one.id,
      title: one.title,
      createdAt: one.createdAt,
      modifiedAt: one.modifiedAt,
      workingDirectories: [`file://${one.directory}`],
    });
  }

  return [...rows.values()].sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
}

/** The first line of a message, as a title for a conversation nobody named. */
function firstLine(text: string): string {
  const line = text.split('\n').map((one) => one.trim()).find((one) => one !== '') ?? '';
  return line === '' ? 'pi session' : line.slice(0, 80);
}
