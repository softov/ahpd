import { existsSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { projectDirOf } from './disk.js';

/** The folders a session's customizations are read from. */
export interface WatchRoots {
  /** The personal scope: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
  configDir: string;
  /** The session's working directory, whose `.claude` is the project scope. */
  cwd?: string;
}

/** How long after the last change of a burst the list is read again. */
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

/**
 * Watch the Claude folders of a session, and call `onChange` when a
 * customization in them is written, edited or deleted.
 *
 * The personal folder and `<cwd>/.claude` are watched where a customization
 * is read from, and `cwd` itself only for its `CLAUDE.md` files and its
 * `.mcp.json`. A
 * burst of changes is one call, `WAIT_MS` after its last change. A folder that
 * is not there yet is watched for from its parent, and from when it appears.
 *
 * A watcher is an extra rather than the answer: a folder that cannot be
 * watched is left out, and nothing here throws. The function it returns
 * closes every handle, and no call comes after it.
 *
 * `quiet`, where given, says when a change calls for nothing: one told while
 * it holds is dropped as it arrives.
 */
export function watchFolders(roots: WatchRoots, onChange: () => void, quiet?: () => boolean): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handles = new Set<FSWatcher>();

  const fire = (): void => {
    if (closed || quiet?.() === true) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, WAIT_MS);
  };

  /** One folder watched through the shared wait, or nothing when it cannot be. */
  const opened = (at: string, recursive: boolean, onName: (name: string | null, event: string) => void): FSWatcher | undefined => {
    if (closed) return undefined;
    let watcher: FSWatcher;
    try { watcher = watch(at, { recursive }, (event, name) => onName(name === null ? null : String(name), event)); }
    catch { return undefined; }
    handles.add(watcher);
    // A failed handle takes only itself; an `error` with no listener ends the process.
    watcher.on('error', () => {
      watcher.close();
      handles.delete(watcher);
    });
    return watcher;
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
    const held = new Map<string, FSWatcher | undefined>();
    /** Watch one folder of the scope again, from what is there now. */
    const folder = (name: string): void => {
      const was = held.get(name);
      if (was !== undefined) { was.close(); handles.delete(was); }
      const at = join(dir, name);
      const onName = name === PLUGINS
        ? fire
        : (file: string | null, event: string): void => {
          if (file === null) fire();
          else if (!isBookkeeping(file) && !(event === 'change' && isFolder(join(at, file)))) fire();
        };
      held.set(name, existsSync(at) ? opened(at, true, onName) : undefined);
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
      parent?.close();
      if (parent !== undefined) handles.delete(parent);
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
    for (const handle of handles) handle.close();
    handles.clear();
  };
}
