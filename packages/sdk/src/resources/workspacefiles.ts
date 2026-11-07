/** The files under a working directory, listed by ripgrep. */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { WorkspaceFiles, WorkspaceFilesResult } from '../types/host.js';

/** Maximum number of files cached per working directory. */
const MAX_FILES = 50_000;

/** TTL for a cached file list before we re-enumerate. */
const CACHE_TTL_MS = 30_000;

/** Maximum number of concurrent ripgrep enumerations across all callers. */
const MAX_CONCURRENT_ENUMERATIONS = 4;

interface CacheEntry {
  readonly promise: Promise<WorkspaceFilesResult>;
  expiresAt?: number;
}

/**
 * The files under a working directory, listed by ripgrep, as a host's
 * `WorkspaceFiles`.
 *
 * VS Code's agent host's `AgentHostWorkspaceFiles`, with its arguments, its
 * limits and its cache: `rg --files --hidden --no-require-git --follow
 * --no-config --glob !.git` in the directory, so `.gitignore` and `.ignore`
 * files are honoured, symlinks followed and a person's own `~/.ripgreprc`
 * changes nothing; 50 000 files at most, past which the list says it is
 * truncated; a directory's list shared by every call while it runs and kept 30
 * seconds after; four listings at once at most. VS Code hands its listing a
 * cancellation token, which a completion here has no form of.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorkspaceFiles.ts
 *
 * Deliberately not part of `createHost`: it spawns `rg`, which is a binary
 * rather than a runtime API and may not be installed at all, as `gitBranches`
 * spawns `git`. `command` is the binary, `rg` on the path where none is named;
 * VS Code's own is the one its `@vscode/ripgrep` dependency ships.
 *
 * ```ts
 * createHost({ path, agents: [claude({ paths })], workspaceFiles: ripgrepFiles() });
 * ```
 */
export function ripgrepFiles(command = 'rg'): WorkspaceFiles {
  const cache = new Map<string, CacheEntry>();
  /** Active ripgrep child processes, killed on close. */
  const activeChildren = new Set<ChildProcessWithoutNullStreams>();
  let isDisposed = false;

  /*
   * VS Code's `Limiter` of its enumerations: one more waits until one running
   * ends.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorkspaceFiles.ts#L22-L25
   */
  let running = 0;
  const waiting: (() => void)[] = [];
  const limited = async (work: () => Promise<WorkspaceFilesResult>): Promise<WorkspaceFilesResult> => {
    if (running >= MAX_CONCURRENT_ENUMERATIONS) await new Promise<void>((go) => { waiting.push(go); });
    running += 1;
    try {
      return await work();
    }
    finally {
      running -= 1;
      waiting.shift()?.();
    }
  };

  const enumerate = (workingDirectory: string): Promise<WorkspaceFilesResult> =>
    new Promise<WorkspaceFilesResult>((resolve, reject) => {
      // Mirror the workbench's `ripgrepFileSearch.ts` invocation: pass
      // `--no-config` so a user's global `~/.ripgreprc` cannot change
      // enumeration results (or enable preprocessors etc.).
      const args = ['--files', '--hidden', '--no-require-git', '--follow', '--no-config', '--glob', '!.git'];

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command, args, { cwd: workingDirectory });
      }
      catch (err) {
        reject(err);
        return;
      }
      activeChildren.add(child);

      const results: string[] = [];
      let buffer = '';
      let limitHit = false;
      let settled = false;

      const finish = (files: string[], error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        activeChildren.delete(child);
        if (error) {
          reject(error);
        } else {
          resolve({ files, isTruncated: limitHit });
        }
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (limitHit) {
          return;
        }
        buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }
          results.push(join(workingDirectory, line));
          if (results.length >= MAX_FILES) {
            limitHit = true;
            try {
              child.kill();
            }
            catch {
              // ignore
            }
            break;
          }
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', () => { /* read, so ripgrep never blocks on a full pipe */ });

      child.on('error', (err) => {
        if (isDisposed) {
          finish([]);
          return;
        }
        finish([], err);
      });

      child.on('close', (code) => {
        if (isDisposed) {
          finish([]);
          return;
        }
        // Flush any trailing line still in the buffer.
        if (!limitHit && buffer.length > 0) {
          const line = buffer.replace(/\r$/, '');
          if (line) {
            results.push(join(workingDirectory, line));
          }
          buffer = '';
        }
        if (!limitHit && code !== 0 && code !== 1) {
          finish([], new Error(`ripgrep exited with code ${code ?? 'unknown'} while enumerating ${workingDirectory}`));
          return;
        }
        finish(results);
      });
    });

  return {
    getFiles: (workingDirectory) => {
      const now = Date.now();
      const existing = cache.get(workingDirectory);
      if (existing && (existing.expiresAt === undefined || existing.expiresAt > now)) {
        return existing.promise;
      }
      const shared = limited(() => (isDisposed ? Promise.resolve({ files: [], isTruncated: false }) : enumerate(workingDirectory)));
      const entry: CacheEntry = { promise: shared };
      cache.set(workingDirectory, entry);
      shared.then(() => {
        if (cache.get(workingDirectory) === entry) {
          entry.expiresAt = Date.now() + CACHE_TTL_MS;
        }
      }, () => {
        if (cache.get(workingDirectory) === entry) {
          cache.delete(workingDirectory);
        }
      });
      return shared;
    },
    close: () => {
      isDisposed = true;
      for (const child of activeChildren) {
        try {
          child.kill();
        }
        catch {
          // ignore
        }
      }
      activeChildren.clear();
      cache.clear();
    },
  };
}
