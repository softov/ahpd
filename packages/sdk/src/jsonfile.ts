/**
 * One JSON file, read and written the way every store here reads and writes one.
 *
 * The write is the one shape a whole-file store has: make the folder, write the
 * value beside the file at a mode only its owner may read, and rename it into
 * place, so a process killed mid-write leaves the last good file rather than
 * half of this one.
 *
 * The read answers which of its outcomes it was and hands back what it was
 * given. It words nothing, because the callers owe one outcome different
 * sentences - a file that is not there is a first run to the policies and a
 * vault holding nothing yet to the vault - and one of them owes it no sentence
 * from here at all.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isRecord } from './values.js';

/**
 * What a read answered: the value, or why there is none.
 *
 * An outcome rather than a sentence, on purpose. Two callers owe the same
 * outcome different words - a file that is not there is a first run to the
 * policies and a vault holding nothing yet to the vault - and one of them owes
 * it no words that come from here at all: the vault's refusals reach a problem
 * line, a log and a terminal, and the parser's message quotes the source it
 * choked on, which in that file is the secret it was holding. So the raw error
 * travels with the outcome and a caller that may say it does.
 */
export type JsonRead<T = unknown> =
  | { ok: true; value: T }
  /** Nothing is there at all, which for most callers is where a host starts. The error is Node's own. */
  | { ok: false; kind: 'missing'; error: unknown }
  /** It is there and could not be opened. The code is the errno name, and nothing else is safe to repeat. */
  | { ok: false; kind: 'unreadable'; code: string | undefined; error: unknown }
  /** It was opened and is not JSON. The error is the parser's, and it quotes what it choked on. */
  | { ok: false; kind: 'not-json'; error: unknown };

/** The same, for a file that has to hold an object: a list, a `null` or a leaf is its own outcome. */
export type JsonObjectRead =
  | JsonRead<Record<string, unknown>>
  | { ok: false; kind: 'not-object' };

/**
 * Read one file as JSON, saying which of the three failures it was.
 *
 * The text is read whole and parsed, so a file that is not there, one that
 * cannot be opened and one that is not JSON are told apart rather than all
 * being an empty answer - and an empty file is `not-json`, because the caller
 * that treats it as a host nobody has set up is the one that knows to.
 */
export function readJson(file: string): JsonRead {
  let text: string;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, kind: 'missing', error };
    return { ok: false, kind: 'unreadable', code, error };
  }
  try { return { ok: true, value: JSON.parse(text) as unknown }; }
  catch (error) { return { ok: false, kind: 'not-json', error }; }
}

/** The same, with a value that is not a plain object refused rather than handed to a caller to re-check. */
export function readJsonObject(file: string): JsonObjectRead {
  const outcome = readJson(file);
  if (!outcome.ok) return outcome;
  const value = outcome.value;
  if (!isRecord(value)) return { ok: false, kind: 'not-object' };
  return { ok: true, value };
}

export interface JsonWriteOptions {
  /**
   * What the file is created at, and so what it is left at.
   *
   * `0o600` unless a caller says otherwise: almost everything written this way
   * names who may use what, or holds a credential, and 0644 gives either to
   * every account on the machine.
   */
  mode?: number;
  /** What a folder this makes is created at, where the caller has one to name. The umask's mode otherwise. */
  dirMode?: number;
}

/**
 * Write `value` as the whole file, beside it and renamed over it.
 *
 * Written whole and moved into place, so a process killed mid-write leaves the
 * last good file rather than half of this one. The scratch is named by this
 * process's pid, which is what says whether the process that left one is still
 * there - the daemon's sweeper reads `/^(.+)\.(\d+)\.tmp$/` and knows no other
 * form.
 *
 * The folder is made first, always: a writer here is the thing that knows where
 * its file belongs, and a caller that had to remember would be a caller that
 * could forget. A failure throws, because what a file could not be written for
 * is a sentence only the caller has.
 */
export function writeJsonAtomic(file: string, value: unknown, options: JsonWriteOptions = {}): void {
  const { mode = 0o600, dirMode } = options;
  mkdirSync(dirname(file), { recursive: true, ...(dirMode === undefined ? {} : { mode: dirMode }) });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  // Removed before it is written, because `mode` is applied when a file is
  // *created* and not when one is opened: a temp this pid left readable - one
  // of ours killed between the write and the rename, and this process given its
  // pid back - would keep its 0644, and the rename would put that on the file.
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, file);
}
