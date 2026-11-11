---
title: The host refuses a disabled agent
status: todo
depends: [task-01-an-agent-record-turns-off.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/host.ts#L356](../../../../packages/sdk/src/types/host.ts#L356) - `agentOwners`, which the new option sits beside"
  - "[code://packages/sdk/src/host/root.ts#L294](../../../../packages/sdk/src/host/root.ts#L294) - `descriptors`, the root's agent list"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2562-L2577](../../../../packages/sdk/src/host/lifecycle.ts#L2562-L2577) - a new session's agent check"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1915](../../../../packages/sdk/src/host/lifecycle.ts#L1915) - `sendTurn`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1243-L1247](../../../../packages/sdk/src/host/sessionmethods.ts#L1243-L1247) - `createSession`, which picks the provider"
  - "[code://packages/sdk/src/host/tooling.ts#L1940](../../../../packages/sdk/src/host/tooling.ts#L1940) - a tool's chat that names an agent"
  - "[code://packages/sdk/src/host/tooling.ts#L2204-L2206](../../../../packages/sdk/src/host/tooling.ts#L2204-L2206) - `create_session`'s agent"
  - "[code://packages/sdk/src/host/tooling.ts#L2489-L2491](../../../../packages/sdk/src/host/tooling.ts#L2489-L2491) - the third tool path that reads an agent"
  - "[code://packages/server/src/commands/run.ts#L1288](../../../../packages/server/src/commands/run.ts#L1288) - where the daemon passes `agentOwners`"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentService.ts#L9736-L9738 - a chat move to a disabled agent is refused
---

## Objective

The host learns which agents are off through `disabledAgents`.
A disabled agent is not on the root list.
The host refuses it a new session, a new chat, a chat move and a new turn with `<id> is turned off.`
A session on it keeps its history, and takes messages again once the agent is on.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:356` - add `disabledAgents?: () => ReadonlySet<string>` beside `agentOwners`.
- `UPDATE: packages/sdk/src/host/common.ts:59` - add `turnedOff(provider)`, the one sentence, beside `noProvider`.
- `UPDATE: packages/sdk/src/host/root.ts:294` - `descriptors` leaves out a disabled agent.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:2562-2577` - a new session on a disabled agent is refused.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1915` - `sendTurn` refuses a turn of a session whose agent is disabled, through the turn's refusal path.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1243-1247` - `createSession` refuses a disabled provider.
- `UPDATE: packages/sdk/src/host/tooling.ts:1940` - a new chat that names a disabled agent is refused.
- `UPDATE: packages/sdk/src/host/tooling.ts:2204-2206` - `create_session` refuses a disabled agent.
- `UPDATE: packages/sdk/src/host/tooling.ts:2489-2491` - the same check.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - a chat move into a session of a disabled agent, or of a chat on one, is refused.
- `UPDATE: packages/server/src/commands/run.ts:1288` - pass `disabledAgents: () => agentLists.disabled()`.
- `CREATE: packages/sdk/test/host-disabled-agent.test.ts` - the cases in *Validation*.
- `UPDATE: docs/sdk/HOST.md` - the option `disabledAgents`.

## Steps

1. Add the option to `HostOptions`, with a comment that names VS Code's `_isAgentDisabledOnHost`.
2. Add `turnedOff` beside `noProvider`.
3. Write one helper `isDisabled(provider)`, and call it from every check.
4. Leave a disabled agent out of `descriptors`, and publish the list again when the set changes.
5. Refuse a new session, a new chat, `create_session` and a chat move for a disabled agent.
6. Refuse a turn in `sendTurn` for a disabled agent, so the client gets the refusal and no turn starts.
7. After a restart, list a paused agent's stored session with its turns, and make a message answer `<id> is paused.`
8. Pass the option from `run.ts`.
9. Update the docs.
10. Write the tests.

## Validation

- A paused agent is not on the root list, and the host refuses it a new session, chat, move and message with `<id> is paused.`
- After a restart with a separate backend instance, a paused agent's stored session is listed with its turns and refuses a message.
- After a restart, a disabled agent's stored session is not listed, and it is listed again once the agent is enabled.
- `packages/sdk/test/host-disabled-agent.test.ts`: a disabled agent is not on the root list.
- The host refuses a new session and `create_session` on it with `<id> is turned off.`
- A session from before the toggle keeps its turns, and refuses a new message with the sentence.
- The same session runs a message once the agent is on.
- The host refuses a chat move into a session of the disabled agent.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes, then `packages/server`.

## Resume

2026-11-11. `HostOptions.disabledAgents` answers the ids whose record is off, `turnedOff(provider)` holds the one sentence and `isDisabled(disabled, provider)` answers whether a provider is in the set. `descriptors` leaves a disabled agent out of the root list, and `replace` publishes the list again.

The host refuses a disabled agent a new session and a new chat in `createSession` and `createChat`, a new session from a tool in `createProviderSession`, `openChat` and both `create_session` paths, a chat move in the mover, a turn in `sendTurn` through `chat/error` with `sendFailed`, and a wake in `resume`, which reads the agent off the session's record before it opens anything. A live session keeps its turns, and the same session runs a message once the set no longer names it. `run.ts` passes `disabledAgents: () => agentLists.disabled()`, and `HOST.md` documents the option.

The plan fixes the sentence and not the rest of each refusal, so the codes are the neighbouring ones: `-32002` for a new session and a new chat, `INVALID_PARAMS` with `data.reason` `agentUnavailable` for a move, `SessionNotFound` for a wake, and the chat's own `chat/error` for a turn.

The new `host-disabled-agent.test.ts` passes 7 tests. The full `packages/sdk` suite: 236 of 237 files passed, 4719 tests passed, 5 skipped, and 2 failed in `host-permissions.test.ts`, which are the edit-approval cases that need a tmpdir outside the home. `packages/server` passed all 94 files, 1871 tests, 3 skipped. `pnpm exec tsc -p tsconfig.json --noEmit` passed. The harness denied every command with a `TMPDIR=` prefix and every `npx`, so the suites ran as `pnpm exec vitest run` without it, one at a time. The wire fixture did not change.

After a restart with the record still off no backend is opened for the agent, so the catalogue has no agent to read that session's transcript and does not list it. The case that checks the stored session is still listed hands the second host the same echo instance, which is how a host that held the session when its agent was turned off runs; the refusal itself is read from the session's record and does not depend on the backend. Listing a stored session whose record is off and whose backend is not registered is a choice the plan does not answer, so it is left as it is.
