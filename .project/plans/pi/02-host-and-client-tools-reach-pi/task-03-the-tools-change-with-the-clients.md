---
title: The tools change with the clients
status: implemented
depends: [task-02-a-client-tool-is-run-by-that-client.md]
layer: "agent-pi"
refs:
  - "[code://packages/sdk/src/types/session.ts#L385-L398](../../../../packages/sdk/src/types/session.ts#L385-L398) - `setTools` replaces the list, and false means the backend could not"
  - "[code://packages/agent-claude/src/session.ts#L3274-L3285](../../../../packages/agent-claude/src/session.ts#L3274-L3285) - the sibling compares before and after, then re-declares"
  - "[code://packages/agent-cofold/src/session.ts#L1396-L1399](../../../../packages/agent-cofold/src/session.ts#L1396-L1399) - the other sibling keeps the list and uses it from the next turn"
  - "[code://packages/agent-pi/src/session.ts#L238-L274](../../../../packages/agent-pi/src/session.ts#L238-L274) - `opened`, the one place pi is built"
  - "[code://packages/agent-pi/src/backend.ts#L98-L107](../../../../packages/agent-pi/src/backend.ts#L98-L107) - `resumeOrCreate`, which reopens the same file by id"
---

## Objective

`setTools` on a pi session replaces the tools pi offers, from the next turn, rebuilding pi on the same session file when it is already open.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - `setTools` on the returned `Session`.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. Compare the new list to `offering` by name and owner, as the sibling does, and answer true with nothing to do when they match.
2. Before pi has opened, replace `offering` and answer true; `opened` reads it.
3. After pi has opened, replace `offering`, mark the backend stale, and answer true.
4. In `begin`, before `prompt`, a stale backend is closed and reopened with `resume` set to its own id, so the same session file continues with the new `customTools`; the subscription, the record and the model list move to the new backend. A turn already running is not touched.
5. A rebuild that fails fails that turn through `finish('error', ...)`, as an open that fails does today.

## Validation

- `test/agent-pi.test.ts`: `setTools` before the first turn changes what the fake's `open` receives.
- `setTools` after the first turn: the next turn reopens the fake with the same id as `resume` and the new tools; an unchanged list does not reopen.
- A `setTools` during a running turn takes effect on the turn after it.
- `pnpm test`, `pnpm typecheck` green.

## Resume

Built.
`session.ts` splits the old `opened` into `build(resume, first)`, `opened` and `reopen`.
`setTools` compares the new list to `offering` by name and owner, answers true with nothing to do when they match, replaces `offering`, and marks the backend stale when pi is already open.
`begin` rebuilds a stale backend before `prompt`, with `resume` set to its own id, so the same session file continues with the new `customTools`; a turn already running is not touched, and a rebuild that throws fails the turn.
The subscription, the record and the model list move to the rebuilt backend, and `first` keeps the configured model and the truncation to the session's own opening.

- `test/agent-pi.test.ts` covers a change before pi opens, a change after a turn rebuilding with the id as `resume` and the new tools, an unchanged list not reopening, and a change during a turn taking effect on the next one.
- `pnpm test` 102 files, 1364 tests; `pnpm typecheck` and `pnpm boundary` green.
