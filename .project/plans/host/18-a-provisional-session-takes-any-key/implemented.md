---
title: A session takes any key until its first turn, and shows the fixed ones after - implemented
date: 2026-09-26
refs:
  - git://5bb80ae
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the live `session/configChanged`, the per-session `restarting` hold, and `runningSchema`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `computer` declares `sessionMutable: false`"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - pi publishes the host's schema, so contributed keys show"
  - "[code://test/session-fixed-key.test.ts](../../../../test/session-fixed-key.test.ts) - the nine cases"
---

A computer, or any other fixed key, picked in VS Code's New view is the one the session runs with: a change before the first turn restarts the session, and the first turn waits for it.
After the first turn every fixed key is shown as a read-only chip, and a change to one is refused.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a fixed key that moves before the first turn restarts the session, with actions held until the restart ends and a failed restart answered to the turn that waited; after the first turn the change is refused and the stored value restored. `runningSchema` marks fixed keys `sessionMutable: true, readOnly: true` in the schema a running session publishes.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the `computer` key is fixed.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - pi publishes the schema it is handed.

## Verified

- `test/session-fixed-key.test.ts`: nine cases, among them the restart and the turn landing on it, a failed restart answered to the waiting turn, no restart for an unchanged value or an unsent default, refusal after the first turn, a refused value not kept for the next chat, the read-only running schema, and a contributed key treated the same. The review cases were mutation-checked.
- Softov in VS Code 1.139.1 on 2026-09-26: the computer picked in New before the first send is the one the session runs on, and after the first turn `computer://lulu`, the output style and thinking show as read-only chips.
- `pnpm test` 87 files / 1141 tests, `pnpm typecheck`, `pnpm boundary` green on 2026-09-26.

## Departures from the plan

- None.

## Left for later

- The running chip shows the raw `computer://lulu` rather than the picker's label, because the running schema carries no enum seed.
- `ahpc` has not been checked against the read-only running schema, as the plan's risks note.
