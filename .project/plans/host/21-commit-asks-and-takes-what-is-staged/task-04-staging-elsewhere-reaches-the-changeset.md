---
title: The uncommitted changeset follows git, tool calls, client writes and terminals without waiting for a turn
status: implemented
depends: [task-03-commit-asks-first.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L951-L961](../../../../packages/sdk/src/changes.ts#L951-L961) - `refresh`, which compares only the summary's counts"
  - "[code://packages/sdk/src/host.ts#L2420-L2434](../../../../packages/sdk/src/host.ts#L2420-L2434) - `contentMoved`, which re-sends files and operations"
  - "[code://packages/sdk/src/host.ts#L2776-L2798](../../../../packages/sdk/src/host.ts#L2776-L2798) - `refreshFacts`, the refresh a finished turn runs today"
  - "[code://packages/sdk/src/host.ts#L3040-L3048](../../../../packages/sdk/src/host.ts#L3040-L3048) - where a session's actions pass through the host, and a finished turn calls `refreshFacts`"
  - "[code://packages/sdk/src/host.ts#L4192-L4200](../../../../packages/sdk/src/host.ts#L4192-L4200) - a terminal's `terminal/exited`"
  - "[code://packages/sdk/src/host.ts#L6597-L6668](../../../../packages/sdk/src/host.ts#L6597-L6668) - `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove` and `resourceCopy`"
---

## Objective

The uncommitted changeset's rows and Commit's confirmation follow what happens to the tree between turns and during one: staging, committing or checking out from VS Code's Source Control or a terminal, a tool call that finishes, a file a client writes through the host, and a command in a terminal the host runs.
No trigger costs anything when no client watches that directory's changesets.

## Files

- `UPDATE: packages/sdk/src/changes.ts:951-961` - `refresh` reports a move when any row's staging changes, not only the counts.
- `UPDATE: packages/sdk/src/changes.ts` - a watch on the repository's `index` and `HEAD`, opened per directory a session works in and closed with the last one.
- `UPDATE: packages/sdk/src/host.ts` - one coalescing refresh per directory, called from each trigger below.
- `UPDATE: packages/sdk/test/commit.test.ts` and a host case - the cases below.

## Steps

1. `refresh` compares the rows' staging as well as the summary, so a change to the index alone is a move.
2. A coalescing refresh per directory: when no connection watches a changeset of a session in that directory, it does nothing.
   Otherwise one refresh runs at a time and at most one more waits behind it, so a burst of triggers is two refreshes at most.
   A move calls `contentMoved` for every session in the directory.
3. The triggers, each calling it:
   - the git directory's `index` and `HEAD`, found with `git rev-parse --git-dir` and watched with `fs.watch`, debounced, since one `git add` writes the index more than once;
   - a `chat/toolCallComplete` passing through the host from a session's backend, for that session's directory;
   - `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove` and `resourceCopy` on a `file:` URI inside a session's directory, after the store answers;
   - `terminal/exited` on a terminal whose working directory is inside a session's directory.
4. Close the watcher when no session works in the directory, and on a watcher error fall back to the other triggers.
5. A finished turn keeps the refresh it has.

## Validation

- Git: a host watching the uncommitted changeset, then `git add a.txt` run outside the host, and within the case's wait a `changeset/operationsChanged` arrives whose `commit` confirmation counts `a.txt` as staged.
  Today nothing arrives until a turn ends.
- Tool call: a scripted backend that writes a file and completes a tool call mid-turn, and the changeset gains the file before `chat/turnComplete`.
- Client write: `resourceWrite` of a new file inside the directory, and the changeset gains it with no turn.
- Terminal: a terminal that runs `git commit -am x` in the directory, and on its exit the changeset is empty.
- Unwatched: with no connection watching a changeset, ten tool calls run no `git status`, counted through a spy on the source's `refresh`.
- Coalesced: twenty triggers in one tick run `refresh` at most twice.
- `pnpm typecheck` and `pnpm test` green.

## Resume

Implemented 2026-09-27. Every case was written first and seen to fail: the git case arrived with no move while the watcher was not started, the tool-call and client-write cases never moved with their trigger off, and the terminal case needed the client `createTerminal` exit trigger, which only the tool and backend terminals had.

`refresh` compares the rows' staging as well as the summary (`treeSignature` in `changes.ts`), so `git add` alone is a move. `ChangesetSource.watch` is new: `changes.ts` watches the git directory found with `git rev-parse --absolute-git-dir`, debounces its own events, and closes the handle when the host releases it. The host keeps one coalescing re-read per directory (`refreshWatched`): an unwatched directory runs no git, one re-read runs at a time with at most one waiting behind it, and a move sends `session/changesetsChanged` plus `contentMoved` for every session there. The triggers are the source watch (started when a changeset is first read, stopped on the last unsubscribe), `chat/toolCallComplete`, `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove` and `resourceCopy` inside a session's directory, and `terminal/exited` on the tool, backend and client terminals. A finished turn keeps `refreshFacts`.

A one-file changeset comes back as `changeset/contentChanged` rather than `changeset/operationsChanged` because `sameFiles` includes `_meta`; the verbs ride along either way, and the git case reads them from whichever action carried them.

`packages/sdk/test/changes-refresh.test.ts`: 6 passed.
`pnpm typecheck`, `pnpm boundary` and `pnpm test`: 103 files, 1359 tests passed. One `agent-cofold` case flaked in a loaded full run and passes on its own.
