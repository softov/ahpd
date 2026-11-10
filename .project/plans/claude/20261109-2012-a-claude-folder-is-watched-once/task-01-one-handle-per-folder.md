---
title: One handle per folder
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/watch.ts#L81-L187](../../../../packages/agent-claude/src/session/watch.ts#L81-L187) - the watcher whose handles go through the registry"
  - "[code://packages/agent-claude/test/watch.test.ts](../../../../packages/agent-claude/test/watch.test.ts) - the cases this task adds to"
---

## Objective

`watch.ts` opens one `fs.watch` per folder however many watchers want it, and every watcher still hears each change through its own filters, quiet and wait.

## Files

- `UPDATE: packages/agent-claude/src/session/watch.ts:1-3` - imports: add `resolve` from `node:path`.
- `UPDATE: packages/agent-claude/src/session/watch.ts:50-80` - add the registry above `createClaudeCustomizationWatcher`: `Listener`, `Shared`, `shared`, `keyOf`, `openShared`, `holdFolder`.
- `UPDATE: packages/agent-claude/src/session/watch.ts:84` - `handles: Set<FSWatcher>` becomes `releases: Set<() => void>`.
- `UPDATE: packages/agent-claude/src/session/watch.ts:96-108` - `opened` holds the folder through `holdFolder` and returns its release.
- `UPDATE: packages/agent-claude/src/session/watch.ts:120-160` - `scope`: `held` keeps releases; `folder` reopens with `fresh`; the parent watch is released, not closed.
- `UPDATE: packages/agent-claude/src/session/watch.ts:180-186` - the returned function calls every release.
- `UPDATE: packages/agent-claude/test/watch.test.ts` - a `vi.mock('node:fs')` that counts `watch` calls and the handles still open, and the cases below.

## Steps

1. Add the registry to `watch.ts` (decisions 1 and 2):

   ```ts
   type Listener = (event: string, name: string | null) => void;

   /** One folder's handle and every watcher's listener on it. */
   interface Shared { handle: FSWatcher; listeners: Set<Listener> }

   /** The open handles, one per folder and recursive flag, whatever watchers hold them. */
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
     const entry: Shared = { handle, listeners };
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
    * handle closes with its last holder. `fresh` opens the folder again for
    * every holder, for a folder that was made again and whose old handle
    * hears nothing.
    */
   const holdFolder = (at: string, recursive: boolean, listener: Listener, fresh: boolean): (() => void) | undefined => {
     const key = keyOf(at, recursive);
     let entry = shared.get(key);
     if (entry !== undefined && fresh) {
       entry.handle.close();
       shared.delete(key);
       entry = openShared(key, at, recursive, entry.listeners);
     }
     else if (entry === undefined) entry = openShared(key, at, recursive, new Set());
     if (entry === undefined) return undefined;
     entry.listeners.add(listener);
     const held = entry;
     return () => {
       held.listeners.delete(listener);
       if (held.listeners.size === 0 && shared.get(key) === held) {
         held.handle.close();
         shared.delete(key);
       }
     };
   };
   ```

2. In `createClaudeCustomizationWatcher`, replace `handles` with `const releases = new Set<() => void>();`.
3. Replace `opened` with:

   ```ts
   /** One folder held through the shared wait, or nothing when it cannot be. */
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
   ```

4. In `scope`, `held` becomes `Map<string, (() => void) | undefined>`.
   `folder(name)` calls the release it holds, then `opened(at, true, onName, was !== undefined)`, so a folder opened again after a `rename` is `fresh` and its first opening is not.
5. In `scope`'s parent watch, keep the release that `opened` answers as `parent`, and call `parent?.()` where it now calls `parent?.close()` and `handles.delete(parent)`.
6. In the returned function, call each function in `releases`, then `releases.clear()`.
7. In `watch.test.ts`, wrap `watch` with `vi.mock('node:fs', async (importOriginal) => ...)` so a case reads how many handles were opened and how many are open now, and add these cases:
   - Two watchers on the same roots open each folder once, and both are called for one change.
   - Closing one of two watchers keeps the other called, and closing the last leaves no handle open.
   - Two watchers on different personal folders share no handle.
   - A folder removed and made again is heard by both watchers after it is made again.
   - A shared handle that emits `error` is gone for both watchers, and nothing throws.

## Validation

- `packages/agent-claude/test/watch.test.ts`: the cases above, and the existing thirteen unchanged.
- `node node_modules/vitest/vitest.mjs run packages/agent-claude/test/` on Windows with Node 22 passes.
- `pnpm typecheck` is clean.

## Resume

