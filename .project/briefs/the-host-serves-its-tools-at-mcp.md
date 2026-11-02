---
title: The host serves its tools at /mcp
created: 2026-11-02
refs:
  - git://6213729e - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/tools/server.ts#L1-L33](../../packages/sdk/src/tools/server.ts#L1-L33) - the MCP server each session gets today, under `/ahp-mcp`"
  - "[code://packages/sdk/src/tools/server.ts#L284-L344](../../packages/sdk/src/tools/server.ts#L284-L344) - one path and one token per session, and the token checked before the method"
  - "[code://packages/server/src/commands/run.ts#L582-L596](../../packages/server/src/commands/run.ts#L582-L596) - the session servers, on the daemon's own port only"
  - "[code://packages/server/src/commands/run.ts#L597-L626](../../packages/server/src/commands/run.ts#L597-L626) - the model proxy at `/v1`, served only while `httpApi` is on"
  - "[code://packages/server/src/commands/run.ts#L627-L652](../../packages/server/src/commands/run.ts#L627-L652) - who may open a request, and the order the handlers answer in"
  - "[code://packages/server/src/http.ts#L128-L151](../../packages/server/src/http.ts#L128-L151) - `/api` and `/v1` on whichever listener carries the API"
  - "[code://packages/sdk/src/types/host.ts#L1008-L1012](../../packages/sdk/src/types/host.ts#L1008-L1012) - every tool call names a session and a chat"
  - "[code://packages/sdk/src/host/tooling.ts#L1947-L1990](../../packages/sdk/src/host/tooling.ts#L1947-L1990) - a session's tool list, each tool bound to that session"
  - "[code://packages/sdk/src/host/tooling.ts#L472-L477](../../packages/sdk/src/host/tooling.ts#L472-L477) - which plugin tools a session is offered"
  - "[code://packages/sdk/src/connectors/actions.ts#L1-L48](../../packages/sdk/src/connectors/actions.ts#L1-L48) - a connector action is offered only to a session that binds a connector"
  - "[code://packages/sdk/src/access/users.ts#L1255-L1262](../../packages/sdk/src/access/users.ts#L1255-L1262) - a team key holds `proxy:call` and `proxy:models` only"
  - "[code://packages/sdk/src/host/spawn.ts#L843](../../packages/sdk/src/host/spawn.ts#L843) - the host's `mcpServers` go to each backend, which runs them"
  - https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization - authorization is optional; a client sends `Authorization: Bearer <token>` on every request
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/mcp/common/mcpPlatformTypes.ts#L70-L77 - a remote server in VS Code's `mcp.json` takes `url` and `headers`
---

# The host serves its tools at /mcp

Softov wants the host to serve MCP at `/mcp`, as it serves models at `/v1`.
A person points a tool on a laptop, such as VS Code, at the host with their ahpd token.
That person then reaches the tools they may use.
Sessions reach the same tools through the same code.
The steps are in Softov's order: the sessions' servers move onto the gateway code first, then `/mcp` opens to a person's token.
The gateway comes before toolsets (Softov, 2026-11-02: "Gateway first"), so bare `/mcp` serves what the person may read until toolsets add `/mcp/<toolset>`.

## Not in this brief

- Toolsets, and `/mcp/<toolset>`. They are a brief of their own.
- MCP servers as connectors, and the host running the `mcpServers` of `config.json` for a caller.
- An OAuth sign-in to `/mcp`, and a policy kind for tools.

## What others do

- The MCP specification at `2025-06-18` makes authorization optional.
- A client that uses it sends `Authorization: Bearer <token>` on every request, and never a token in the query string.
- A server that does authorization in full adds Protected Resource Metadata and a `WWW-Authenticate` header on a 401, so a client can find the sign-in.
- VS Code's `mcp.json` gives a remote server a `url` and `headers`. A person can put their ahpd token in a header with no sign-in flow.
- VS Code's agent host serves no MCP gateway. Its only gateway is the tunnel's endpoint selection.

## What ahpd has today

