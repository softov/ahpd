---
title: A child that fails to start or exits is heard
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L55-L64](../../../../packages/agent-acp/src/connection.ts#L55-L64) - the spawn"
  - "[code://packages/agent-acp/src/catalog.ts#L116-L139](../../../../packages/agent-acp/src/catalog.ts#L116-L139) - the listing spawn"
---

## Objective

`connectAcp` listens for `error` and `exit` on the child, a start that fails rejects with a sentence naming the command, and every pending request rejects with the exit code; nothing reaches the process as an unhandled error.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts:55-64` - listeners, and a promise that settles when the child is gone.
- `UPDATE: packages/agent-acp/src/catalog.ts:116-139` - the listing survives a missing command and answers the watched sessions.
- `UPDATE: packages/agent-acp/test/` - a spec with a command that does not exist; a fixture that exits mid-prompt.

## Steps

1. Race `initialize` against the child's `error` and `exit`.
2. Reject open requests with `<command> exited with <code>` when the child goes.
3. Mark the connection dead so the session knows to reopen.

## Validation

- A missing command fails `create`'s first turn with the command in the sentence, and the test process is still alive.
- `list` with a missing command answers the watched sessions.
- A fixture that exits mid-prompt fails the turn with its exit code.

## Resume

- **Changed:** [`code://packages/agent-acp/src/connection.ts`](../../../../packages/agent-acp/src/connection.ts) listens for `error` and `exit` on the child and holds the reason in `ended`; every call races it, so a start that fails or a server that exits rejects each pending and later call with the sentence, never the SDK's `ACP connection closed`.
- **The sentences:** a missing program is `<command> was not found; install it, or put its directory on the PATH the daemon runs with`; a missing `cwd` is `<command> could not be started in <cwd>, which does not exist`; any other start failure is `<command> could not be started: <reason>`; an exit is `<command> exited with code <n>` or `<command> exited on <signal>`.
- **Stream closed before the exit:** a call the SDK fails because stdout closed waits up to one second for the exit, so the code is in the sentence.
- **Dead connection:** `AcpConnection.ended` ([`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts)) settles with the reason; [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) drops `live` and `opening` when it settles, so the turn after a death spawns a new server (still `session/new`; task 03 changes that).
- **catalog.ts unchanged:** `catalogueOf` already caught a failed `initialize`; the crash was the unheard `error` event, which `connectAcp` now hears. `rg -n "spawn\(" packages/agent-acp/src` finds only the spawn in `connection.ts`. `probe` spawns nothing and the plugin's load spawns nothing, so a missing command does not stop the daemon from starting.
- **Tests:** [`code://packages/agent-acp/test/agent-acp-failure.test.ts`](../../../../packages/agent-acp/test/agent-acp-failure.test.ts), four cases, each also asserting no `uncaughtException` or `unhandledRejection` reached the process; the fixture gained a `die` script that exits with code 3 mid-prompt.
- **Failed first, for the right reason:** the missing-command turn and the handshake failed with `ACP connection closed` instead of the command; `list` answered but the process-level listener caught `spawn ahpd-no-such-acp-server ENOENT`, the event that ends the daemon; the mid-prompt exit failed with `ACP connection closed` instead of `exited with code 3`.
- **Smoke:** a script outside vitest with `command: 'codex-acp'` listed `[]`, failed its turn with the sentence, and exited 0.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared); full `pnpm test` 109 files, 1600 tests passed, no flakes this run.
