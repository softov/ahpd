import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import { SNAPSHOT_TAG as TAG } from '../attachments.js';
import { localPath, uriOf } from '../fileuri.js';
import { ROOT } from './channels.js';
import type { Bag } from '../types/common.js';
import type { Connection } from '../types/host.js';
import type { SessionStore } from '../types/sessions.js';

/**
 * A message's attachments, with the ones that are bytes written to files.
 *
 * A client pastes a picture and sends the whole of it with the message. Left
 * alone, those bytes are the chat state, the transcript and every copy of it -
 * written once per client that opens the session, and again for every session
 * that reads the message back. So they are written here, once, before the
 * action is applied, and what the message carries from then on is the path to
 * the file: decision
 * `an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file`.
 *
 * Four things are left exactly as the client sent them, each for the same
 * reason - this host cannot make a better one:
 *
 * - an attachment that is neither inline bytes nor a `file:` URI, because
 *   there is nothing here to fetch: a scheme this host does not serve is the
 *   client's, and the client is not the thing that called this.
 * - a `file:` URI this host already has a file for outside the session's own
 *   folder, which is the user's own file and is readable where it stands.
 * - a directory, which has no bytes to write.
 * - anything whose write failed, including a client that did not answer. The
 *   message is then no worse than it would have been without this, and the
 *   line about it is in the log rather than in a refusal, because a message
 *   that arrived is worth more than a picture that did not.
 *
 * What comes back is the message with its attachments settled. The client's
 * own object is returned when nothing changed, so a message with none of these
 * is the one that arrived rather than a copy of it.
 */

/**
 * The largest file a client is asked for, in bytes.
 *
 * The answer arrives as one JSON-RPC message, and this is below what a message
 * may carry: a client-only file larger than this is left where it is rather
 * than asked for, since the ask could not be answered.
 */
const FETCH_LIMIT = 32 * 1024 * 1024;

/** What a content type is written as, so a file's own name says what it is. */
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'text/html': '.html',
};

/**
 * The messages already settled, so a message is settled once.
 *
 * A settled message is applied by handing it back to the host as this
 * connection's own dispatch, and the second pass over it is not a second
 * message: the attachment this host wrote is named by a tagged `resource`
 * that `needsWriting` says no to, and the one it left as sent would be looked
 * for on disk all over again.
 */
const handled = new WeakSet<object>();

/**
 * Whether a message has an attachment still to be written or tagged.
 *
 * Asked before a dispatch is applied, and the answer is what decides whether
 * the action is applied in the tick it arrived in or waits for a file. Every
 * message with no attachments answers no, which is the ordinary case and the
 * one that keeps the actions of a turn in the order they were written in.
 */
export function needsWriting(message: unknown, store: SessionStore, id: string): boolean {
  if (store.attachmentsDir?.(id) === undefined) return false;
  const one = (typeof message === 'object' && message !== null ? message : {}) as Bag;
  if (handled.has(one) || !Array.isArray(one.attachments)) return false;
  return (one.attachments as unknown[]).some(wouldWrite);
}

/** Whether one attachment is one this host would write a file for. */
function wouldWrite(value: unknown): boolean {
  const one = (typeof value === 'object' && value !== null ? value : {}) as Bag;
  if (one.type === 'embeddedResource') return true;
  if (one.type !== 'resource') return false;
  return typeof one.uri === 'string' && one.uri.startsWith('file://') && !heldSnapshot(one);
}

/**
 * The files a settled message names under the session's own folder.
 *
 * What a machine is given, so the path a message was handed is a file in there
 * too - decision `a-session-in-a-machine-gets-each-attachment-copied-into-it`.
 * Only the folder's own files: an attachment this host left as it came names
 * somebody else's file on this host, which is not this host's to copy into a
 * machine. Read off the message rather than remembered from the writing,
 * because a client that sends a settled attachment back names a file too.
 */