- Each session that asks gets an MCP server at `/ahp-mcp/<uuid>`, with a bearer token of its own ([`code://packages/sdk/src/tools/server.ts`](../../packages/sdk/src/tools/server.ts#L1-L33)).
- That server speaks streamable HTTP at `2025-06-18`, and answers `initialize`, `tools/list` and `tools/call`.
- It checks the token before the method and the body, and it stops answering when its session ends ([`code://packages/sdk/src/tools/server.ts`](../../packages/sdk/src/tools/server.ts#L284-L344)).
- It is served on the daemon's own port, and over stdio there is none ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L582-L596)).
- The model proxy is at `/v1`, on the listener that carries `/api`, only while `httpApi` is on ([`code://packages/server/src/http.ts`](../../packages/server/src/http.ts#L128-L151)).
- The proxy names its caller from a person's token through the users directory ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L627-L652)).
- A team key holds `proxy:call` and `proxy:models` and no other grant ([`code://packages/sdk/src/access/users.ts`](../../packages/sdk/src/access/users.ts#L1255-L1262)).
- Every tool call names a session and a chat, and a tool reads its person and grants through them ([`code://packages/sdk/src/types/host.ts`](../../packages/sdk/src/types/host.ts#L1008-L1012)).
- A session's tool list binds each tool to that session ([`code://packages/sdk/src/host/tooling.ts`](../../packages/sdk/src/host/tooling.ts#L1947-L1990)).
- A connector action is offered only to a session that binds a connector of its adapter, by an alias ([`code://packages/sdk/src/connectors/actions.ts`](../../packages/sdk/src/connectors/actions.ts#L1-L48)).
- The server asks no person through MCP elicitation. A backend may pass a question to ask before a call.
- The host's `mcpServers` go to each backend, and the backend runs them ([`code://packages/sdk/src/host/spawn.ts`](../../packages/sdk/src/host/spawn.ts#L843)).

## Who writes

| Writer | Files it changes | What the gateway does to it |
| --- | --- | --- |
| MayCXC, `host/124-an-agents-shell-is-a-terminal-the-person-sees`, not merged | `tools/server.ts`: a call id read from `_meta` | The call id moves into the gateway code with the rest of `tools/call`. |
| MayCXC, `host/20261101-0329-the-hosts-state-is-the-reducers-output`, not merged | `host/tooling.ts`, `types/host.ts`, `commands/run.ts` | The gateway reads the tool list it changes. Rebase on it if it merges first. |
| MayCXC, `union` with `host/20261102-0606-...` and `host/20261102-0618-...`, not merged | `host/spawn.ts`, `host/context.ts`, `host/state.ts`, `host/actions.ts` | `spawn.ts` changes at other lines than the `mcpServers` lines. No conflict expected. |
| MayCXC, `plugin/54-webhook-real-senders` and `daemon/windows-stop-race`, not merged | `commands/run.ts` | Other lines of the file. No conflict expected. |
| Plan `20261102-1122-the-host-keeps-the-tunnels`, not built | `commands/run.ts`: the `Host` checks of the routes and the API | `/mcp` sits behind the API's `Host` check, so a tunnel's URL reaches it only with `tunnelHosts` on. |

## The change

Softov's answers of 2026-10-23 decide most of it:

| What | Answer |
| --- | --- |
| Who the gateway is for | Sessions and people, with one code path. Sessions first. |
| What bare `/mcp` serves | A host setting: nothing by default, a named default toolset, or everything the person may read. |
| A tool that would ask a person | Ask through MCP elicitation when the client declared it. Refuse with a clear error when it did not. Never run it without asking. |
| OAuth | Later. The first plan takes a bearer token only. |
| The `mcpServers` of `config.json` | They stay, offered to sessions as today. |

As statements:

- One server code serves a caller that is a session or a person.
- A session keeps its `/ahp-mcp/<uuid>` path and token, so a backend sees no change.
- `/mcp` is served beside `/v1`, on the listener that carries `/api`, only while `httpApi` is on.
- `/mcp` takes a person's token as `Authorization: Bearer <token>`, as `/v1` does, and refuses a token in the query.
- A person needs the grant `mcp:call` to open `/mcp`. A team key cannot hold it.
- `/mcp` lists the tools the person may run, and checks the grant again on every call.
- This brief builds two values of the setting: nothing, and everything the person may read. The toolset value comes with toolsets.
- A call through `/mcp` raises the same `tool_call` event as a call in a session.

## Open points

1. **A tool with no session.** Every tool call names a session, and a person on a laptop has none. The gateway can give each person a session of their own for these calls, or a tool can declare that it runs with no session. Which one is a question for Softov.
2. **What "everything the person may read" holds.** Some session tools act on the calling session, such as `schedule_wakeup` and the artifact tools. From outside, they have nothing to act on. Each tool kind needs a yes or no.
3. **Connector actions from outside.** An action takes its connector from the session's bindings, by alias. A person has no bindings, so the gateway needs an alias for each connector the person may read.
4. **The default of the setting.** Nothing is the default, so a host turns the setting on before `/mcp` lists a tool.
5. **A client that cannot set a header.** It cannot reach `/mcp` until the OAuth plan. Not checked: which laptop tools take a header besides VS Code.
6. **The setting's name** in `config.json`.
