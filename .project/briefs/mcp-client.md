---
title: An MCP client drives a session
created: 2026-11-11
refs:
  - git://080dc4799 - the commit of ahpd the facts were checked at, and the daemon the test ran against
  - "[code://packages/server/src/mcp.ts#L70-L101](../../packages/server/src/mcp.ts#L70-L101) - `mcpHandler`, the `/mcp` door, which serves the sessionless tools a caller's grants allow"
  - "[code://packages/sdk/src/tools/session.ts#L105-L139](../../packages/sdk/src/tools/session.ts#L105-L139) - `serializeSession`, the `list_sessions` row, which has no `chats` field"
  - "[code://packages/sdk/src/tools/session.ts#L221-L295](../../packages/sdk/src/tools/session.ts#L221-L295) - `CAPS` and `serializeContext`, the `get_session_context` transcript"
  - "[code://packages/sdk/src/tools/session.ts#L296-L324](../../packages/sdk/src/tools/session.ts#L296-L324) - `delegated`, which writes no `vscode.chat.delegation` for a caller with no session"
  - "[code://packages/sdk/src/tools/session.ts#L504-L514](../../packages/sdk/src/tools/session.ts#L504-L514) - `MOVE_REFUSALS`, whose `disabled` sentence names a VS Code setting"
  - "[code://packages/sdk/src/tools/session.ts#L645-L662](../../packages/sdk/src/tools/session.ts#L645-L662) - `get_current_session`, which is not sessionless and so is not at `/mcp`"
  - "[code://packages/sdk/src/tools/session.ts#L1029-L1053](../../packages/sdk/src/tools/session.ts#L1029-L1053) - `delete_session`, which drops a link's chat id and deletes the whole session"
  - "[code://packages/sdk/src/tools/session.ts#L1059](../../packages/sdk/src/tools/session.ts#L1059) - `move_session`'s description, which points at `get_current_session` and a `chats` field"
  - "[code://packages/sdk/src/host/tooling.ts#L1498-L1515](../../packages/sdk/src/host/tooling.ts#L1498-L1515) - `deliver`, whose ownership check needs a `sourceChat`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L353](../../packages/sdk/src/host/sessionmethods.ts#L353) - the root config key `chatMoves.enabled` that turns moves on"
  - "[code://.project/pending/host-1347-mcp-checks.md](../pending/host-1347-mcp-checks.md) - the check by hand of `/mcp` from a real MCP client, which this test covers in part"
  - "[code://UPSTREAM.md#L29](../../UPSTREAM.md#L29) - `archive_chat`, open with no plan"
  - git://a1a15017f8a - the commit of VS Code's main the reference facts were checked at
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/common/serverToolNames.ts#L20-L31 - VS Code's session tool names, with `archive_chat` and no tool for a pending request
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L97 - the session tools VS Code asks the user to confirm, `delete_session` among them
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L187 - the `chats` field of a `list_sessions` row
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1335-L1341 - `resolveKnownSession`, which resolves a chat link to its session
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1853 - the markdown parts of a turn, joined with `''`
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1876-L1965 - `serializeSessionContext`, with `messagesSentByMe`, `assistantTruncated`, `responseTurnId` and `harness`
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2024-L2043 - `delete_session`, which deletes the session a link resolves to
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/common/actions.ts#L170 - `chat/toolCallConfirmed`, the action that approves or denies a tool call
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/common/actions.ts#L209 - `chat/inputCompleted`, the action that answers a question
---

# An MCP client drives a session

Softov wants to drive ahpd sessions from an outside MCP client.
The client creates a session, steers it, approves and denies its tool calls, and answers its questions.
This brief reports a test of that from Claude Code in VS Code, through `/mcp` at `http://127.0.0.1:37537/mcp`.
The test ran on 2026-11-11 against the daemon at `080dc4799`, with a session of `claude-deepseek` on `deepseek-flash` in `default` approvals.
The goal is that a person's MCP client can do each of the four actions, and that every tool at `/mcp` works there.

## What others do