export function filesOf(message: unknown, dir: string): string[] {
  const one = (typeof message === 'object' && message !== null ? message : {}) as Bag;
  if (!Array.isArray(one.attachments)) return [];
  return (one.attachments as unknown[]).flatMap((held) => {
    const attachment = (typeof held === 'object' && held !== null ? held : {}) as Bag;
    if (attachment.type !== 'resource' || typeof attachment.uri !== 'string') return [];
    const path = localPath(attachment.uri);
    return inside(dir, path) ? [path] : [];
  });
}

/** What one message needs from the host. */
export interface SnapshotAsked {
  /** The message as the client sent it. */
  message: Record<string, unknown>;
  /** The session's own id, which is what the store knows it by. */
  id: string;
  /** The store, which is the one place that knows where the folder is. */
  store: SessionStore;
  /** The connection the message arrived on, and the only reader of a file only it has. */
  connection?: Connection;
  /** Somewhere to say that one attachment was left as it was sent. */
  onProblem?(line: string): void;
}

/** A message's attachments, settled. */
export async function snapshot(asked: SnapshotAsked): Promise<Record<string, unknown>> {
  const { message, connection, store } = asked;
  const dir = store.attachmentsDir?.(asked.id);
  if (dir === undefined || !Array.isArray(message.attachments)) return message;
  const arrived = message.attachments as unknown[];
  if (arrived.length === 0) return message;
  const told = asked.onProblem ?? ((): void => {});
  const settled = await Promise.all(arrived.map((one) => written(one, dir, connection, told)));
  // The ones that could not be settled come back as themselves, so the
  // message that arrived unchanged is the message that goes on.
  if (settled.every((one, at) => one === arrived[at])) {
    handled.add(message);
    return message;
  }
  const rewritten = { ...message, attachments: settled };
  handled.add(rewritten);
  return rewritten;
}

/**
 * One attachment, as the file it names - or as it arrived.
 *
 * `value` is returned itself whenever nothing was written or tagged, which is
 * what tells `snapshot` whether the message moved at all.
 */
async function written(
  value: unknown,
  dir: string,
  connection: Connection | undefined,
  told: (line: string) => void,
): Promise<unknown> {
  const one = (typeof value === 'object' && value !== null ? value : {}) as Bag;
  try {
    if (one.type === 'embeddedResource') {
      const contentType = typeOf(one.contentType);
      const bytes = Buffer.from(typeof one.data === 'string' ? one.data : '', 'base64');
      const path = await put(dir, labelOf(one), contentType, bytes);
      return tagged(value, one, path, bytes.length, contentType);
    }
    if (one.type !== 'resource') return value;
    const uri = typeof one.uri === 'string' ? one.uri : '';
    // Only a file is a file. Nothing else names something this host could
    // write, and a scheme it does not serve is the client's own business.
    if (!uri.startsWith('file://')) return value;
    const path = localPath(uri);
    const found = await stat(path).catch(() => undefined);
    if (found !== undefined) {
      // A folder this session's own, holding a file this host wrote and a
      // client sent back: the file is already there and only the tag is
      // missing. Anything else is somebody's own file, and stays theirs.
      if (!found.isFile() || !inside(dir, path)) return value;
      return tagged(value, one, path, found.size, typeOf(one.contentType));
    }
    // A file this host has no copy of: the client that sent it is the only
    // thing that can read it, and only where it is small enough to answer
    // with.
    const hinted = typeof one.sizeHint === 'number' ? one.sizeHint : 0;
    if (connection === undefined || hinted > FETCH_LIMIT) return value;
    const contentType = typeOf(one.contentType);
    const bytes = await fromClient(connection, uri);
    const held = await put(dir, labelOf(one), contentType, bytes);
    return tagged(value, one, held, bytes.length, contentType);
  } catch (error) {
    told(`could not write an attachment: ${error instanceof Error ? error.message : String(error)}`);
    return value;
  }
}

/**
 * The attachment, naming the file that holds its bytes.
 *
 * The tag is merged into whatever `_meta` the attachment already carried,
 * because the client that sent it may have put something there that this host
 * knows nothing about.
 */
