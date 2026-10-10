---
title: The agents share their status, activity, title and preset reading, and the host checks tool inputs and request params one way - implemented
date: 2026-10-10
refs:
  - git://79a59d9
  - "[code://packages/sdk/src/catalog.ts](../../../../packages/sdk/src/catalog.ts)"
  - "[code://packages/sdk/src/vault.ts](../../../../packages/sdk/src/vault.ts)"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts)"
  - "[code://packages/sdk/src/toolinput.ts](../../../../packages/sdk/src/toolinput.ts)"
  - "[code://packages/sdk/src/rpc.ts](../../../../packages/sdk/src/rpc.ts)"
---

The four agent backends read a session's status, say its activity and title it from the first message through one set of sdk helpers. The acp and claude plugins read their presets through one loop and one pair of reference readers. The host's tools read their input one way, and its request handlers read their params one way.

## What was built

- [`code://packages/sdk/src/catalog.ts`](../../../../packages/sdk/src/catalog.ts) - `statusOf`, `activityOf` and `titleFrom`, which every backend calls.
- [`code://packages/sdk/src/vault.ts`](../../../../packages/sdk/src/vault.ts) - `fromEnvRef` and `readSecrets`, which the acp and claude presets read their `env` with.
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts) - `eachPreset`, the loop that registers what builds and says one line for each preset it drops.
- [`code://packages/sdk/src/toolinput.ts`](../../../../packages/sdk/src/toolinput.ts) - the tool-input readers of task 05.
- [`code://packages/sdk/src/rpc.ts`](../../../../packages/sdk/src/rpc.ts) - `INVALID_PARAMS` and the request-param readers of task 06.

## Verified

- `packages/sdk/test/session-kit.test.ts` (14 cases) covers `statusOf`, `activityOf` and `titleFrom`.
- `vault.test.ts` covers `fromEnvRef` and `readSecrets`, and `plugin-host.test.ts` covers `eachPreset`.
- New title tests in acp, cofold and pi, and a claude preset test for a `fromEnv` object with another key.
- The existing agent tests are unchanged and pass.
- Every grep in the plan's Final verification checklist finds nothing.
- The full gates pass on the review tree.

## Departures from the plan

- Task 02 step 4 applies to acp and pi only: claude and cofold have no title that the agent gives.
- `packages/agent-claude/src/models.ts` still reads a model entry's `key.fromEnv` with other keys allowed, because the plan's refs do not name it.

## Left for later

- None.
