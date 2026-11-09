---
title: A Claude session from VS Code has no owner, so the owner's command check never applies
status: open
date: 2026-10-20
severity: major
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L932-L933](../../packages/sdk/src/host/spawn.ts#L932-L933) - `getAutoApproval` gives no answer when the sender is not the session's owner"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1013](../../packages/sdk/src/host/sessionmethods.ts#L1013) - `createSession` passes the connection's owner to `openSession`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1622](../../packages/sdk/src/host/lifecycle.ts#L1622) - `openSession` writes the owner"
  - "[code://packages/sdk/src/host/owners.ts#L206](../../packages/sdk/src/host/owners.ts#L206) - the scope, which `createSession` also always writes"
  - "[code://packages/sdk/src/host/spawn.ts#L560](../../packages/sdk/src/host/spawn.ts#L560) - `keepProvider`, which writes a record for any session that starts"
---

## Symptom

Softov's daemon runs with a `users` file and the `vscode` terminal defaults.
In a Claude session from VS Code in Ask Before Edits mode, `pnpm ls --depth 0` asks.
The `vscode` defaults approve that command, so it must run with no question.

The session records show why.
Five Claude sessions from VS Code on 2026-10-20 have no `owner`, no `scope` and no `pullRequests` in `<configDir>/sessions/<id>.json`: `2960f170`, `8f45ce8a`, `878eff2e`, `4e69d1e3` and `df5495f4`.
Each has turns, a provider and senders `root:soft-sandbox`.
The pi session `5e8fcdfc` from the same VS Code on the same day has all three fields.

## Cause

Partly known.
With a `users` file, `getAutoApproval` approves only when the sender owns the session.
A session with no owner never matches, so every command asks.

`createSession` always writes the owner, the scope and the pull request baseline.
A record with none of them was written by a path other than `createSession`.
That path is not found yet.

What was ruled out, on a second daemon built from `main` at `11f5efa6` with a `users` file:

- `ahpc session new --agent claude` writes the owner `root:soft-sandbox`, and a turn keeps it.
- A disposed session forgets its record, and a turn sent to it does not run.
- The move of a chat to a new session copies the source's owner, and the sources here are not moves.

Two Claude records from VS Code on 2026-10-19, `3717bfcd` and `c05b2d61`, have the owner and no turns, and Claude has no transcript for them.
VS Code makes a provisional session before the first message, so these are likely provisionals that never ran.

## Impact

Since 4c3738f08, every turn reads the host's terminal rules whoever sent it, so the command check no longer depends on the owner.
A session from VS Code on a host with users still has no owner.
What else reads a session's owner was not checked again.

## Workaround

None. Approve each command by hand.

## Fix

No fix is chosen, because the cause is not found.

1. Log the method and the session URI of each request in development, then run one Claude session from VS Code. The log shows the path.
2. Write the owner on every path that makes a record, so a session with no owner is only one that nobody owns.
