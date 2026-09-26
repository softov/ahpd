---
title: A fixed key restarts a session that has not started
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7477-L7560](../../../../packages/sdk/src/host.ts#L7477-L7560) - the live `session/configChanged`, and its `HOSTS_OWN` restart to follow"
  - "[code://packages/sdk/src/host.ts#L3157-L3167](../../../../packages/sdk/src/host.ts#L3157-L3167) - `propertyOf`"
  - "[code://packages/sdk/src/host.ts#L6816](../../../../packages/sdk/src/host.ts#L6816) - `applyDispatch`"
  - "[code://packages/computer/src/plugin.ts#L297-L301](../../../../packages/computer/src/plugin.ts#L297-L301) - the `computer` key"
  - "[code://test/computer-session.test.ts](../../../../test/computer-session.test.ts) - a session on a computer, the harness to reuse"
---

## Objective

Before a session's first turn, a `session/configChanged` that moves a key marked `sessionMutable: false` restarts the session with the new value, and the turn that follows runs in the restarted session.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `propertyOf` reads the contributed keys too; the live `session/configChanged` restarts for a changed fixed key before the first turn; actions for a session wait while it restarts.
- `UPDATE: packages/computer/src/plugin.ts` - `computer` declares `sessionMutable: false`.
- `CREATE: test/session-fixed-key.test.ts` - the cases under *Validation*.

## Steps

1. `propertyOf` looks the key up in `sessionSchema(agent).properties`, so a key from `options.sessionConfig` is found; the backend's own property still wins where both declare one.
2. In the live `session/configChanged`, read each key's previous value from `owning.config` before the loop that writes it.
3. Collect the fixed keys: not in `HOSTS_OWN`, `propertyOf(...)?.sessionMutable === false`, and a value that differs from the previous one.
4. When there are any and no chat has a turn, fold them into the same restart the `HOSTS_OWN` keys take (one restart for both), then dispatch each changed key after it, as that path does. `restart` re-spawns with `held.config`, which already holds the new values.
5. When a turn has started, refuse with "`<key>` is fixed once the session has started", as for `isolation`. Keep "is fixed when the session is created" only if some path still needs it; otherwise the one message covers both.
6. Keep a per-session `restarting` promise. `applyDispatch` for a channel that belongs to a session with one pending re-runs itself when the promise settles, so the first turn lands in the new backend. On a failed restart, the waiting action gets the failure the way a refused one does.
7. Leave the unheld path (a session with no agent yet) as it is: it stores the value and the resume spawns with it.

## Validation

- A session created with `computer: A`, then `session/configChanged { computer: B }` and a turn sent without waiting, runs the turn on B, and the backend was spawned twice.
- The same `session/configChanged` with `computer: A` again does not restart.
- After a turn, `session/configChanged { computer: B }` is refused and the session keeps A.
- A backend key with `sessionMutable: false` (a fake agent's schema) behaves the same, without the computer plugin.
- A mutable key before the first turn still goes to `session.setConfig` and does not restart.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

Implemented 2026-09-26.
- `propertyOf` finds a contributed key as well as the backend's own, and a fixed key is collected when its value moved.
- The live `session/configChanged` reads each key's previous value before writing it, and folds the fixed keys into the one restart the `HOSTS_OWN` keys already take.
- A per-session `restarting` promise holds a client action while the backend is started again, and a failed restart answers the waiting action with its reason.
- `computer` declares `sessionMutable: false`.
- Found: the plan said to read `sessionSchema(agent)` in `propertyOf`, but `published` strips `scope` on the way out, so the lookup merges the two raw schemas instead and the backend's own property still wins.
- Found: a fixed key sent with the value it already holds is not a change, so it is neither restarted nor refused. `test/notes.test.ts` pinned the old refusal of every immutable key and now runs a turn first.
- Tests: `test/session-fixed-key.test.ts`, seven cases.
- Left: the end-to-end check in a real VS Code window, which the verifier runs.

- Review fixes, 2026-09-26: a refused key is put back in the session's config, so a chat opened afterwards no longer spawns with the refused value; and "did it move" compares against the value in effect with the agent's and the plugins' defaults, so re-sending a default does not restart. Two cases added to `test/session-fixed-key.test.ts`, each checked to fail without its fix.
