---
title: An agent or connector turns off - implemented
date: 2026-11-11
refs:
  - git://99823cfad
  - "[code://packages/sdk/src/types/agents.ts](../../../../packages/sdk/src/types/agents.ts)"
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts)"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts)"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md)"
---

An agent record has three states in one `mode` field: `enabled`, `paused` and `disabled`. A paused record is still opened, so its keys are read, its probe runs and its alerts show. Its sessions keep their history and are listed. The host starts nothing new on it and answers `<id> is paused.` A disabled record is not opened, so its row is `disabled` with no alerts, its stored sessions are not listed after a restart, and the host answers `<id> is turned off.` A record written before `mode` with `enabled: false` reads as disabled. A connector keeps its boolean `enabled` and has no paused state. A connector that is off lists no model, answers no call, and stays a valid reference. Every off record keeps its backend while one of its sessions is still running.

## What was built

- [`code://packages/sdk/src/types/agents.ts`](../../../../packages/sdk/src/types/agents.ts) - `AgentMode` with `enabled`, `paused` and `disabled` and `AgentRecord.mode`, and `AgentState` with `paused` and `disabled`.
- [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts) - `x-ahpd/agents/enable`, `x-ahpd/agents/pause` and `x-ahpd/agents/disable`, which answer the row. `modeOf` reads `mode`, and a record that names none is enabled, and `stateOf` answers `disabled` and `paused` before the engine checks. `sync` opens a paused record as an enabled one and ends no sessions of either off state. `put` carries the stored `mode` or `enabled` over and refuses either parameter, and the channel returns `disabled()` and `paused()` sets.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `HostOptions.disabledAgents` and `HostOptions.pausedAgents`, the ids whose record is in each off state.
- [`code://packages/sdk/src/host/common.ts`](../../../../packages/sdk/src/host/common.ts) - `turnedOff(provider)`, `pausedAgent(provider)` and `agentRefusal(disabled, paused, provider)`, the one choice of sentence.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - the root's agent list leaves out a paused or disabled agent, and `replace` publishes the list again when the sets change.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - a new session and a turn on an agent in either off state are refused, the turn through the chat's own error.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `createSession` and `createChat` refuse either state, and a chat move to one is refused with `data.reason` `agentUnavailable`.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - the tool paths that open a chat or a session refuse either state.
- [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - a wake of a stored session whose agent is disabled answers `SessionNotFound` with the sentence; a paused session wakes and reads its turns.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - `x-ahpd/connectors/enable` and `x-ahpd/connectors/disable`. `disable` closes the connector and writes `enabled: false`; `enable` writes it back on and opens and checks it. `stateOf` answers `disabled`, `put` keeps the stored `enabled` and refuses an `enabled` parameter, and `openAll` skips a record that is off.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon passes `disabledAgents: () => agentLists.disabled()` and `pausedAgents: () => agentLists.paused()`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) and [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - the three states, the six commands, the `mode` field, the older `enabled` field and the release notes.
- [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md) - the `disabledAgents` and `pausedAgents` options, and what each state serves and refuses.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` passed.
- `packages/sdk` ran 237 files: 236 passed and 1 failed. 4735 tests passed, 5 were skipped, and 2 failed in `host-permissions.test.ts`. Both are the edit-approval cases that need a tmpdir outside the home, and they fail the same way without this change.
- `packages/server` passed all 94 files: 1871 tests passed and 3 were skipped.
- `packages/sdk/test/fixtures/wire.jsonl` was unchanged after both suites.
- The new cases are in `agents-channel.test.ts`, `connectors-channel.test.ts` and `host-disabled-agent.test.ts`. They cover each case in the tasks' *Validation* and each item of the plan's checklist.
- The host cases include the root list, a refused session, chat, tool, move and message for each off state. They also check that the same session runs once the record is on.
- The paused restart starts a second host with its own backend instance. It lists the stored session with its turns, refuses its message with `echo is paused.`, and runs a message once the record is on.
- The disabled restart starts the second host with no backend of the agent. It checks the stored session leaves the list, then turns the record on and checks the session and its turns come back.
- The channel cases include a paused record that stays open, keeps its alerts, moves between the three states, and ends no sessions. They also include a connector that lists no model and fails an action, and a record with `enabled: false` that reads as disabled.

## Departures from the plan

- The plan names `disabledAgents` and not `pausedAgents`. The two states answer different sentences, so the host reads the paused ids through a second option of the same shape. That option is `pausedAgents?: () => ReadonlySet<string>`, and `agentRefusal` chooses between the two sentences.
- The plan fixes the sentence of each refusal and not its code. A new session and a new chat answer `-32002`. A tool path throws an `Error` with the sentence. A chat move answers `INVALID_PARAMS` with `data.reason` `agentUnavailable`. A wake of a disabled session answers `SessionNotFound`, and a refused turn answers the chat's own `chat/error` with `sendFailed`.
- A paused message is refused in `sendTurn`, so it is answered after the session is awake. A subscribe to the session wakes it, as a window opening the row does. A subscribe to one of its chats alone reads the chats but starts no backend, so the restart case opens the session before it sends.
- The disabled restart turns the record on at the host level. The set no longer names the agent, `agents` gains a fresh backend, and `host.replace` folds the new list. That is what `x-ahpd/agents/enable` leaves behind. The command itself is covered in `agents-channel.test.ts`.
- The harness denied every `TMPDIR=`-prefixed command and every `npx`, so the suites ran as `pnpm exec vitest run ... --maxWorkers=6 --testTimeout=20000`, one at a time.

## Left for later

- Listing a stored session whose record is off and whose backend is not registered. The plan does not answer it, and the listing is unchanged.
- The switch in ahpw's agent and connector pages, which is its own plan. The methods work from ahpc and the MCP tools now.
- A backend kept for its open sessions still holds the key it read, until its last session ends.