function tagged(
  value: unknown,
  one: Bag,
  path: string,
  size: number,
  contentType: string,
): unknown {
  const uri = uriOf(path);
  const tag = { isSnapshot: true, contentType };
  const meta = (typeof one._meta === 'object' && one._meta !== null ? one._meta : {}) as Bag;
  const held = (typeof meta[TAG] === 'object' && meta[TAG] !== null ? meta[TAG] : {}) as Bag;
  // Already this file, already tagged: the attachment a client sent back is
  // the one that arrived, and nothing about it moved.
  if (one.type === 'resource' && one.uri === uri && one.contentType === contentType
    && heldSnapshot(one) && held.contentType === contentType) {
    return value;
  }
  return {
    label: labelOf(one),
    ...(one.range === undefined ? {} : { range: one.range }),
    ...(one.displayKind === undefined ? {} : { displayKind: one.displayKind }),
    ...(one.selection === undefined ? {} : { selection: one.selection }),
    type: 'resource',
    uri,
    sizeHint: size,
    contentType,
    _meta: { ...meta, [TAG]: tag },
  };
}

/**
 * The bytes, written read-only under a name of this host's own.
 *
 * The name is this host's rather than the client's: the label is a display
 * string, and a label is not a path. Its basename is kept so a person reading
 * the folder can tell the files apart, the unique prefix is what keeps two
 * pastes of the same name apart, and the extension comes from the content type
 * that the file is actually in.
 */
async function put(dir: string, label: string, contentType: string, bytes: Buffer): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, nameOf(label, contentType));
  await writeFile(path, bytes, { mode: 0o400 });
  return path;
}

/** A file's name: a unique prefix, the label's basename, the type's extension. */
function nameOf(label: string, contentType: string): string {
  const base = safe(label);
  const own = extname(base);
  const wanted = extensionOf(contentType);
  const stem = base.slice(0, base.length - own.length);
  return `${randomUUID().slice(0, 8)}-${stem}${wanted === '' ? own : wanted}`;
}

/** The label as one path segment, and as nothing at all when it is not one. */
function safe(label: string): string {
  const base = basename(label).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return base === '' || base === '.' || base === '..' ? 'attachment' : base;
}

/** The extension a content type is written with, or nothing where none is. */
function extensionOf(contentType: string): string {
  const one = (contentType.toLowerCase().split(';')[0] ?? '').trim();
  const known = EXTENSIONS[one];
  if (known !== undefined) return known;
  if (one.endsWith('+json')) return '.json';
  if (one.endsWith('+xml')) return '.xml';
  return '';
}

/** Whether an attachment carries this host's own snapshot tag already. */
const heldSnapshot = (one: Bag): boolean => {
  const meta = (typeof one._meta === 'object' && one._meta !== null ? one._meta : {}) as Bag;
  const tag = (typeof meta[TAG] === 'object' && meta[TAG] !== null ? meta[TAG] : {}) as Bag;
  return tag.isSnapshot === true;
};

/** A content type, or the one for bytes nobody described. */
const typeOf = (value: unknown): string =>
  (typeof value === 'string' && value !== '' ? value : 'application/octet-stream');

/** What a person called the attachment, or a name for one that has none. */
const labelOf = (one: Bag): string =>
  (typeof one.label === 'string' && one.label !== '' ? one.label : 'attachment');

/** Whether a path is inside a folder, and not merely prefixed by its name. */
const inside = (dir: string, path: string): boolean =>
  path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);

/**
 * One file, read by the client that published it.
 *
 * The client answers base64 for anything that is not text, and says which of
 * the two it sent rather than leaving it to be guessed.
 */
async function fromClient(connection: Connection, uri: string): Promise<Buffer> {
  const answer = await connection.peer.request('resourceRead', { channel: ROOT, uri });
  const held = (typeof answer === 'object' && answer !== null ? answer : {}) as Bag;
  const data = typeof held.data === 'string' ? held.data : '';
  return held.encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
}
