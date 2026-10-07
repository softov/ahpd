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

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FileEntry } from '@earendil-works/pi-coding-agent';
import { uriOf } from '@ahpd/sdk';
import type { Bag, Listed } from '@ahpd/sdk';
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
 * One session this process watched, as a row.
 *
 * What this process is running wins over what is on disk: it has the title a
 * client just set and a modification time the file has not been given yet. The
 * one mapping, so a row a listing answers and a row `find` answers for the same
 * watched session are the same row.
 */
const watchedRow = (one: WatchedSession): Listed => ({
  id: one.id,
  title: one.title,
  createdAt: one.createdAt,
  modifiedAt: one.modifiedAt,
  workingDirectories: [uriOf(one.directory)],
});

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
        workingDirectories: [uriOf(one.cwd === '' ? directory : one.cwd)],
      });
    }
  }

  // What this process is running wins over what is on disk: it has the title
  // a client just set and a modification time the file has not been given yet.
  for (const one of watched.get(provider)?.values() ?? [])
    rows.set(one.id, watchedRow(one));

  return [...rows.values()].sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
}

/** The words of a message's content, which pi keeps as a string or as parts. */
function wordsOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((one): one is { type: 'text'; text: string } =>
      typeof one === 'object' && one !== null && (one as Bag).type === 'text' && typeof (one as Bag).text === 'string')
    .map((one) => one.text)
    // Joined with a space, as pi joins them when it builds the same row.
    .join(' ');
}

/**
 * One session's row, read from the entries of the file pi keeps it in.
 *
 * pi derives a listing's title and times in `buildSessionInfo`, which it does
 * not export, so the same entries are walked here and the same fields derived
 * the same way. `list` and `find` answering different rows for one session is a
 * client sent a `root/sessionSummaryChanged` for a row that did not change,
 * which is why the two are held equal by a test rather than described.
 *
 * The entries are what `parseSessionEntries` made of the file's lines, which is
 * the parse pi's own listing streams a file through. Reading them here rather
 * than through `SessionManager.open` is the point: an open creates a session
 * for a file that is not there, empties one it cannot make sense of and
 * migrates an older one, so it writes to a session to answer a question about
 * it. Nothing on this path writes.
 *
 * The header is what says whose session a file holds, so a file whose header is
 * not the id asked for answers nothing - a lookup that matched a moment ago and
 * a file that changed under it is a read that found nothing rather than one
 * that found somebody else's row.
 *
 * A file with no header, or with a header no date can be made of, is a file pi
 * itself never wrote: pi's listing falls back to the file's own modification
 * time there, which is not read here, so the row is nothing.
 */
function rowOfFile(entries: readonly FileEntry[], directory: string, id: string): Listed | undefined {
  const header = entries[0];
  if (header === undefined || header.type !== 'session' || header.id !== id) return undefined;
  const created = new Date(header.timestamp);
  const headerTime = created.getTime();
  if (!Number.isFinite(headerTime)) return undefined;

  let name: string | undefined;
  let words = '';
  let lastActivity: number | undefined;
  for (const entry of entries) {
    // The latest `session_info` wins, a clear included, as pi reads it.
    if (entry.type === 'session_info') { name = entry.name?.trim() || undefined; continue; }
    if (entry.type !== 'message') continue;
    const message = entry.message as unknown as Bag;
    if (typeof message.role !== 'string' || !('content' in message)) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const at = typeof message.timestamp === 'number' ? message.timestamp : Date.parse(entry.timestamp);
    if (Number.isFinite(at)) lastActivity = Math.max(lastActivity ?? 0, at);
    if (words === '' && message.role === 'user') {
      const text = wordsOf(message.content);
      if (text !== '') words = text;
    }
  }

  const cwd = typeof header.cwd === 'string' ? header.cwd : '';
  return {
    id: header.id,
    // `(no messages)` is what pi titles a session nobody said anything in, and
    // the title is what pi itself would have called this row.
    title: name ?? firstLine(words === '' ? '(no messages)' : words),
    createdAt: created.toISOString(),
    modifiedAt: (lastActivity !== undefined && lastActivity > 0 ? new Date(lastActivity) : created).toISOString(),
    workingDirectories: [uriOf(cwd === '' ? directory : cwd)],
  };
}

/**
 * One session's own row, read without listing the project folder it is in.
 *
 * What a client opening a row the host does not hold costs without this: a link
 * from another machine, a session written to disk after the last listing -
 * `list` reads every transcript in the directory for one id. The file is the
 * one pi's own `findById` names, and `SessionManager.list` is never called.
 *
 * A session this process is watching is answered from its record, which is the
 * row a listing would have answered for it and needs no file read at all.
 *
 * Nothing is written: the file is read as it lies, so a lookup that named a
 * file since removed, emptied or migrated leaves it exactly as it was, and a
 * file that turns out not to hold this id answers nothing.
 */
export async function findSession(
  options: PiOptions,
  provider: string,
  id: string,
  directories: readonly string[],
): Promise<Listed | undefined> {
  const watching = watchedSession(provider, id);
  if (watching !== undefined) return watchedRow(watching);
  const { SessionManager, parseSessionEntries } = await loadPi();
  for (const directory of directories) {
    let file: string | undefined;
    // A directory pi has never been run in has no session store, which is the
    // same nothing as one that does not have this session. With no
    // `sessionDir`, pi's lookup makes its default folder for the directory, as
    // `list` does; the session file itself is never written.
    try { file = SessionManager.findById(directory, id, options.sessionDir); }
    catch { continue; }
    if (file === undefined) continue;
    let content: string;
    // A file gone since the lookup is a failed read rather than an empty
    // session, as `replayed` answers it - and reading it is only a read, where
    // pi's own open would put a file back for the id it was named. Another
    // directory's store may still hold it.
    try { content = readFileSync(file, 'utf8'); }
    catch { continue; }
    // A file that holds somebody else's session is not this directory's answer,
    // so the remaining directories are still worth a look.
    const row = rowOfFile(parseSessionEntries(content), directory, id);
    if (row !== undefined) return row;
  }
  return undefined;
}

/** The first line of a message, as a title for a conversation nobody named. */
function firstLine(text: string): string {
  const line = text.split('\n').map((one) => one.trim()).find((one) => one !== '') ?? '';
  return line === '' ? 'pi session' : line.slice(0, 80);
}
