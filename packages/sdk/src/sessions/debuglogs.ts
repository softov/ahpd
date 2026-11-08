/**
 * The window's "collect logs", packed up the way its own host packs it.
 *
 * A request names what it wants - a session, a chat, an archive or a
 * directory - and gets back a resource under the temporary directory with a
 * list of what went into it. An archive is read back through
 * `vscode/readAgentHostDebugLogsChunk` a megabyte at a time, since the window
 * may be on another machine; a directory is opened where it is. Either is
 * let go of after a lease, and only what this collector made can be read
 * through it, so the chunk reader is not a way to read any file on the host.
 */

import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { localPath, uriOf } from '../resources/fileuri.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { zip } from '../utils/zip.js';

/** What the reference window reads back. */
export interface Collected {
  kind: 'archive' | 'directory';
  resource: string;
  providerLogsIncluded: boolean;
  size: number;
  uncompressedSize: number;
  entries: { path: string; size: number }[];
}

/** One file to pack, and the backend whose it is, where it is a backend's rather than the host's. */
export interface LogFile { path: string; from: string; provider?: string }

/**
 * A collection a client follows under its progress token: told how far it has
 * got, and called off when that client asks or goes.
 */
export interface Followed {
  token: string;
  owner: string;
  report(bytes: number, total: number, message: string): void;
}

export interface DebugLogs {
  /** Pack the files; a followed collection under a token already in use is refused. */
  collect(files: LogFile[], kind: 'archive' | 'directory', followed?: Followed): Promise<Collected>;
  /** Call off the collection this owner follows under the token: whether there was one. */
  cancel(token: string, owner: string): boolean;
  /** Call off every collection one client follows. */
  abandon(owner: string): void;
  read(resource: string, position: number): Promise<{ data: string; eof: boolean }>;
  /** Take back everything still lent. */
  close(): Promise<void>;
}

/** A megabyte per chunk, which is the reference host's size. */
export const CHUNK = 1024 * 1024;

/**
 * A byte count in the reference's words for one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/files/common/files.ts#L1603-L1625
 */
const sized = (size: number): string => {
  const units = [['B', 1], ['KB', 1024], ['MB', 1024 ** 2], ['GB', 1024 ** 3], ['TB', 1024 ** 4]] as const;
  const [unit, scale] = units.findLast(([, at]) => size >= at) ?? units[0];
  return unit === 'B' ? `${size.toFixed(0)}B` : `${(size / scale).toFixed(2)}${unit}`;
};
/** How long an artifact stays readable once made. */
const LEASE = 10 * 60 * 1000;


