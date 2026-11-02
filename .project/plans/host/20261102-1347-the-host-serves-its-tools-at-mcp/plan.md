---
title: The host serves its tools at /mcp
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://573e920a - the commit of ahpd this plan was checked at
  - git://573e920a - the last commit that holds `.project/briefs/the-host-serves-its-tools-at-mcp.md`, the brief this plan covers
  - "[code://packages/sdk/src/tools/server.ts#L211-L264](../../../../packages/sdk/src/tools/server.ts#L211-L264) - `answered`: `initialize`, `tools/list` and `tools/call` for one session's tools"
  - "[code://packages/sdk/src/tools/server.ts#L284-L364](../../../../packages/sdk/src/tools/server.ts#L284-L364) - `toolServers`: one path and one token for each session, the token checked before the method"
  - "[code://packages/sdk/src/types/host.ts#L904-L991](../../../../packages/sdk/src/types/host.ts#L904-L991) - `HostTool`, where a tool says what it is"
  - "[code://packages/sdk/src/types/host.ts#L1008-L1012](../../../../packages/sdk/src/types/host.ts#L1008-L1012) - `ToolCall` names a session and a chat on every call"
  - "[code://packages/sdk/src/host/tooling.ts#L1434-L1460](../../../../packages/sdk/src/host/tooling.ts#L1434-L1460) - `personOf` and `mayDo`: whose grants a call in a chat runs with"
  - "[code://packages/sdk/src/host/tooling.ts#L1635](../../../../packages/sdk/src/host/tooling.ts#L1635) - `toolContext`, the `ToolCall` for one session and chat"
  - "[code://packages/sdk/src/host/tooling.ts#L1983-L2016](../../../../packages/sdk/src/host/tooling.ts#L1983-L2016) - `offeredTools`, which binds each tool to a session and raises `tool_call`"
  - "[code://packages/sdk/src/tools/session.ts#L360](../../../../packages/sdk/src/tools/session.ts#L360) - `sessionTools`, the tools `/mcp` serves first"
  - "[code://packages/sdk/src/tools/session.ts#L444-L500](../../../../packages/sdk/src/tools/session.ts#L444-L500) - `create_session`, which gets `agent` and `config`"
  - "[code://packages/sdk/src/types/events.ts#L185-L197](../../../../packages/sdk/src/types/events.ts#L185-L197) - `ToolCallEvent`, which names a session and a chat"
  - "[code://packages/server/src/proxy/caller.ts#L94-L150](../../../../packages/server/src/proxy/caller.ts#L94-L150) - `callerOf`: root, a session, a person or a team key, with a grant check"
  - "[code://packages/server/src/http.ts#L128-L151](../../../../packages/server/src/http.ts#L128-L151) - `PROXY_PREFIX` and `withoutApi`, which `/mcp` joins"
  - "[code://packages/server/src/commands/run.ts#L592-L670](../../../../packages/server/src/commands/run.ts#L592-L670) - the session servers, the proxy and the handler chain"
  - "[code://packages/sdk/src/access/users.ts#L29-L39](../../../../packages/sdk/src/access/users.ts#L29-L39) - the built-in roles"
  - "[code://packages/sdk/src/access/users.ts#L231-L236](../../../../packages/sdk/src/access/users.ts#L231-L236) - the `proxy` subject, the shape the `mcp` subject copies"
  - "[code://packages/sdk/src/access/users.ts#L1255-L1262](../../../../packages/sdk/src/access/users.ts#L1255-L1262) - a team key holds `proxy:call` and `proxy:models` only"
  - https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization - a client sends `Authorization: Bearer <token>` on every request, and never a token in the query
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/mcp/common/mcpPlatformTypes.ts#L70-L77 - a remote server in VS Code's `mcp.json` takes `url` and `headers`
---

## Goal

