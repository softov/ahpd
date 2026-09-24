/**
 * The sessions this backend can list, from two places at once.
 *
 * pi writes every conversation to a file of its own, so a catalogue row can
 * exist for a session this daemon never ran - one somebody had from the `pi`
 * command in the same directory. Those are read from disk. On top of them sit
 * the sessions this process is watching, which are the only ones with turns
 * anybody here can read back.
 *
 * The registry is process-wide rather than per session, because it has to
 * outlive any one of them: a client asks for a transcript after the session
 * that produced it was closed.
 */

import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Listed } from '@ahpd/sdk';
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

/** Forget a provider's records. For a test, so one does not leak into the next. */
export function forget(provider?: string): void {
  if (provider === undefined) watched.clear();
  else watched.delete(provider);
}

/**
 * Where pi keeps this session's file.
 *
 * What the reference window's "open session state file" opens. pi writes one
 * per conversation, so this is a real answer rather than the nothing a backend
 * without a record has to give.
 */
export function stateFile(options: PiOptions, id: string, directory: string): string | undefined {
  try { return SessionManager.findById(directory, id, options.sessionDir); }
  // A directory pi has never been run in has no session store, which is not a
  // failure worth raising: the honest answer is that there is no such file.
  catch { return undefined; }
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
