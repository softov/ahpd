import { copyFile, cp, mkdir as makeDir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { RpcError } from './rpc.js';
import type { Entry, Metadata, Read, Write } from './types/resources.js';
import type { ResourceStore } from './types/host.js';

/**
 * The host's filesystem, as far as a client is allowed to see it.
 *
 * Every path is checked against the directories the host was told to serve
 * before anything is opened. A host that answered for any path is one that
 * anybody who can reach the port can read `~/.ssh/id_ed25519` through - and
 * this daemon is meant to be reachable, with a token, from another machine.
 *
 * `node:fs/promises` and `node:path` are used here because all three
 * supported runtimes provide them.
 */

/** `-32008`, which the protocol has for a resource that is not there. */
const NOT_FOUND = -32008;
/** `-32009`, for one this client may not see. */
const REFUSED = -32009;
/** `-32010`, for a `createOnly` write onto something already there. */
const ALREADY = -32010;
/** `-32011`, for a write whose `ifMatch` no longer matches. */
const CONFLICT = -32011;

/** `file:///a/b` and `/a/b` both mean the same path here. */
export const pathOf = (uri: string): string => {
  const bare = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  return decodeURIComponent(bare);
};

/** A path, back as the URI a client sends and receives. */
export const uriOf = (path: string): string => `file://${path}`;

/** Whether `path` is `root` or is under it. */
const within = (root: string, path: string): boolean => {
  const step = relative(root, path);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
};

/**
 * The real path, if the client may see it.
 *
 * Resolved *before* the check, not after: `served/link` pointing at `/etc`
 * passes a textual test and opens something else entirely. A path that does
 * not exist yet is checked as written, since there is nothing to resolve.
 */
export async function allowed(uri: string, roots: string[]): Promise<string> {
  const asked = pathOf(uri);
  if (!isAbsolute(asked)) {
    throw new RpcError(REFUSED, `${uri} is not an absolute path`);
  }
  let real = asked;
  try {
    real = await realpath(asked);
  }
  catch { /* not there yet; the written path is what will be created */ }
  const roots_ = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
  if (!roots_.some((root) => within(root, real))) {
    throw new RpcError(REFUSED, `This host does not serve ${asked}. It serves ${roots.join(', ')}.`);
  }
  return real;
}

/**
 * The path to write, if the client may write it.
 *
 * Not `allowed`, and the difference is the whole security of the write half.
 * `allowed` resolves the path itself and falls back to the written text when
 * there is nothing there yet - which is right for reading, where a file that
 * does not exist has nothing to hand back either way. For a write it is a
 * hole: `served/link` pointing at `/etc` resolves to nothing for
 * `served/link/passwd`, so the textual test passes and the file is created
 * in `/etc`.
 *
 * So the *parent* is resolved, and the check is on that. A directory that is
 * not there yet is walked up until one is, because `mkdir -p` may be creating
 * several at once and none of them can escape a real ancestor.
 */
export async function writable(uri: string, roots: string[]): Promise<string> {
  const asked = pathOf(uri);
  if (!isAbsolute(asked)) throw new RpcError(REFUSED, `${uri} is not an absolute path`);
  /** The nearest ancestor that exists, and how far up it was. */
  let up = dirname(asked);
  const climbed: string[] = [];
  for (;;) {
    const real = await realpath(up).catch(() => undefined);
    if (real !== undefined) {
      const roots_ = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
      if (!roots_.some((root) => within(root, real))) {
        throw new RpcError(REFUSED, `This host does not serve ${asked}. It serves ${roots.join(', ')}.`);
      }
      // Rebuilt from the resolved ancestor down, so what is opened is what was
      // checked rather than the text that was sent.
      return join(real, ...climbed.reverse(), asked.slice(asked.lastIndexOf(sep) + 1));
    }
    const next = dirname(up);
    // `/` resolving to nothing means the filesystem is gone, not that the
    // client found a way out.
    if (next === up) throw new RpcError(REFUSED, `This host does not serve ${asked}.`);
    climbed.push(up.slice(up.lastIndexOf(sep) + 1));
    up = next;
  }
}

/** The validator `resourceWrite`'s `ifMatch` compares against. */
const tagOf = (size: number, mtimeMs: number): string => `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;

/** One directory's entries, names only. */
export async function list(uri: string, roots: string[]): Promise<Entry[]> {
  const path = await allowed(uri, roots);
  const found = await readdir(path, { withFileTypes: true }).catch(() => {
    throw new RpcError(NOT_FOUND, `No directory at ${uri}`);
  });
  return found
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' as const : 'file' as const }))
    // Directories first, then by name: a listing sorted by the order the
    // filesystem happens to return is a listing nobody can scan.
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
}

/**
 * What a path is, without opening it.
 *
 * `followSymlinks` decides which of the two questions is being asked - what
 * the link points at, or what the link is - and they have different answers
 * for size and type.
 */
export async function resolve(uri: string, roots: string[], followSymlinks = true): Promise<Metadata> {
  const path = await allowed(uri, roots);
  const asked = followSymlinks ? path : pathOf(uri);
  const found = await stat(asked, { bigint: false }).catch(() => {
    throw new RpcError(NOT_FOUND, `Nothing at ${uri}`);
  });
  return {
    uri: uriOf(followSymlinks ? path : asked),
    type: found.isDirectory() ? 'directory' : found.isSymbolicLink() ? 'symlink' : 'file',
    ...(found.isDirectory() ? {} : { size: found.size }),
    mtime: found.mtime.toISOString(),
    ctime: found.birthtime.toISOString(),
    // Only for a file. A directory has no bytes to have been changed under
    // somebody, which is the only thing this is compared for.
    ...(found.isDirectory() ? {} : { etag: tagOf(found.size, found.mtimeMs) }),
  };
}

/** Text by extension, and bytes for anything this does not recognise. */
const TEXTUAL = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'txt', 'css', 'html',
  'yml', 'yaml', 'toml', 'sh', 'c', 'h', 'cc', 'cpp', 'hpp', 'py', 'rb', 'go',
  'rs', 'java', 'sql', 'xml', 'svg', 'ini', 'conf', 'env', 'gitignore',
]);

/**
 * One file's bytes, as text where that is meaningful.
 *
 * The encoding is *reported* rather than assumed by the caller: a client that
 * asked for utf-8 and got a PNG would render the replacement character four
 * hundred thousand times, so anything not recognisably textual comes back
 * base64 whatever was asked for - which the protocol allows for exactly this.
 */
export async function read(uri: string, roots: string[], wanted?: string): Promise<Read> {
  const path = await allowed(uri, roots);
  const bytes = await readFile(path).catch(() => {
    throw new RpcError(NOT_FOUND, `No file at ${uri}`);
  });
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  const textual = TEXTUAL.has(extension) || path.slice(path.lastIndexOf(sep) + 1).startsWith('.');
  if (wanted === 'base64' || !textual) {
    return { data: bytes.toString('base64'), encoding: 'base64' };
  }
  return { data: bytes.toString('utf8'), encoding: 'utf-8', contentType: 'text/plain' };
}

/**
 * Paths under `base` that start with what was typed.
 *
 * The typed text is a path fragment, so its last segment is the prefix and
 * everything before it is the directory to look in - which is what makes
 * `@src/ho` complete to `@src/host.ts` rather than looking for a file called
 * `src/ho`.
 */
export async function complete(typed: string, base: string, roots: string[], limit = 50): Promise<string[]> {
  const cut = typed.lastIndexOf('/');
  const inside = cut === -1 ? '' : typed.slice(0, cut + 1);
  const prefix = cut === -1 ? typed : typed.slice(cut + 1);
  const where = join(base, inside);
  const found = await list(uriOf(where), roots).catch(() => [] as Entry[]);
  return found
    .filter((entry) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
    // A directory keeps its slash, so the next keystroke goes into it rather
    // than starting again.
    .map((entry) => `${inside}${entry.name}${entry.type === 'directory' ? '/' : ''}`)
    .slice(0, limit);
}

/**
 * Write, create or splice one file.
 *
 * The three modes differ in where `position` is rooted, which the protocol is
 * explicit about and which is easy to get subtly wrong: `truncate` and
 * `insert` count from the start of the file and `append` counts *backwards
 * from EOF*, so `append` with `position: 0` is a POSIX append and with
 * `position: 5` splices five bytes before the end.
 *
 * Everything is done on a buffer and written once. A file is not a stream
 * here - the protocol has no chunked write - so reading it, splicing, and
 * putting it back is both the simplest form and the only one that can honour
 * `insert` at all.
 */
export async function write(uri: string, roots: string[], content: Write): Promise<void> {
  const path = await writable(uri, roots);
  const incoming = Buffer.from(content.data, content.encoding === 'base64' ? 'base64' : 'utf8');

  const found = await stat(path).catch(() => undefined);
  if (found?.isDirectory()) throw new RpcError(REFUSED, `${uri} is a directory`);
  if (content.createOnly === true && found !== undefined) {
    throw new RpcError(ALREADY, `${uri} already exists`);
  }
  if (content.ifMatch !== undefined) {
    // A file that is gone cannot match, and one that is there must. Both are
    // the same failure from the client's side: what it read is not what is
    // there now.
    const now = found === undefined ? undefined : tagOf(found.size, found.mtimeMs);
    if (now !== content.ifMatch) {
      throw new RpcError(CONFLICT, `${uri} has changed since ${content.ifMatch}`);
    }
  }

  const mode = content.mode ?? 'truncate';
  const at = content.position ?? 0;
  // Only read the existing bytes where a mode actually keeps some. A truncate
  // from zero - the ordinary save - reads nothing.
  const held = mode === 'truncate' && at === 0
    ? Buffer.alloc(0)
    : await readFile(path).catch(() => Buffer.alloc(0));

  let out: Buffer;
  if (mode === 'append') {
    // Backwards from EOF, and clamped: a position past the start of the file
    // is a client asking to insert before the beginning.
    const cut = Math.max(0, held.length - Math.max(0, at));
    out = Buffer.concat([held.subarray(0, cut), incoming, held.subarray(cut)]);
  }
  else if (mode === 'insert') {
    const cut = Math.min(Math.max(0, at), held.length);
    out = Buffer.concat([held.subarray(0, cut), incoming, held.subarray(cut)]);
  }
  else {
    // Truncate: everything from `position` on is replaced, so what survives is
    // the head. A short file padded out to `position` would be inventing
    // bytes, so the head is however much of it there is.
    const cut = Math.min(Math.max(0, at), held.length);
    out = Buffer.concat([held.subarray(0, cut), incoming]);
  }
  await writeFile(path, out).catch((error: NodeJS.ErrnoException) => {
    // A missing parent is the protocol's `NotFound`, said about the directory
    // rather than about the file the client asked to create.
    if (error.code === 'ENOENT') throw new RpcError(NOT_FOUND, `No directory for ${uri}`);
    throw new RpcError(REFUSED, `Could not write ${uri}: ${error.message}`);
  });
}

/**
 * Remove one.
 *
 * A directory needs `recursive`, and a directory without it is refused rather
 * than emptied: the protocol has the flag so that deleting a tree is
 * something a client asked for in as many words.
 */
export async function remove(uri: string, roots: string[], recursive = false): Promise<void> {
  const path = await writable(uri, roots);
  const found = await stat(path).catch(() => {
    throw new RpcError(NOT_FOUND, `Nothing at ${uri}`);
  });
  if (found.isDirectory() && !recursive) {
    throw new RpcError(REFUSED, `${uri} is a directory. Pass recursive to remove it.`);
  }
  await rm(path, { recursive, force: false }).catch((error: NodeJS.ErrnoException) => {
    throw new RpcError(REFUSED, `Could not remove ${uri}: ${error.message}`);
  });
}

/** Make a directory, and the parents it needs. */
export async function mkdir(uri: string, roots: string[]): Promise<void> {
  const path = await writable(uri, roots);
  await makeDir(path, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    // `recursive` already tolerates an existing directory, so this is a *file*
    // in the way - which is a different thing to say.
    if (error.code === 'EEXIST' || error.code === 'ENOTDIR') {
      throw new RpcError(ALREADY, `${uri} is already a file`);
    }
    throw new RpcError(REFUSED, `Could not create ${uri}: ${error.message}`);
  });
}

/**
 * Both ends of a two-path operation, checked.
 *
 * The source has to exist and the destination has to be somewhere this host
 * serves - so they are different questions and neither implies the other. A
 * move out of the served set is the interesting one to refuse: it would carry
 * a file somewhere the host can no longer see, which is a deletion nobody
 * asked for.
 */
async function pair(source: string, destination: string, roots: string[], failIfExists: boolean) {
  const from = await allowed(source, roots);
  const to = await writable(destination, roots);
  await stat(from).catch(() => {
    throw new RpcError(NOT_FOUND, `Nothing at ${source}`);
  });
  if (failIfExists && await stat(to).then(() => true, () => false)) {
    throw new RpcError(ALREADY, `${destination} already exists`);
  }
  return { from, to };
}

/** Rename, within the served directories on both ends. */
export async function move(source: string, destination: string, roots: string[], failIfExists = false): Promise<void> {
  const { from, to } = await pair(source, destination, roots, failIfExists);
  await rename(from, to).catch((error: NodeJS.ErrnoException) => {
    throw new RpcError(REFUSED, `Could not move ${source}: ${error.message}`);
  });
}

/** Copy, within the served directories on both ends. */
export async function copy(source: string, destination: string, roots: string[], failIfExists = false): Promise<void> {
  const { from, to } = await pair(source, destination, roots, failIfExists);
  const found = await stat(from);
  // A directory copy is a tree walk and a file copy is one syscall. `cp` does
  // both, but only `copyFile` reports the ordinary case honestly.
  const run = found.isDirectory()
    ? cp(from, to, { recursive: true, force: !failIfExists, errorOnExist: failIfExists })
    : copyFile(from, to);
  await run.catch((error: NodeJS.ErrnoException) => {
    throw new RpcError(REFUSED, `Could not copy ${source}: ${error.message}`);
  });
}

/**
 * The filesystem this process is on, as a host's `ResourceStore`.
 *
 * Kept out of `createHost` so the protocol imports no runtime: this file is
 * the one that touches `node:fs`, and a host that never opens a file never
 * loads it.
 *
 * ```ts
 * createHost({ path, agents, resources: fileResources() });
 * ```
 */
export const fileResources = (): ResourceStore => ({
  list, read, resolve, complete,
  write, remove, mkdir, move, copy,
});
