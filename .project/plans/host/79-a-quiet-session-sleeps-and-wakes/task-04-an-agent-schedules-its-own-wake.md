---
title: An agent schedules its own wake
status: todo
depends: [task-02-a-sleeping-session-wakes.md]
layer: "sdk host, sdk tools"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L567](../../../../packages/sdk/src/tools/session.ts#L567) - `send_message`, the pattern for a host tool an agent calls"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts) - the schedule clock with an injectable timer, which the wake clock mirrors"
  - "[code://packages/sdk/src/types/sessions.ts#L47-L72](../../../../packages/sdk/src/types/sessions.ts#L47-L72) - `StoredChat`, which gains the wake"
---

## Objective

An agent calls the host tool `schedule_wakeup` with a delay and a prompt.
When it is due, the host wakes a sleeping session and begins a turn on that chat with the prompt.
The wake survives a daemon restart.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:47-72` - add `wake?: { at: number; prompt: string }` to `StoredChat`.
- `CREATE: packages/sdk/src/host/wakes.ts` - the wake clock: it loads the stored wakes, arms one timer for the next due, and fires `wake` and a turn.
- `UPDATE: packages/sdk/src/tools/session.ts` - the `schedule_wakeup` tool, with `delaySeconds`, `prompt` and `stop`.
- `UPDATE: packages/sdk/src/host.ts` - start the wake clock in `createHost` and stop it in `Host.close`.
- `CREATE: packages/sdk/test/session-wakeup-tool.test.ts` - the cases below.

## Steps

1. Write the cases in `session-wakeup-tool.test.ts` first, with the injectable clock.
2. Add `schedule_wakeup` in the pattern of `send_message`, scoped to the calling chat.
3. Store the wake on the chat's `StoredChat` record; a new call replaces the old wake.
4. Remove the stored wake when the call has `stop: true`.
5. Load every stored wake when the host starts, and arm one timer for the earliest.
6. When a wake is due, clear it from the record, call `wake(uri, chat)`, and begin a turn with its prompt.
7. Begin a wake that was due while the daemon was down once, at start.
8. Do not count a host wake in `quiet`, so the session can sleep until it fires.
9. Say in the tool description that the wake survives sleep and a daemon restart.

## Validation

- `it('begins a turn with the prompt when the wake is due')`
- `it('wakes a sleeping session for its wake')`
- `it('replaces the wake on a second call, and cancels it with stop')`
- `it('fires a stored wake after the host restarts')`
- `it('fires a wake that fell due while the host was down once')`
- `it('lets a session with a pending host wake sleep')`
- Run the full gates from the plan. All pass.

## Resume
