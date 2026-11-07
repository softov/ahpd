---
title: The session tools say enough to choose
created: 2026-11-06
refs:
  - git://f48055f0 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/tools/session.ts#L101-L135](../../packages/sdk/src/tools/session.ts#L101-L135) - `serializeSession`, the row `list_sessions` answers, with no agent field"
  - "[code://packages/sdk/src/tools/session.ts#L138-L179](../../packages/sdk/src/tools/session.ts#L138-L179) - `filterSessions`, the filters `list_sessions` takes"
  - "[code://packages/sdk/src/tools/session.ts#L409-L800](../../packages/sdk/src/tools/session.ts#L409-L800) - the text of the ten session tools"
  - "[code://packages/sdk/src/tools/session.ts#L525-L529](../../packages/sdk/src/tools/session.ts#L525-L529) - a wrong `agent` is refused with the list of agents, the only place a caller sees them"
  - "[code://packages/sdk/src/tools/session.ts#L331-L337](../../packages/sdk/src/tools/session.ts#L331-L337) - `modelMeant`, which refuses a wrong model without naming the models"
  - "[code://packages/sdk/src/tools/session.ts#L557-L560](../../packages/sdk/src/tools/session.ts#L557-L560) - the isolation `create_session` picks when `worktree` is left out"
  - "[code://packages/sdk/src/tools/session.ts#L673-L683](../../packages/sdk/src/tools/session.ts#L673-L683) - the `send_message` schema, with `session` and `message` only"
  - "[code://packages/sdk/src/host/lifecycle.ts#L934-L995](../../packages/sdk/src/host/lifecycle.ts#L934-L995) - `moveSession`, which restarts the whole session where `set_workspace` asked"
  - "[code://packages/agent-acp/src/catalog.ts#L120-L137](../../packages/agent-acp/src/catalog.ts#L120-L137) - an ACP row with no `updatedAt` is dated at the time it is listed"
  - "[code://docs/server/MCP.md#L43-L61](../../docs/server/MCP.md#L43-L61) - what `/mcp` serves"
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/shared/sessionServerTools.ts - VS Code's session tools, the reference the names follow, at 1.143.1
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1147-L1150 - VS Code uses the folder when it is not a git repository
---

# The session tools say enough to choose

Softov wants a caller of the session tools to see enough to choose, without ahpc.
A caller must find a session by more filters, and must learn the agents, their models and their config before `create_session`.
Softov also reviews the text of each tool, which is long: `set_workspace` alone is 658 characters.

## What others do

- VS Code 1.143.1 has no tool that lists agents, models or a config schema. Its `create_session` takes a `model`, and the model selects the provider.
- VS Code's `list_sessions` takes the same filters as ahpd and has no limit.
- VS Code's row leaves out `createdAt` and `modifiedAt` when the session has no time.
- VS Code's `send_message` takes `operation` (`send`, `replace`, `cancel`), `delivery` (`queue`, `steer`), `messageId` and `expectedRevision`.
- VS Code's `set_workspace` moves the current chat; other chats keep their folders.
- VS Code's `create_session` defaults to a worktree, as ahpd does. A folder that is not a git repository is used as it is.
- ahpc shows what the tools do not: `ahpc agents --json` lists each agent and its models, and `ahpc session config` prints a session's schema. `ahpc session list` reads one page with `--limit` and `--cursor`.

## What ahpd has today

- A `list_sessions` row has `session`, `openLink`, `title`, `status`, the folder, `unread`, the times, changes, git and GitHub. It has no agent field; the agent is only the host part of `openLink`.
- `list_sessions` takes `session`, `status`, `workspace`, `withChanges`, `unread`, `withPullRequest`, `includeArchived`, `createdAfter` and `createdBefore`. It has no limit and no agent filter.
- On Softov's daemon on 2026-11-06, `list_sessions` with no filter answered 341 rows, 155 KB. Claude Code did not show it inline and saved it to a file.
- 43 of those rows came from the `dsh` agent with no title, and with both times set to the moment the daemon first listed them.
- `create_session` describes `agent` as "such as one `list_sessions` shows", but no row shows one. A wrong `agent` is refused with the 19 agents the host offers.
- A wrong `model` is refused without the models. No tool names the keys `config` takes.
- `create_session` on a folder that is not a git repository, with `worktree` left out, failed: "is not a git repository, so it has no worktrees". With `worktree: false` it made the session.
- `send_message` takes `session` and `message` only. A busy chat queues the message.
- `set_workspace` restarts the whole session in the new folder, every chat with it.
- `create_session` and `send_message` worked on 2026-11-06 with a member token: the session's owner is `user:soft`, and both turns completed.

## The text of the tools

Each tool's text is its description plus the description of each input. The model reads all of it on every turn that offers the tool.

| Tool | ahpd description | ahpd inputs | VS Code description |
| --- | --- | --- | --- |
| `list_sessions` | 519 | 9, 982 | 519 |
| `get_current_session` | 163 | 0 | 163 |
| `set_workspace` | 658 | 2, 310 | 1482 |
| `create_session` | 318 | 8, 1507 | 58, or 318 where the provider has one folder per session |
| `create_chat` | 213 | 4, 271 | named in `serverToolNames.ts`, with no definition |
| `rename_chat` | 508 at `/mcp`, 526 in a session | 3, 338 | 526 |
| `send_message` | 388 | 2, 177 | 604 |
| `get_session_context` | 454 | 3, 506 | 484 |
| `delete_session` | 169 | 1, 122 | 169 |
| `schedule_wakeup` | 498 | 3, 291 | no such tool |

Lengths are characters as the model reads them, from `tools/list` at `/mcp` and from the source for the three tools `/mcp` does not serve.
Most texts are VS Code's word for word. `set_workspace` is ahpd's own, and already shorter.
The text is how the model knows when to call a tool. A rule cut from it, such as `set_workspace`'s "ask one question before every call", is a behaviour lost.

## Who writes

- No branch on `origin` or `maycxc` changes `packages/sdk/src/tools/session.ts` or `packages/server/src/mcp.ts` ahead of `f48055f0`, other than MayCXC's branches of 2026-10-27 to 2026-11-02. `maycxc/union` has no commit ahead of main, so their work is in.
- A session's own tools endpoint, `/ahp-mcp/<uuid>`, serves the same tools. A change to a tool reaches the agents in sessions too.

## The change

- A `list_sessions` row says its `agent`, the provider id that `create_session` takes.
- `list_sessions` takes an `agent` filter and a `limit`, and answers the newest rows first.
- A new read tool lists the agents the caller may start, each with its id, its name, its models and its config schema.
- `create_session` uses the folder when it is not a git repository and `worktree` is left out, as VS Code does.
- `send_message` takes `operation`, `delivery`, `messageId` and `expectedRevision`, as VS Code's does.
- Each tool's text is reviewed by Softov, and rewritten where he says.
- `docs/server/MCP.md` names each new tool and input.

## Open points

- The name of the new tool: `list_agents`, or `list_agents` and `list_models` as two tools.
- Whether `list_sessions` takes a `title` filter and a `modifiedAfter`, as well as `agent` and `limit`.
- Whether a row with no time leaves out `createdAt` and `modifiedAt`, as VS Code does. The catalogue fills them for ahpw and ahpc too, so the change may be in the catalogue and not the tool.
- Whether `set_workspace` moves only the current chat, as VS Code's does.
- For the text review: keep VS Code's words, or write shorter text of ahpd's own. With VS Code's words, an upstream change is a copy; with ahpd's, it is a rewrite.
