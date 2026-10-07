---
title: close() awaits the host's own machine leaves
status: done
depends: [task-01-a-plugin-can-register-a-close.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/machines.ts#L143-L153](../../../../packages/sdk/src/host/machines.ts#L143-L153) - `inMachine`, which starts an enter or a leave and does not keep the promise"
  - "[code://packages/sdk/src/host.ts#L857-L890](../../../../packages/sdk/src/host.ts#L857-L890) - `close`"
---

## Objective

When `host.close()` resolves, no machine enter or leave that the host started is still running.
A daemon that stops brings a machine's work back before it exits.

## Files

- `UPDATE: packages/sdk/src/host/machines.ts:143-153` - `inMachine` keeps each promise in a set and deletes it when it settles. Add `settled(): Promise<void>`, which awaits every promise in the set until the set is empty.
- `UPDATE: packages/sdk/src/host.ts:857-890` - after the chats close and before the plugin closers, run `await step('the machine leaves', () => machines.settled())`.
- `UPDATE: packages/computer/test/support/closing.ts` and its callers - remove the wait for a quiet folder. Close the hosts, then remove the folders.

## Steps

1. Keep the promises in `inMachine`. A session start still does not wait for them.
2. Add `settled` and call it in `close`.
3. Remove the test-side quiet wait.

## Validation

- `packages/sdk/test/host-close.test.ts`: a `computers.bringBack` that resolves 200 ms later has resolved when `close()` resolves.
- The probe from task 03 finds no file written after close in any computer test file.
- `npx vitest run packages/computer` passes 10 times in a row, with nothing else running.

## Resume

- `inMachine` in `packages/sdk/src/host/machines.ts` keeps every enter and leave it starts in a set of promises, and takes each one out when it settles. `settled()` awaits that set, and looks at it again after each round, so nothing started while it waited is left behind.
- The promise is built with `Promise.resolve().then(...)` and its failure is logged on the promise itself. A port that throws before it answers is then the same failure as one that rejects after. A `try` around the call would have caught only the first of the two.
- Nothing in `settled` throws: by the time a promise settles, a failure is already a line in the log.
- `packages/sdk/src/host.ts` awaits `settled` in `close`, as the step `the machine leaves`, after the chats and their starting runs and before the plugin closers. A plugin's own close takes its machines apart, and a machine still being read is one nothing should remove.
- A session's own disposal still does not wait for its leave: the port's `bringBack` runs behind the answer that asked for it. What changed is only that `close` waits.
- `packages/computer/test/support/closing.ts` no longer waits for a quiet folder. The helper closes every host, then every hostless load through its closers, then the launchers. The eleven files that call it remove their folders after that. `atRest`, `newestWrite`, `STILL_MS`, `GIVE_UP_MS` and the captured clock went with it.
- `leftOver()` in `computer-disposable.test.ts` still polls. The run shares one temporary directory, and the plugin's `mkdtempSync(join(tmpdir(), 'ahpd-bringback-'))` is there for as long as any file's fetch takes. A neighbour's fetch is therefore in the answer whatever `close()` waits for.
- `packages/sdk/test/host-close.test.ts` holds the case: a `bringBack` that answers after 200 ms has answered, and its `leave` has run, by the time `close()` resolves. It fails without the `settled` call.
