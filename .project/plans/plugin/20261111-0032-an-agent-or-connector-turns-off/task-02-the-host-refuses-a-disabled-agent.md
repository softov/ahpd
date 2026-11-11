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
7. After a restart, send a message to a stored session of a disabled agent, and make it answer `turnedOff`.
8. Pass the option from `run.ts`.
9. Update the docs.
10. Write the tests.

## Validation

- `packages/sdk/test/host-disabled-agent.test.ts`: a disabled agent is not on the root list.
- The host refuses a new session and `create_session` on it with `<id> is turned off.`
- A session from before the toggle keeps its turns, and refuses a new message with the sentence.
- The same session runs a message once the agent is on.
- The host refuses a chat move into a session of the disabled agent.
- After a restart, a message to a stored session of the disabled record answers the sentence.
- That session is still listed.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes, then `packages/server`.

## Resume
