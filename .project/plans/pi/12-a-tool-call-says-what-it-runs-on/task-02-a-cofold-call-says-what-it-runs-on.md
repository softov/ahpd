---
title: A cofold call says what it runs on, live and replayed
status: implemented
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L267-L296](../../../../packages/agent-cofold/src/tools.ts#L267-L296) - `toolReadyAction` and `toolCompleteAction`"
  - "[code://packages/agent-cofold/src/mapping.ts#L487-L540](../../../../packages/agent-cofold/src/mapping.ts#L487-L540) - `invocationMessage` and `pastTenseMessage` from `held.name`"
  - "[code://packages/agent-cofold/src/transcript.ts#L84-L146](../../../../packages/agent-cofold/src/transcript.ts#L84-L146) - the transcript's `invocationOf` and `pastTenseMessage`"
---

## Objective

A cofold call's `invocationMessage` and `pastTenseMessage` are its command, path, pattern, URL or query, live and read back.

## Files

- `UPDATE: packages/agent-cofold/src/tools.ts` - `describe(name, input)` per the plan's table, used by `toolReadyAction` and `toolCompleteAction`.
- `UPDATE: packages/agent-cofold/src/mapping.ts`, `packages/agent-cofold/src/transcript.ts` - the same where they fall back to the name; an approval's prompt stays the confirmation title.
- `UPDATE: packages/agent-cofold/test/` - the cases below.

## Steps

1. Live and read-back messages match for the same call.

## Validation

- `shell_exec` with `ls` has `ls` for both messages, `read_file` of `a.ts` has `a.ts`, `web_fetch` has its URL, live and from the transcript; each fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Done:** `describe(name, input)` in `packages/agent-cofold/src/tools.ts` per the plan's table; an empty or missing argument, or any other tool, keeps the name.
- `toolReadyAction` titles the call with `describe`; `toolCompleteAction` takes the call's input as a new optional last argument and titles `pastTenseMessage` with `describe`.
- In `mapping.ts`, `tool.started` falls back to `describe` where it fell back to the name (an approval's prompt still wins, as before), and `tool.completed` and `tool.denied` title `pastTenseMessage` with `describe` and hand `toolCompleteAction` the held input. `approval.requested` is untouched: its prompt stays the confirmation title and the invocation.
- In `transcript.ts`, `invocationOf` falls back to `describe`, and `completeCall` takes what the call was described as, kept per call id in a new `Building.said` map, since a result part carries no input.
- The `!command` terminal path readies a `terminal` call with a string input, which `describe` leaves as `terminal`, as before.
- **Tests:** in `packages/agent-cofold/test/agent-cofold-store.test.ts`: "draws a %s call by what it runs on, live and read back" (10 cases: the nine tools of the plan's table and `lookup`, which keeps its name), checking the ready and complete actions, the part a client folds from them, and the transcript's part. `played` takes the tools as an optional second argument; a `stub` tool stands in under each cofold name.
- **Failed first:** the nine described cases failed with the tool name where the argument was expected; `lookup` passed before and after.
- **Departures:** none.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1559 passed, 1 failed of 1560 in 108 files. The failure was `packages/computer/test/computer-disposable.test.ts` "removes the machine after the delay, and a session that picks it again cancels it", a fake-timer assertion in a package this task does not touch; the file alone passed 9 of 9. The next full run (after task 03) is in task 03's Resume.