VS Code's session tools are the reference that `packages/sdk/src/tools/session.ts` follows.
These facts are from VS Code's main at `a1a15017f8a`.

| Finding | VS Code |
|---|---|
| No tool answers a pending request | The same. VS Code has no door for an outside client, so no session tool answers a request. |
| `replace` and `cancel` need a `sourceChat` | The same check. VS Code has no caller without a session. |
| `delete_session` deletes the whole session of a chat link | The same, through `resolveKnownSession`. VS Code asks the user to confirm every `delete_session`. |
| Markdown parts joined with no space | The same: `join('')`. |
| `list_agents` and `list_models` | VS Code has neither. They are ahpd's own tools. |
| Two forms of a session's name | The same: `session` and `openLink`. |

AHP already has the actions a client window sends for a pending request: `chat/toolCallConfirmed` approves or denies a tool call, and `chat/inputCompleted` answers a question.
ahpc and ahpw send them today.

## What ahpd has today

### The tools at `/mcp`

`/mcp` serves the ten tools that say `sessionless: true`.

| Tool | Result in the test |
|---|---|
| `list_sessions` | Works: filters, `limit` and the one-session lookup. |
| `list_agents` | Works. The answer is about 60 KB, because each of 19 agents repeats the same `permissions` and `sensitiveEditLocations` schema. |
| `list_models` | Works. `codex` and nine other agents answer `models: []`. |
| `create_session` | Works with `independent`. `currentSession` gives `currentSession needs a calling session; use independent`. |
| `create_chat` | Works with `session`. With no `session` it gives a clear error. |
| `rename_chat` | Works on a chat link. |
| `send_message` | `send` works for `queue` and `steer`. `replace` and `cancel` always give `messageNotOwned`. |
| `get_session_context` | Works on a session and on a chat link. |
| `move_session` | Refused: moves are off on this daemon, and the refusal names the wrong setting. |
| `delete_session` | Works. No confirmation is asked. |

The tools that only a chat inside a session gets: `get_current_session`, `set_workspace`, `isolate_session`, `schedule_wakeup`, `ask_user`, `ahp_resource`, `ahp_terminals`.

### The four actions

| Action | Result |
|---|---|
| Create | Works. |
| Steer | Works. |
| Answer a question | Only as a side effect. A steer aborts the pending `AskUserQuestion` call, and the agent reads the answer from the steer text. |
| Deny a tool call | Only as a side effect. A steer aborts the pending permission request, which the agent takes as a denial. |
| Approve a tool call | Not possible. A steer aborts the request, the agent retries the same call, and the same request comes back. |

The test session made two `Write` calls for `colour.txt`, and neither wrote the file.

### What is missing

- No tool approves or denies a pending permission request.
- No tool answers a pending question with one of its options.
- No answer names what a session waits for. `list_sessions` says `inputNeeded`, but not which request, its tool, its input or its options.
- No tool changes the config of a running session, so a client cannot move it to `acceptEdits` or `bypassPermissions` after it starts.
- No tool stops or cancels a running turn.
- No tool reads a session's changes or diff, other than the `changes` counts on a row.

### What is wrong

- A steer answers "status: processing" and does not say that it aborted a pending request.
- A steer reaches whatever request is pending when it arrives. In the test, a denial written for `ls -la` arrived after `ls` ran, and denied `rm notes.txt` instead.
- `replace` and `cancel` from `/mcp` always fail. `delegated` writes no `vscode.chat.delegation` without a calling session, and `deliver` needs its `sourceChat` to own the message. The tool still answers `send` with a `messageId` and a `revision`, and its description offers both operations. The queued message that the test tried to cancel ran as turn 2.
- `delete_session` drops the chat id of a `?chat=` link. A link to one nested chat deletes the whole session, with no confirmation.
- The `move_session` refusal says to turn on `chat.agentHost.moveChats.enabled`, a VS Code setting. ahpd reads the root config key `chatMoves.enabled`.
- `move_session`'s description points at `get_current_session` and at a `chats` field. `/mcp` has neither, and no row has `chats`, so a client cannot find a nested chat's link.
- `create_session`, `create_chat`, `rename_chat` and `move_session` talk about "the current session" to a caller that has none.
- `modifiedAt` does not move while a turn runs. The build session `8d842840` ran for 13 minutes with `modifiedAt` still at its start, so "newest first" puts a busy session low.

