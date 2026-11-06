---
title: The channel keeps each connector's health
status: done
depends: [task-01-the-types-carry-a-check-and-health.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L355-L369](../../../../packages/sdk/src/connectors/channel.ts#L355-L369) - `openOne`, after which the check runs"
  - "[code://packages/sdk/src/connectors/channel.ts#L380-L398](../../../../packages/sdk/src/connectors/channel.ts#L380-L398) - `run`, which records each action call"
  - "[code://packages/sdk/src/connectors/channel.ts#L226-L234](../../../../packages/sdk/src/connectors/channel.ts#L226-L234) - `connectorRow`, which gets the `health` key"
  - "[code://packages/sdk/src/connectors/channel.ts#L102-L131](../../../../packages/sdk/src/connectors/channel.ts#L102-L131) - `ConnectorsChannel`, which gets `note` and `check`"
  - "[code://packages/sdk/src/connectors/channel.ts#L481-L561](../../../../packages/sdk/src/connectors/channel.ts#L481-L561) - the put command, the pattern for the check command"
---

## Objective

The connectors channel keeps each open connector's health in memory and sends it on the row as `health`.
Health holds the last check, the last call and the last failure.
A client can run the check again with `x-ahpd/connectors/check`.

## Files

- `UPDATE: packages/sdk/src/connectors/channel.ts` - a health map, the check after each open, `note`, the outcome of `run`, the check command and the `health` key on a row.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - cases for each rule below, with a fake adapter that has a `check`.

## Steps

1. Keep a `Map<string, ConnectorHealth>` beside `open`, and delete an entry when its connector closes.
2. Write `checkOne(id)`, which calls the adapter's `check` with the opened connector and stores the result with the time.
3. Treat a check that throws as `failed`, with the error's message.
4. Treat a check that takes more than 10 seconds as `unreachable`.
5. Skip `checkOne` for an adapter with no `check`.
6. Await `checkOne` in the put, after `openOne`, so the put's answer carries the result.
7. Start `checkOne` for each connector in `openAll` without waiting, and refresh when each one ends.
8. Write `note(id, outcome)` on `ConnectorsChannel`, which sets `lastCall`, and sets `lastFailure` when `ok` is false.
9. Cut an `error` longer than 500 characters to 500 in `note`.
10. Record each `run` with `note`: `ok` when the adapter answers, and the error's message when it throws, then rethrow.
11. Send at most one refresh each second for changes from `note`.
12. Add `health` to `connectorRow` when the map holds an entry for that id.
13. Add `x-ahpd/connectors/check`, which takes `{ id }`, runs `checkOne` and answers the row.
14. Give the check command the grant `connector:put`, and apply the owner's rule, as the put does.
15. Answer `INVALID_PARAMS` for a check of a connector that is not open, or whose adapter has no `check`.
16. Add the test cases with a fake clock or short waits, so the suite stays fast.

## Validation

- The new cases pass: a put answers `health.check`, a failed `run` sets `lastFailure`, and `note` sets `lastCall`.
- A case shows a check that hangs answers `unreachable`, and one that throws answers `failed`.
- A case shows a remove drops the health, and a reader that is not the owner cannot run the check.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Resume

- **Done so far:** the channel keeps a `Map<string, ConnectorHealth>` beside `open` and drops an entry when its connector closes or is removed. `checkOne` asks the adapter of an open connector and keeps `{ ...result, at }` under `check`. A connector that is not open, or whose adapter has no `check`, gets `undefined`. `within` races the check against ten seconds and answers `unreachable`, and a check that throws is `failed` with its message. A put awaits `checkOne` after `openOne`, so its answer carries the result, and `openAll` starts one without waiting and refreshes when it ends. `note(id, outcome)` sets `lastCall` and, when the call failed, `lastFailure`, with an error cut to 500 characters. `run` notes each action, `ok` on an answer and the thrown message before it rethrows. A refresh from `note` waits for the end of the second and sends one row set per second. `connectorRow` adds `health` only when the map holds the id. `x-ahpd/connectors/check` takes `{ id }` and takes `connector:put` with the owner's rule. It answers `INVALID_PARAMS` for a connector that is not open, or one whose adapter has no check. Otherwise it runs the check and answers the row.
- **Next action:** [task-04-the-docs-say-how-health-shows.md](task-04-the-docs-say-how-health-shows.md).
- **Files:** `packages/sdk/src/connectors/channel.ts`, `packages/sdk/test/connectors-channel.test.ts`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** none. The refresh throttle is a trailing timer of one second from the last send. The first call after a quiet second sends at once, and the calls inside the second share one send.
- **Watch out for:** a throwing check becomes a `failed` result, so a put never fails for a service that answers badly. Only an open that throws still throws. The fake-clock cases advance 1000 ms after the work, because the refresh is trailing.
