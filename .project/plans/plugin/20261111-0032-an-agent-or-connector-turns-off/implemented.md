---
title: An agent or connector turns off - implemented
date: 2026-11-11
refs:
  - git://510a25840
  - "[code://packages/sdk/src/types/agents.ts](../../../../packages/sdk/src/types/agents.ts)"
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts)"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts)"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md)"
---

An agent record and a connector record now turn off and on without being removed. A record that is off is not opened, so the host reads no key and runs no probe for it. Its row is `disabled` with no alerts. A session on an agent that is off keeps its history and refuses a new message until the agent is on again. A connector that is off answers no call and lists no model, and stays a valid reference.

## What was built

- [`code://packages/sdk/src/types/agents.ts`](../../../../packages/sdk/src/types/agents.ts) - `AgentState` gains `disabled`, and `AgentRecord` carries `enabled?: boolean`.
- [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts) - `x-ahpd/agents/enable` and `x-ahpd/agents/disable`, which answer the row. `sync` leaves a disabled record out of the open list without ending its sessions, `put` carries the stored `enabled` over, and `stateOf` answers `disabled` first.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `HostOptions.disabledAgents`, the set of ids whose record is off.
- [`code://packages/sdk/src/host/common.ts`](../../../../packages/sdk/src/host/common.ts) - `turnedOff(provider)`, the one sentence a refusal uses.
- [`code://packages/sdk/src/agents/usable.ts`](../../../../packages/sdk/src/agents/usable.ts) - `isDisabled`, the check every refusal calls.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - the root's agent list leaves out a disabled agent, and `replace` publishes the list again when the set changes.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - a new session and a turn on a disabled agent are refused through the turn's own error.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `createSession` and `createChat` refuse a disabled agent, and a chat move to one is refused with `data.reason` `agentUnavailable`.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - the tool paths that open a chat or a session refuse a disabled agent.
- [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - a wake of a stored session whose agent is off answers `SessionNotFound` with the sentence.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - `x-ahpd/connectors/enable` and `x-ahpd/connectors/disable`. `disable` closes the connector and writes `enabled: false`; `enable` writes it back on and opens and checks it. `stateOf` answers `disabled`, `put` keeps the stored `enabled` and refuses an `enabled` parameter, and `openAll` skips a record that is off.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon passes `disabledAgents: () => agentLists.disabled()`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) and [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - the two states, the four commands, the `enabled` field and the release notes.
- [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md) - the `disabledAgents` option.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` passed.
- `packages/sdk` ran 237 files: 236 passed and 1 failed. 4725 tests passed, 5 were skipped, and 2 failed in `host-permissions.test.ts`. Both are the edit-approval cases that need a tmpdir outside the home, and they fail the same way without this change.
- `packages/server` passed all 94 files: 1871 tests passed and 3 were skipped.
- `packages/sdk/test/fixtures/wire.jsonl` was unchanged after both suites.
- The new cases are in `agents-channel.test.ts`, `connectors-channel.test.ts` and `host-disabled-agent.test.ts`. They cover each case in the tasks' *Validation* and each item of the plan's checklist. The cases include the root list, a refused session, chat and turn, the same session running once the agent is on, an off record with no alert for its missing key, and a connector that lists no model and fails an action.

## Departures from the plan

- The plan fixes the sentence of each refusal and not its code. A new session and a new chat answer `-32002`. A chat move answers `INVALID_PARAMS` with `data.reason` `agentUnavailable`. A wake answers `SessionNotFound`, and a refused turn answers the chat's own `chat/error` with `sendFailed`.
- A connector `put` refuses an `enabled` parameter with `INVALID_PARAMS`, as an agent put does. Task 03 names the field; the refusal is the same rule as task 01's.
- After a restart with a record off, no backend is opened for the agent. The catalogue then has no agent to read a stored session's transcript, and the session is not listed. The restart case hands the second host the same echo instance, as a host that held the session when the agent was turned off runs. The refusal is read from the session's record, so it does not depend on the backend.
- The harness denied every `TMPDIR=`-prefixed command and every `npx`, so the suites ran as `pnpm exec vitest run ... --maxWorkers=6 --testTimeout=20000`, one at a time.

## Left for later

- Listing a stored session whose record is off and whose backend is not registered. The plan does not answer it, and the listing is unchanged.
- The switch in ahpw's agent and connector pages, which is its own plan. The methods work from ahpc and the MCP tools now.
- A backend kept for its open sessions still holds the key it read, until its last session ends.
