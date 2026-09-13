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
import { zip } from './zip.js';

/** What the reference window reads back. */
export interface Collected {
  kind: 'archive' | 'directory';
  resource: string;
  providerLogsIncluded: boolean;
  size: number;
  uncompressedSize: number;
  entries: { path: string; size: number }[];
}

/** One file to pack, and whether it is the backend's rather than the host's. */
export interface LogFile { path: string; from: string; provider?: boolean }

export interface DebugLogs {
  collect(files: LogFile[], kind: 'archive' | 'directory'): Promise<Collected>;
  read(resource: string, position: number): Promise<{ data: string; eof: boolean }>;
  /** Take back everything still lent. */
  close(): Promise<void>;
}

/** A megabyte per chunk, which is the reference host's size. */
export const CHUNK = 1024 * 1024;
/** How long an artifact stays readable once made. */
const LEASE = 10 * 60 * 1000;

const asPath = (resource: string): string => (resource.startsWith('file://') ? decodeURIComponent(resource.slice('file://'.length)) : resource);

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

  return {
    collect: async (files, kind) => {
      const id = crypto.randomUUID();
      const staging = join(tmp, `agent-host-debug-logs-${id}`);
      await mkdir(staging, { recursive: true });
      const entries: { path: string; size: number }[] = [];
      const packed: { path: string; from: string }[] = [];
      let providerLogsIncluded = false;
      let uncompressedSize = 0;
      try {
        for (const file of files) {
          // A log that is not there is nothing to pack, not a failure.
          const found = await stat(file.from).catch(() => undefined);
          if (found === undefined || !found.isFile()) continue;
          const to = join(staging, file.path);
          await mkdir(join(to, '..'), { recursive: true });
          await copyFile(file.from, to);
          entries.push({ path: file.path, size: found.size });
          packed.push({ path: file.path, from: to });
          uncompressedSize += found.size;
          if (file.provider) providerLogsIncluded = true;
        }
        if (kind === 'directory') {
          lend(staging, true);
          return { kind, resource: `file://${staging}`, providerLogsIncluded, size: uncompressedSize, uncompressedSize, entries };
        }
        const archive = join(tmp, `agent-host-debug-logs-${id}.zip`);
        const size = await zip(archive, packed);
        lend(archive, false);
        readable.add(archive);
        return { kind, resource: `file://${archive}`, providerLogsIncluded, size, uncompressedSize, entries };
      }
      finally {
        if (kind !== 'directory') await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    },
    read: async (resource, position) => {
      const path = asPath(resource);
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
