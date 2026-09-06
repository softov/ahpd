/** The two `SessionStore` implementations: one that forgets, one that does not. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionStore } from './types/sessions.js';

/**
 * What a host keeps about its sessions, for as long as the process runs.
 *
 * The default, and the right one for a host embedded in something that has its
 * own place to put this, or for a test. Everything in a `Map`, so a restart
 * returns every archived session to the catalogue and marks every read one
 * unread - which is a real answer for a host that was never meant to outlive
 * the thing that started it, and the wrong one for a daemon.
 */
export function memorySessions(): SessionStore {
  const flags = new Map<string, number>();
  const config = new Map<string, Record<string, unknown>>();
  return {
    flags: (id) => flags.get(id) ?? 0,
    setFlags: (id, value) => { flags.set(id, value); },
    config: (id) => config.get(id),
    setConfig: (id, values) => { config.set(id, values); },
    forget: (id) => { flags.delete(id); config.delete(id); },
  };
}

export interface FileSessionOptions {
  /**
   * Where to keep it.
   *
   * A path rather than a directory, and the caller's decision rather than this
   * module's: where a daemon's state belongs is a daemon's question, and a
   * library that reached for `$XDG_STATE_HOME` would be answering it for a
   * host embedded in an editor too.
   */
  file: string;
  /** Somewhere to say that it could not be read or written. */
  onProblem?(message: string): void;
}

/** What is persisted. Versioned, so a later shape can be recognised rather than guessed at. */
interface Saved {
  version: 1;
  sessions: { id: string; flags?: number; config?: Record<string, unknown> }[];
}

/**
 * The same store, written down.
 *
 * Composed on `memorySessions` rather than reimplemented, so there is one
 * answer to what a flag is and this file is only the reading and the writing.
 *
 * **Read once, at construction, and synchronously.** Every reader of this is
 * synchronous - a catalogue of a hundred rows asks a hundred times while
 * answering one request - so there is no point at which an async load could
 * have finished before the first question. A daemon reads one small file at
 * startup and never again.
 *
 * **Written after the change, not during it.** A write is a rename over the
 * old file, and doing that inside every `setFlags` would put a `fsync` in the
 * path of somebody moving the highlight down a list. Coalesced onto the next
 * tick instead: many changes in one turn become one file.
 *
 * A file that cannot be read is a warning and an empty store, never a refusal.
 * Losing which sessions were archived is worth saying out loud; refusing to
 * start a daemon over it is not.
 */
export function fileSessions(options: FileSessionOptions): SessionStore {
  const inner = memorySessions();
  const file = options.file;
  const told = (message: string): void => { options.onProblem?.(message); };
  /** Every id this store has heard of, because the port has no way to list them. */
  const known = new Set<string>();
  let writing: ReturnType<typeof setTimeout> | undefined;

  const save = (): void => {
    const held: Saved = {
      version: 1,
      sessions: [...known].map((id) => {
        const flags = inner.flags(id);
        const config = inner.config(id);
        return {
          id,
          ...(flags === 0 ? {} : { flags }),
          ...(config === undefined ? {} : { config }),
        };
      // A row with neither is a session somebody looked at and left alone,
      // which is nothing to remember.
      }).filter((row) => row.flags !== undefined || row.config !== undefined),
    };
    try {
      mkdirSync(dirname(file), { recursive: true });
      // Written beside and moved into place, so a daemon killed mid-write
      // leaves the last good file rather than half of this one.
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, file);
    }
    catch (error) {
      told(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const later = (): void => {
    if (writing !== undefined) return;
    writing = setTimeout(() => { writing = undefined; save(); }, 0);
    // A daemon should not be held open by a pending write of a bit somebody
    // toggled a moment before quitting.
    writing.unref?.();
  };

  const load = (): void => {
    let text: string;
    try { text = readFileSync(file, 'utf8'); }
    // Not there yet, which is what a first run looks like.
    catch { return; }
    let read: unknown;
    try { read = JSON.parse(text); }
    catch (error) {
      told(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const saved = read as Partial<Saved>;
    if (saved.version !== 1 || !Array.isArray(saved.sessions)) {
      told(`Ignoring ${file}: it is not a session store this version can read.`);
      return;
    }
    for (const row of saved.sessions) {
      if (typeof row?.id !== 'string' || row.id === '') continue;
      known.add(row.id);
      if (typeof row.flags === 'number') inner.setFlags(row.id, row.flags);
      if (typeof row.config === 'object' && row.config !== null) inner.setConfig(row.id, row.config);
    }
  };

  load();

  return {
    flags: (id) => inner.flags(id),
    config: (id) => inner.config(id),
    setFlags: (id, value) => { known.add(id); inner.setFlags(id, value); later(); },
    setConfig: (id, values) => { known.add(id); inner.setConfig(id, values); later(); },
    forget: (id) => { known.delete(id); inner.forget(id); later(); },
  };
}
