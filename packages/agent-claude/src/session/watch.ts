import { existsSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { projectDirOf } from './disk.js';

/** The folders a session's customizations are read from. */
export interface WatchRoots {
  /** The personal scope: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
  configDir: string;
  /** The session's working directory, whose `.claude` is the project scope. */
  cwd?: string;
  /** The record's `watchWaitMs`. */
  waitMs?: number;
}

/**
 * How long after the last change of a burst the list is read again, unless
 * the record's `watchWaitMs` says otherwise: VS Code's Claude watcher's quiet.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L474
 */
const WAIT_MS = 300;

/** The folders of a scope a customization is read from, each watched with its subfolders. */
const FOLDERS = ['agents', 'skills', 'commands', 'rules'];

/**
 * The folder of the plugins, watched whole with its subfolders: every change
 * in it calls, as VS Code's Claude watcher triggers on the whole subtree.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L443-L452
 */
const PLUGINS = 'plugins';

/**
 * Whether a change in one of `FOLDERS` is the CLI's own bookkeeping, which
 * lists nothing. The CLI writes the `manifest.json` and dotfiles of each
 * `skills/synced` folder each time it starts, with the same content when
 * nothing changed. A change to a skill also writes the skill's own files.
 */
const isBookkeeping = (name: string): boolean => {
  const file = basename(name);
  return file.startsWith('.') || (file === 'manifest.json' && name.split(/[\\/]/)[0] === 'synced');
};

/** Whether `at` is a folder now, which Windows says `change` for when a file in it is written. */
const isFolder = (at: string): boolean => {
  try { return statSync(at).isDirectory(); }
  catch { return false; }
};

/** The files of a scope a customization is read from. */
const FILES = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'settings.json', 'settings.local.json']);

/**
 * The files at the top of a working directory a customization is read from:
 * the memory files and the project's MCP servers, as VS Code's Claude watcher
 * triggers on its working directory's `.mcp.json` beside them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L461-L520
 */
const MEMORY = new Set(['CLAUDE.md', 'CLAUDE.local.md', '.mcp.json']);

type Listener = (event: string, name: string | null) => void;

/** One folder's handle and every watcher's listener on it. */
interface Shared {
  handle: FSWatcher;
  /**
   * Whether the handle was opened in this turn of the event loop: one change
   * reaches every holder in one turn, and the first to open the folder again
   * opens it for all of them.
   */
  young: boolean;
  listeners: Set<Listener>;
}

/**
 * The open handles, one per folder and recursive flag, whatever watchers hold
 * them: each preset's probe and each session watch the same personal folder,
 * and the sessions of one project the same project, and a handle each was the
 * whole tree again for each of them on Linux, where a recursive watch is an
 * inotify watch per subfolder.
 */
const shared = new Map<string, Shared>();

/** A folder's key: its resolved path, compared case-sensitively only on Linux, and whether its subfolders are watched. */
const keyOf = (at: string, recursive: boolean): string => {
  const path = resolve(at);
  return `${recursive ? 'r' : 'n'}:${process.platform === 'linux' ? path : path.toLowerCase()}`;
};

/** Open the folder's one handle for `listeners`, or nothing when it cannot be. */
const openShared = (key: string, at: string, recursive: boolean, listeners: Set<Listener>): Shared | undefined => {
  let handle: FSWatcher;
  try {
    handle = watch(at, { recursive }, (event, name) => {
      for (const one of [...listeners]) one(event, name === null ? null : String(name));
    });
  }
  catch { return undefined; }
  const entry: Shared = { handle, young: true, listeners };
  setImmediate(() => { entry.young = false; });
  // A failed handle takes only itself, for every holder; an `error` with no listener ends the process.
  handle.on('error', () => {
    handle.close();
    if (shared.get(key) === entry) shared.delete(key);
  });
  shared.set(key, entry);
  return entry;
};

/**
 * Hold a folder with `listener`, and answer the function that lets go: the
 * handle closes with its last holder, or nothing when the folder cannot be
 * watched.
 *
 * A folder removed and made again is another folder, which the old handle
 * hears nothing of on Linux, and Linux often gives it the same inode, so the
 * folder on disk cannot tell. `fresh` says the folder was made again: the
 * handle is opened again and every holder moves to it, once for one change
 * however many holders it reaches.
 */
