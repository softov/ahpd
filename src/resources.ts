import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { RpcError } from './rpc.js';
import type { Entry, Metadata, Read } from './types/resources.js';

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