export function debugLogs(options: { tmp?: string; lease?: number } = {}): DebugLogs {
  const tmp = options.tmp ?? tmpdir();
  const lease = options.lease ?? LEASE;
  /** What is out on loan, by path, with what takes it back. */
  const lent = new Map<string, { recursive: boolean; timer: ReturnType<typeof setTimeout> }>();
  /** The archives the chunk reader may open. */
  const readable = new Set<string>();

  const release = async (path: string): Promise<void> => {
    const held = lent.get(path);
    if (held === undefined) return;
    clearTimeout(held.timer);
    lent.delete(path);
    readable.delete(path);
    await rm(path, { recursive: held.recursive, force: true }).catch(() => {});
  };

  const lend = (path: string, recursive: boolean): void => {
    const timer = setTimeout(() => { void release(path); }, lease);
    timer.unref?.();
    lent.set(path, { recursive, timer });
  };

  /** The collections a client follows, by progress token. */
  const following = new Map<string, { owner: string; stop: AbortController }>();

  return {
    /*
     * The reference collector's sequence, the files packed in the order given:
     * a backend's file before the host's, each step said as it begins, a check
     * for a cancel before each step, the archive compressed
     * with its progress said at most every 100 ms and once at the end, and a
     * cancelled collection leaving nothing behind.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostDebugLogs.ts#L55-L134
     */
    collect: async (files, kind, followed) => {
      if (followed !== undefined && following.has(followed.token)) throw new RpcError(INVALID_PARAMS, 'progressToken is already in use');
      const stop = new AbortController();
      if (followed !== undefined) following.set(followed.token, { owner: followed.owner, stop });
      const checked = (): void => {
        if (stop.signal.aborted) throw new Error('Canceled');
      };
      const id = crypto.randomUUID();
      const staging = join(tmp, `agent-host-debug-logs-${id}`);
      const archive = join(tmp, `agent-host-debug-logs-${id}.zip`);
      const entries: { path: string; size: number }[] = [];
      const packed: { path: string; from: string }[] = [];
      let providerLogsIncluded = false;
      let uncompressedSize = 0;
      let kept = false;
      try {
        await mkdir(staging, { recursive: true });
        const said = new Set<string>();
        for (const file of files) {
          checked();
          const step = file.provider === undefined ? 'host' : file.provider;
          if (!said.has(step)) {
            said.add(step);
            followed?.report(0, 0, file.provider === undefined
              ? 'Collecting Agent Host process and transport logs...'
              : `Collecting ${file.provider} session logs...`);
          }
          // A log that is not there is nothing to pack, not a failure.
          const found = await stat(file.from).catch(() => undefined);
          if (found === undefined || !found.isFile()) continue;
          const to = join(staging, file.path);
          await mkdir(join(to, '..'), { recursive: true });
          await copyFile(file.from, to);
          entries.push({ path: file.path, size: found.size });
          packed.push({ path: file.path, from: to });
          uncompressedSize += found.size;
          if (file.provider !== undefined) providerLogsIncluded = true;
        }
        checked();
        if (kind === 'directory') {
          kept = true;
          lend(staging, true);
          return { kind, resource: uriOf(staging), providerLogsIncluded, size: uncompressedSize, uncompressedSize, entries };
        }
        let lastReport = 0;
        const size = await zip(archive, packed, {
          signal: stop.signal,
          progress: (bytes, path) => {
            const now = Date.now();
            if (bytes !== uncompressedSize && now - lastReport < 100) return;
            lastReport = now;
            followed?.report(bytes, uncompressedSize, `Compressing ${path}: ${sized(bytes)} / ${sized(uncompressedSize)}`);
          },
        });
        lend(archive, false);
        readable.add(archive);
        return { kind, resource: uriOf(archive), providerLogsIncluded, size, uncompressedSize, entries };
      }
      catch (error) {
        await rm(archive, { force: true }).catch(() => {});
        throw error;
      }
      finally {
        if (followed !== undefined && following.get(followed.token)?.stop === stop) following.delete(followed.token);
        if (!kept) await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    },
    cancel: (token, owner) => {
      const held = following.get(token);
      if (held === undefined || held.owner !== owner) return false;
      held.stop.abort();
      return true;
    },
    abandon: (owner) => {
      for (const held of following.values()) if (held.owner === owner) held.stop.abort();
    },
    read: async (resource, position) => {
      const path = localPath(resource);
      if (!readable.has(path)) throw new Error('Unknown or expired Agent Host debug-log artifact');
      if (!Number.isSafeInteger(position) || position < 0) throw new Error(`Invalid debug-log artifact position: ${position}`);
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.allocUnsafe(CHUNK);
        const { bytesRead } = await handle.read(buffer, 0, CHUNK, position);
        const { size } = await handle.stat();
        return { data: buffer.subarray(0, bytesRead).toString('base64'), eof: position + bytesRead >= size };
      }
      finally {
        await handle.close();
      }
    },
    close: async () => {
      await Promise.all([...lent.keys()].map((path) => release(path)));
    },
  };
}

/** The name a host log takes inside the collection: the reference host's folder, and the file's own name. */
export const hostLogPath = (file: string): string => `agenthost/${basename(file)}`;