### What could be better

- `get_session_context` joins the markdown parts of a turn with no space, so text reads "I'll start with step 1.Step 1: ...".
- Steers do not appear in the transcript. Only the first message of a turn shows as `user`.
- `full` cuts each tool input to 200 characters, which cut the `AskUserQuestion` options in the test.
- A row names its session as `ahp-session:/<id>`, and `create_session` answers with `agent-host-session://<agent>/<id>`. A Gemini row is `gemini:/<id>`. Both forms work as input, but a client must keep two names for one session.
- A title is cut at 80 characters in the row, such as "Build the plan .project/plans/plugin/20261111-0032-an-agent-or-connector-turns-o".
- `list_agents` gives the first five models as the host learned them, so `claude-openrouter` leads with `stealth/space-bunny-alpha` and `claude-2.1`.
- `list_agents` gives `permissionMode` with no `enum` for `amp`, `copilot`, `cursor`, `devin`, `dsh`, `goose`, `kilo` and `opencode`, so a client cannot set it at create.

## Who writes

- `packages/sdk/src/tools/session.ts` is the file of plan `host/20261110-0813-the-session-tools-follow-vscode`, at status `planned`, and of `host/20261110-0813-the-session-tools-find-and-list-agents`.
- The build session `8d842840` works on plan `plugin/20261111-0032-an-agent-or-connector-turns-o...` in its own worktree. This test did not message it.
- The pending check `host-1347-mcp-checks.md` asks Softov to test `/mcp` from a real client. This test used the token in `~/.claude.json`, and does not say which user holds it.

## The change

The change is three plans: *Pending requests*, then *The session tools at `/mcp`*, then *The agent list*.

### Pending requests

Softov chose a new tool on 2026-11-11, over an operation on `send_message` and over a steer alone.

- `get_session_context` and the `list_sessions` row carry `pending`, a list of the requests the session waits on.
- Each pending request has an id, a kind (`permission` or `question`), the tool, its input and its options.
- A new tool, named `answer_request` for now, approves or denies a permission request, or answers a question, by its id.
- `answer_request` sends `chat/toolCallConfirmed` or `chat/inputCompleted`, as a client window does.
- `answer_request` refuses a request that is no longer pending, so a late answer never reaches the next request.
- A steer that aborts a pending request names that request in its answer, as `aborted`.

### The session tools at `/mcp`

- `replace` and `cancel` work for a caller with no session. The message meta keeps the caller's user, or its token for root, as the owner.
- `delete_session` refuses a link whose chat id names a nested chat, and says to use `archive_chat`.
- The `move_session` refusal for a host with moves off names the root config key `chatMoves.enabled`.
- A caller with no session gets descriptions with no "current session":
  - `create_session` has no `currentSession` value.
  - `create_chat` and `rename_chat` say that `session` is required.
  - `move_session` does not point at `get_current_session`.
- The text join stays as VS Code has it.
- The row's `chats`, `archive_chat`, the context fields and each tool call's status are planned in host/20261111-0609-a-row-lists-chats-and-one-chat-archives and host/20261111-0609-the-session-context-tells-each-call.

### The agent list

- `list_agents` gives the config keys that every agent shares once, not once per agent.
- An agent whose `permissionMode` has no `enum` gives its `availableApprovalModes` once it has started, or says the modes come at its start.
- `list_agents` lists an agent's default model first.

## Open points

- Whether `answer_request` needs a grant of its own, separate from `session:write`.
- The name `answer_request` is not final.
- The cause of the `modifiedAt` that does not move is not checked. It is a problem file after the cause is found, starting in `packages/sdk/src/host/snapshots.ts`.
- Where the title is cut at 80 characters is not checked.
- Which user the token in `~/.claude.json` belongs to, and whether a `member` sees the same ten tools.
