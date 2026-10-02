/**
 * The traffic log `--wire` writes, in the shape VS Code's agent host writes it.
 *
 * VS Code's host logs every frame in its transport: the JSON-RPC message at the
 * root of the line, and a `_ahpLog` beside it carrying what the protocol has no
 * field for - when the frame went, which way, which connection, how long it
 * was. Tools built for that read that shape, so this writes it. The decision
 * is `the-traffic-log-is-the-wire-capture-in-vs-codes-shape`.
 *
 * One file for every connection, as `--wire` names a file and not a folder,
 * with `connectionId` telling them apart.
 */

import { appendFileSync, chmodSync, existsSync, renameSync, writeFileSync } from 'node:fs';

/** Which way a frame went: from the client, or back to it. */
export type Direction = 'c2s' | 's2c';

/** What sits beside a message, field for field with VS Code's `_ahpLog`. */
export interface AhpLog {
  /** When the frame crossed the socket. */
  ts: string;
  dir: Direction;
  /** The connection it crossed, which is the tap's own numbering. */
  connectionId: string;
  transport: string;
  /** The frame as it went over, so a line cut short says what it cost. */
  byteLength: number;
  /** Set when the line was too long to write whole and its strings were cut. */
  truncated?: boolean;
}

/** One line of a capture: the message, and the meta beside it. */
export type Capture = { _ahpLog: AhpLog } & Record<string, unknown>;

/**
 * The line one frame is written down as.
 *
 * The message at the root where the frame is one, which is what a reader of
 * VS Code's capture opens a line expecting to find. A frame that is not a
 * message - text that did not parse, a bare number, an array - is kept whole
 * under `_raw` instead, because a client that sent one is exactly what a
 * capture is for, and the line has to stay a line of JSON either way.
 *
 * `transport` is passed rather than read, because a tap is called the same way
 * over both transports and only the run knows which one it is serving.
 */
export const lineFor = (from: 'client' | 'host', text: string, peer: number, transport: string): Capture => {
  const _ahpLog: AhpLog = {
    ts: new Date().toISOString(),
    dir: from === 'client' ? 'c2s' : 's2c',
    connectionId: String(peer),
    transport,
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
  let message: unknown;
  try { message = JSON.parse(text); } catch { message = undefined; }
  if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
    return { ...(message as Record<string, unknown>), _ahpLog };
  }
  return { _raw: text, _ahpLog };
};

/** The size a capture file may reach before the writer rolls it aside. */
const MAX_FILE_SIZE_BYTES = 75 * 1024 * 1024;

/** How many files a capture keeps: the one being written and the four before it. */
const MAX_FILES = 5;

/** The longest a line may be before it is written again with its strings cut. */
const MAX_LINE_LENGTH = 1024 * 1024;

/** How much of one string survives that second write. */
const MAX_STRING_LENGTH = 16 * 1024;

/**
 * The mode every file of a capture is made at and left at: `0600`.
 *
 * A capture holds every token a client sent in `authenticate`, so it belongs
 * to the person running the daemon and to nobody else - and the one thing it
 * is allowed to be is readable. The process umask decides what a file created
 * without a mode gets, and that is not this decision to leave to it.
 */
const OWNER_ONLY = 0o600;

/**
 * VS Code's caps, which a test lowers so a roll happens in a few bytes.
 *
 * `maxFiles` is not one of them: five is what the shape promises whoever reads
 * the capture, and a test that needs six rolls can have them at any size.
 */
export interface WriterOptions {
  maxFileSizeBytes?: number;
  maxLineLength?: number;
}

/**
 * Every file of a capture, oldest first, and then the one being written.
 *
 * A collected capture that stops at the last roll is missing its start, so
 * `diagnostics.logs` names all of them. Only the ones that are there are named:
 * the writer rolls lazily, and a daemon that has never filled a file has no
 * `.3` to hand anybody.
 */
export const filesOf = (at: string): string[] => {
  const rolled: string[] = [];
  for (let older = 1; older < MAX_FILES; older++) {
    if (existsSync(`${at}.${String(older)}`)) rolled.unshift(`${at}.${String(older)}`);
  }
  return [...rolled, at];
};

/**
 * The one function a tap hands each line to.
 *
 * Serialises, and cuts a line that has outgrown the cap; appends, and rolls a
 * file that has outgrown its cap. Both caps are VS Code's, and both are here
 * for the same reason it has them: a single `resourceRead` carrying a whole
 * file would otherwise be one line nobody can open, and a capture with no bound
 * eventually stops the daemon writing the thing it was capturing.
 *
 * The line is cut rather than dropped, so the capture stays JSONL and the cut
 * is visible - `_ahpLog.truncated` says the payload is not all there.
 *
 * The size is counted here rather than read back, because this is the only
 * thing that appends to a file it created and a `stat` per frame is a cost the
 * socket path should not pay. Bytes for the file, characters for the line, as
 * VS Code counts them.
 */
export const writerFor = (at: string, options: WriterOptions = {}): ((line: Capture) => void) => {
  const maxFileSize = options.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES;
  const maxLineLength = options.maxLineLength ?? MAX_LINE_LENGTH;
  let size = 0;
  /**
   * Make `<at>` the file this run appends to: empty, and owner-only.
   *
   * The mode is set twice because a mode on create says nothing about a file
   * that was already there, and a capture left at whatever a previous run or a
   * umask gave it is a capture of somebody's tokens at the wrong mode. After a
   * roll the file is not there at all, so it is made rather than trimmed.
   */
  const start = (): void => {
    writeFileSync(at, '', { mode: OWNER_ONLY });
    chmodSync(at, OWNER_ONLY);
    size = 0;
  };
  start();

  return (line) => {
    let body = JSON.stringify(line);
    if (body.length > maxLineLength) {
      line._ahpLog.truncated = true;
      body = JSON.stringify(line, (_key, value: unknown) =>
        typeof value === 'string' && value.length > MAX_STRING_LENGTH
          ? `${value.slice(0, MAX_STRING_LENGTH)}…[${String(value.length - MAX_STRING_LENGTH)} more chars elided]`
          : value);
    }
    const bytes = Buffer.byteLength(body) + 1;
    // An empty file is never rolled, or the first frame of a capture over a
    // very small cap would be a file that is then thrown away unread.
    if (size > 0 && size + bytes > maxFileSize) {
      // From the oldest down, so nothing is renamed onto a file still to come.
      for (let older = MAX_FILES - 2; older >= 0; older--) {
        try { renameSync(`${at}${older === 0 ? '' : `.${String(older)}`}`, `${at}.${String(older + 1)}`); }
        catch { /* that one was never written */ }
      }
      start();
    }
    appendFileSync(at, `${body}\n`);
    size += bytes;
  };
};
