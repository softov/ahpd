---
title: A Claude folder is watched once
domain: claude
status: active
priority: medium
created: 2026-11-09
revalidated: 2026-11-09
requires:
  - plans/claude/20261031-0258-a-written-agent-shows-at-once/plan.md
changes: []
creates: []
decisions:
  - decisions/the-claude-folder-watches-are-shared-in-watch-ts.md
  - decisions/every-claude-folder-watch-goes-through-the-registry.md
refs:
  - git://be575a967 - the commit of ahpd this plan was checked at
  - "[code://packages/agent-claude/src/session/watch.ts#L81-L187](../../../../packages/agent-claude/src/session/watch.ts#L81-L187) - `createClaudeCustomizationWatcher`, which opens its own `fs.watch` for each folder and closes them all in the function it returns"
  - "[code://packages/agent-claude/src/session/watch.ts#L96-L108](../../../../packages/agent-claude/src/session/watch.ts#L96-L108) - `opened`, the one place a handle is opened, and its `error` listener that drops only that handle"
  - "[code://packages/agent-claude/src/session/watch.ts#L120-L160](../../../../packages/agent-claude/src/session/watch.ts#L120-L160) - `scope`, which opens a folder again when it is made again, and watches a missing scope from its parent"
  - "[code://packages/agent-claude/src/claude.ts#L617-L623](../../../../packages/agent-claude/src/claude.ts#L617-L623) - `probeChanged`, the probe's watcher of the personal folder"
  - "[code://packages/agent-claude/src/session/servers.ts#L554-L570](../../../../packages/agent-claude/src/session/servers.ts#L554-L570) - a session's watcher, closed by `unwatch`"
  - "[code://packages/sdk/src/host.ts#L1741-L1760](../../../../packages/sdk/src/host.ts#L1741-L1760) - the host asks `probeChanged` once per provider, so once per preset variant"
  - "[code://packages/sdk/src/host/filecompletions.ts#L59](../../../../packages/sdk/src/host/filecompletions.ts#L59) - `keyOf`, the path key that is case-sensitive only on Linux, the pattern to copy"
  - "[code://packages/agent-claude/test/watch.test.ts](../../../../packages/agent-claude/test/watch.test.ts) - the watcher's cases on real folders, where the new cases go"
  - "[code://packages/agent-claude/README.md#L246](../../../../packages/agent-claude/README.md#L246) - the sentence on the watch"
---

## Goal

A Claude folder is watched once however many sessions and preset variants watch it.
Today each preset variant's probe and each session open their own handles on the same personal folder, and sessions in one project open that project's handles once each.
A change still reaches every session and every probe as it does now, with each one's own wait and quiet.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "createClaudeCustomizationWatcher" packages` - two callers: `probeChanged` in `claude.ts` and a session in `servers.ts`.
- `rg -n "probeChanged" packages/sdk/src` - the host asks it once per provider, in `host.ts`.
- `rg -n "code://packages/agent-claude/src/session/watch.ts" .project/` - the plan that built the watcher, whose `implemented.md` limited the recursive watches because of their handle cost.

### Runtime path

```
claude() variant -> host.probeAgent -> probeChanged -> createClaudeCustomizationWatcher(configDir)
session -> servers.ts -> createClaudeCustomizationWatcher(configDir, cwd)
  -> opened(folder) -> fs.watch, one per call per folder   (today)
  -> holdFolder(folder) -> one fs.watch per folder, one listener per watcher   (after)
  -> each watcher's own filters, quiet and wait -> its onChange
```

### Gaps

- With K variants and N sessions on one personal folder, that folder is watched K + N times.
- A scope that exists costs up to six handles, and a session up to thirteen.
- On Linux, Node's recursive watch adds an inotify watch per subfolder, so each repeat costs the whole tree again.
- No test counts the handles the watcher opens.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The Claude folder watches are shared through a registry in watch.ts](../../../decisions/the-claude-folder-watches-are-shared-in-watch-ts.md) | Softov, 2026-11-09 |
| 2 | [Every Claude folder watch goes through the registry](../../../decisions/every-claude-folder-watch-goes-through-the-registry.md) | Softov, 2026-11-09 |

| What | Source | Task |
| --- | --- | --- |
| The key is the resolved path plus the recursive flag, compared case-sensitively only on Linux | (defaulted: `keyOf` in `filecompletions.ts:59`) | 01 |
| A folder made again opens a fresh handle for its key, and every listener moves to it | (defaulted: a removed folder's old handle hears nothing on Linux, so a holder that reused it would go deaf) | 01 |
| A shared handle's `error` closes it and drops it for every holder, and nothing throws | (defaulted: what one handle's `error` does today, `watch.ts:102-106`) | 01 |
| Each watcher keeps its own filters, `quiet`, `waitMs` and burst timer | the callers do not change, decision 1 | 01 |
| A test counts the handles by wrapping `node:fs`'s `watch` with `vi.mock`, and `watch.ts` exports nothing for tests | (defaulted: no test-only export) | 01 |

## Proposed architecture

- **Data flow** - `holdFolder(at, recursive, listener, fresh)` in `watch.ts` opens a folder's one `fs.watch`, or adds the listener to the one open, and returns the function that lets go. A handle's events go to every listener it holds.
- **Event flow** - unchanged: each watcher filters the names it hears and calls its own `onChange` after its own wait.
- **State flow** - a module-level `Map<string, Shared>` of open handles; an entry goes when its last listener lets go or its handle fails.
- **Layer responsibilities** - agent-claude: `watch.ts` owns the registry and the watcher; `claude.ts` and `servers.ts` are unchanged.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/watch.ts`](../../../../packages/agent-claude/src/session/watch.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - One handle per folder](task-01-one-handle-per-folder.md) | done | - |
| [02 - The handles are counted on a running daemon](task-02-the-handles-are-counted-on-a-running-daemon.md) | doing | 01 |

## Risks and tradeoffs

- One holder that reopens a folder moves every holder to the new handle - that is the point of `fresh`, and a case covers two watchers hearing a folder made again.
- A handle that fails is gone for every holder until one of them opens the folder again - the same as today for one watcher; a case covers it.
- Module-level state survives across tests in one file - each case closes its watchers, and a case checks that the last close leaves no handle open.

## Resume state

- **Done so far:** task 01 on 2026-11-09; task 02's README sentence and the watcher's own handle counts on 2026-11-09.
- **Next action:** steps 1 to 4 of [task-02-the-handles-are-counted-on-a-running-daemon.md](task-02-the-handles-are-counted-on-a-running-daemon.md) on a running dev daemon, by hand, then `implemented.md`.
- **Open questions:** none.
- **Watch out for:** a folder made again cannot be told by its inode, which Linux reuses; `fresh` from `folder` is what reopens it, and `young` keeps one change from reopening it once per holder.

## Final verification checklist

- [ ] `pnpm typecheck` is clean.
- [ ] `packages/agent-claude/test/watch.test.ts` passes on Windows with Node 22, and the whole suite passes in CI.
- [ ] Task 02's counts are written in `implemented.md`.