const holdFolder = (at: string, recursive: boolean, listener: Listener, fresh: boolean): (() => void) | undefined => {
  const key = keyOf(at, recursive);
  let entry = shared.get(key);
  if (entry !== undefined && fresh && !entry.young) {
    entry.handle.close();
    shared.delete(key);
    entry = openShared(key, at, recursive, entry.listeners);
  }
  else if (entry === undefined) entry = openShared(key, at, recursive, new Set());
  if (entry === undefined) return undefined;
  const { listeners } = entry;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // The entry the listeners belong to now: a handle opened again keeps them,
    // so a holder that let go after it was opened again closes the new one.
    const now = shared.get(key);
    if (listeners.size === 0 && now?.listeners === listeners) {
      now.handle.close();
      shared.delete(key);
    }
  };
};

/**
 * Watch the Claude folders of a session, and call `onChange` when a
 * customization in them is written, edited or deleted: VS Code's
 * `ClaudeCustomizationWatcher`, whose disposal is the function this returns.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L454-L476
 *
 * The personal folder and `<cwd>/.claude` are watched where a customization
 * is read from, and `cwd` itself only for its `CLAUDE.md` files and its
 * `.mcp.json`. A
 * burst of changes is one call, the roots' `waitMs` after its last change. A
 * folder that is not there yet is watched for from its parent, and from when
 * it appears.
 *
 * A watcher is an extra rather than the answer: a folder that cannot be
 * watched is left out, and nothing here throws. The function it returns
 * lets go of every folder it holds, and no call comes after it. A folder has
 * one handle however many watchers hold it, and it closes with the last.
 *
 * `quiet`, where given, says when a change calls for nothing: one told while
 * it holds is dropped as it arrives.
 */
export function createClaudeCustomizationWatcher(roots: WatchRoots, onChange: () => void, quiet?: () => boolean): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** What lets go of each folder this watcher holds. */
  const releases = new Set<() => void>();

  const fire = (): void => {
    if (closed || quiet?.() === true) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, roots.waitMs ?? WAIT_MS);
  };

  /** One folder held through the shared wait, answering what lets go of it, or nothing when it cannot be watched. */
  const opened = (at: string, recursive: boolean, onName: (name: string | null, event: string) => void, fresh = false): (() => void) | undefined => {
    if (closed) return undefined;
    const release = holdFolder(at, recursive, (event, name) => onName(name, event), fresh);
    if (release === undefined) return undefined;
    releases.add(release);
    return () => {
      release();
      releases.delete(release);
    };
  };

  /**
   * A scope's folder: its customization folders and its plugins folder with
   * their subfolders, and its own files. Nothing else in it is watched,
   * because the rest - the transcripts under `projects`, `todos` - is the
   * CLI's own and changes nothing listed, and a watch of it costs a handle per
   * folder.
   *
   * A folder that appears, or is made again, is watched from then on. A scope
   * that is not there is watched for from its parent.
   */
  const scope = (dir: string): void => {
    const held = new Map<string, (() => void) | undefined>();
    /**
     * Watch one folder of the scope again, from what is there now. Asked again
     * after it, the folder was made or removed, so its handle is opened fresh.
     */
    const folder = (name: string): void => {
      const again = held.has(name);
      held.get(name)?.();
      const at = join(dir, name);
      const onName = name === PLUGINS
        ? fire
        : (file: string | null, event: string): void => {
          if (file === null) fire();
          else if (!isBookkeeping(file) && !(event === 'change' && isFolder(join(at, file)))) fire();
        };
      held.set(name, existsSync(at) ? opened(at, true, onName, again) : undefined);
    };
    const open = (): void => {
      opened(dir, false, (name, event) => {
        if (name === null || FILES.has(name)) fire();
        // Only a folder made or removed. Windows also says `change` for a
        // folder when a file in it is written, and its own watch has that.
        else if (event === 'rename' && (name === PLUGINS || FOLDERS.includes(name))) {
          folder(name);
          fire();
        }
      });
      for (const name of [...FOLDERS, PLUGINS]) folder(name);
    };
    if (existsSync(dir)) {
      open();
      return;
    }
    const own = basename(dir);
    const parent = opened(dirname(dir), false, (name) => {
      if (name !== own || !existsSync(dir) || closed) return;
      parent?.();
      open();
      // What was written with the folder came before its watch.
      fire();
    });
  };

  scope(roots.configDir);
  if (roots.cwd !== undefined) {
    // None in the home folder, whose `.claude` is the personal folder.
    const project = projectDirOf(roots);
    // The project's `.claude` is watched for by the working directory's own
    // handle, which is open for the memory files anyway.
    if (project !== undefined && existsSync(project)) scope(project);
    let found = project === undefined || existsSync(project);
    opened(roots.cwd, false, (name) => {
      if (name !== null && MEMORY.has(name)) fire();
      if (!found && project !== undefined && name === '.claude' && existsSync(project)) {
        found = true;
        scope(project);
        fire();
      }
    });
  }

  return () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const release of [...releases]) release();
    releases.clear();
  };
}