A person points an MCP client, such as VS Code or Claude Code, at the host's `/mcp` with their ahpd token.
The client then lists and runs the host's tools that need no session, under that person's grants.
The first tools are the session tools: list, create, message, read, rename and delete sessions.
`create_session` can also name the agent and the settings of the new session.
The session servers at `/ahp-mcp/<uuid>` stay, and answer through the same code as `/mcp`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "at\.session|at\.chat" packages/sdk/src/tools/session.ts` - `delegated`, `self`, `get_current_session`, `create_session`, `create_chat`, `rename_chat`, `send_message` and `delete_session` read the calling session.
- `rg -n "effects|confirm:" packages/sdk/src/tools/session.ts` - no session tool declares `effects` or `confirm`. Nothing in the host asks a person about them.
- `rg -n "'tool_call'" packages/*/src` - only `tooling.ts` raises the host's event. The other matches are ACP and pi events of the same name.
- `rg -n "whose|verifyTeamKey" packages/server/src/proxy/caller.ts` - a team key reaches `who.can(grant)` and fails any grant but the two proxy grants.
- `git branch -r --no-merged origin/main | grep maycxc` - `host/124-...` changes `tools/server.ts`, and `host/20261101-0329-...` changes `host/tooling.ts` and `types/host.ts`. Neither is merged.

### Runtime path

```
client POST /mcp, Authorization: Bearer <person token>
  -> withoutApi: /mcp is an API path -> mcp handler
  -> mcpTools is 'all'? else 404
  -> callerOf(request, { token, users }, 'mcp:call') -> root or a person, else 401 or 403
  -> host.sessionlessTools(caller) -> the tools with `sessionless: true` that the caller's grants allow
  -> answerMcp (shared with /ahp-mcp/<uuid>) -> initialize | tools/list | tools/call
  -> tool.run(input, the caller's ToolCall with no session) -> tool_call event with the person
```

### Gaps

- Every `ToolCall` names a session and a chat, and a person on a laptop has neither.
- No tool says that it can run with no session, or which grant a caller needs to see it.
- `create_session` takes the provider only from the model, and `modelMeant` takes the first model with that id across all providers.
- `create_session` cannot give the new session its settings.
- No path serves the host's tools to a person.

## Answers

| What | Source | Task |
| --- | --- | --- |
| One server code serves a session and a person. A session keeps its `/ahp-mcp/<uuid>` path and token | Softov, 2026-10-23: "Sessions and people, with one code path. Sessions first." | 03 |
| What bare `/mcp` serves is a host setting. Nothing is the default | Softov, 2026-10-23: "A host setting: nothing by default, a named default toolset, or everything the person may read." | 04 |
| A tool that would ask a person asks through MCP elicitation when the client declared it, and is refused when it did not | Softov, 2026-10-23 | - |
| OAuth comes later. `/mcp` takes a bearer token only | Softov, 2026-10-23: "Later. The first plan takes a bearer token only." | 04 |
| The `mcpServers` of `config.json` stay, offered to sessions as today | Softov, 2026-10-23 | - |
| A tool declares that it runs with no session. Only those tools are served at `/mcp` | Softov, 2026-11-02: "Tools declare no session" | 01 |
| Connector actions are not served at `/mcp` in this plan | Softov, 2026-11-02: "Leave them for later" | - |
| `create_session` takes an optional `agent`, a provider id such as `claude-deepseek-build` | Softov, 2026-11-02: "Add optional agent input" | 02 |
| `create_session` takes an optional `config`, the new session's settings, checked against the agent's schema as `createChat` checks a chat's | Softov, 2026-11-02: "Add optional agent input" | 02 |
| The sessionless tools are `list_sessions`, `create_session`, `create_chat`, `rename_chat`, `send_message`, `get_session_context` and `delete_session` | (defaulted: each acts on a session it is given; `get_current_session`, `set_workspace`, `schedule_wakeup` and the artifact tools act on the calling session) | 01 |
| A tool names the grant a caller needs to see it, as `grant`. `run` still checks its own grants | (defaulted: `tools/list` shows only what the person may run, and the call is checked again) | 01 |
| With no session, `relationship: currentSession`, a missing `session` on `create_chat`, `rename_chat`, `send_message` and `get_session_context` are refused with a sentence that says a session is needed | (defaulted: no calling session to fall back to) | 01 |
| A sessionless call has no tree budget and no spawn depth. A session it makes has no parent, and belongs to the caller | (defaulted: a client's `createSession` has neither; the budget counts an agent's own spawns) | 01 |
| A message a sessionless call sends is a turn sent by the caller, so the caller's grants follow it | (defaulted: as `send` records the calling turn's sender today) | 01 |
| `tool_call` carries `person` and leaves `session` and `chat` out for a sessionless call | (defaulted: there is no session to name) | 01 |
| No tool in this plan asks a person. Elicitation waits for the first tool that does | (defaulted: no session tool declares `effects` or `confirm`, and the MCP client confirms its own calls) | - |
| `agent` with `currentSession` makes a chat of that agent in the current session, as `createChat` takes `provider` | (defaulted: the session keeps its own provider) | 02 |
| `model` with `agent` must be a model of that agent | (defaulted: `modelMeant` already filters by provider) | 02 |
| `/mcp` is served beside `/v1`, on the listener that carries `/api`, only while `httpApi` is on | (defaulted: the brief's statement) | 04 |
| `/mcp` finds its caller with `callerOf` and the grant `mcp:call`. The deployment token is root, as on `/v1` | (defaulted: one caller check for every HTTP door) | 04 |
| A session's token is refused at `/mcp` | (defaulted: a session has its own path, and `whose` is not passed) | 04 |
| The `mcp` subject has one operation, `call`, in the write group. The `member` role holds `mcp:call`. A team key cannot hold it | (defaulted: a member can already do through a client what the tools do) | 04 |
| The setting is `mcpTools` in the daemon config: `none`, the default, or `all`. With `none`, bare `/mcp` answers 404 | (defaulted: the name, and `all` is "everything the person may read") | 04 |
| `/mcp` keeps no state between requests. It answers `initialize`, `tools/list` and `tools/call`, and refuses a `GET` with 405 | (defaulted: each request names its caller; a list change is found on the next `tools/list`) | 03, 04 |
| A token in the query string is not read | (defaulted: `callerOf` reads headers only) | 04 |

## Proposed architecture

- **Data flow** - A request at `/mcp` names its caller through `callerOf`. The host builds that caller's tool list and a `ToolCall` with no session. The shared answer runs the tool and returns its text.
- **Event flow** - Each sessionless call raises `tool_call` with `person`, `tool`, `ok` and `error`.
- **State flow** - Nothing new is stored. A session made from `/mcp` is a session record owned by the caller.
- **Layer responsibilities** - sdk: the sessionless tools, their `ToolCall` and the shared answer · server: the `/mcp` door, the setting and the grant.
- **Source-of-truth files** - [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts), [`code://packages/sdk/src/tools/server.ts`](../../../../packages/sdk/src/tools/server.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A host tool may run with no session](task-01-a-host-tool-may-run-with-no-session.md) | implemented | - |
| [02 - create_session takes an agent and a config](task-02-create-session-takes-an-agent.md) | implemented | 01 |
| [03 - One answer serves every tools server](task-03-one-answer-serves-every-tools-server.md) | implemented | - |
| [04 - /mcp opens to a person's token](task-04-mcp-opens-to-a-persons-token.md) | implemented | 01, 03 |

## Risks and tradeoffs

- Plan `20261102-1122-the-host-keeps-the-tunnels` changes `run.ts` and `config.ts` at other lines. The plan that merges second rebases on the first.
- MayCXC's `host/124-...` and `host/20261101-0329-...` change `tools/server.ts`, `tooling.ts` and `types/host.ts`. The plan that merges second rebases.
- `create_session` from `/mcp` starts an agent on the host for a person on a laptop. Only a caller with `mcp:call` and `session:write` reaches it, and `mcpTools` is off by default.
- A third-party plugin's tool keeps `session: string` in its `ToolCall`, because only a tool with `sessionless: true` gets the looser type.

## Resume state

- **Done so far:** tasks 01, 02, 03 and 04 are implemented and their gates pass. `HostTool` has the sessionless branch, `Host.sessionlessTools(caller)` builds a caller's list, the seven session tools run with no session, and `create_session` takes an `agent` and a `config` checked against that agent. `answerTools` now holds the transport that a session's `/ahp-mcp/<uuid>` and `/mcp` share, with the token check left in `request`. `/mcp` is served on the listener that carries `/api` while `httpApi` is on, and `mcpTools` says what it serves: `none`, the default, answers 404, and `all` serves the sessionless tools the caller's grants allow. The door asks for `mcp:call`, which `member` and `guest` hold and a team key cannot. `docs/sdk/TOOLS.md` says the first two and `docs/server/MCP.md` says how a person points a client at the door. Four commits on the branch.
- **Next action:** review, then the Final verification checklist below; no task is left to build.
- **Open questions:** none.
- **Watch out for:** a session's `/ahp-mcp/<uuid>` must answer exactly as before. `toolserver.test.ts` and `toolauth.test.ts` pass unchanged.

## Final verification checklist

- [ ] With `mcpTools: "all"` and `httpApi` on, `tools/list` at `/mcp` with a member's token lists the seven session tools.
- [ ] A guest's token lists `list_sessions` and `get_session_context` only, and `create_session` called anyway is refused.
- [ ] A team key and a session's token are refused at `/mcp`.
- [ ] `create_session` with `relationship: independent`, `agent` and `config` from `/mcp` starts a session of that agent, owned by the caller.
- [ ] A session's `/ahp-mcp/<uuid>` answers as before, and `create_session` there takes `agent` too.
- [ ] With `mcpTools: "none"`, `/mcp` answers 404.
- [ ] The Windows CI is green.
