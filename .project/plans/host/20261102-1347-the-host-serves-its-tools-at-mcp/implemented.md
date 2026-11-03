---
title: The host serves its tools at /mcp - implemented
date: 2026-11-02
refs:
  - git://9a29a4a8 - the merge of ahpd #190
  - "[code://packages/sdk/src/host/tooling.ts#L1976](../../../../packages/sdk/src/host/tooling.ts#L1976) - `sessionlessContext`"
  - "[code://packages/sdk/src/host/tooling.ts#L2078](../../../../packages/sdk/src/host/tooling.ts#L2078) - `sessionlessTools`"
  - "[code://packages/sdk/src/tools/server.ts#L298](../../../../packages/sdk/src/tools/server.ts#L298) - `answerTools`, which both tools servers share"
  - "[code://packages/server/src/mcp.ts#L66](../../../../packages/server/src/mcp.ts#L66) - `mcpHandler`, the `/mcp` door"
  - "[code://packages/server/src/proxy/caller.ts#L122-L124](../../../../packages/server/src/proxy/caller.ts#L122-L124) - the scope check that refuses a person in no team"
---

A person points an MCP client at the host's `/mcp` with their ahpd token, and lists and runs the host's tools that need no session.
The first tools are the seven session tools, under the person's grants.
`create_session` can name the agent and the settings of the new session, from `/mcp` and from a session.
A session's `/ahp-mcp/<uuid>` answers through the same code as `/mcp`.
`/mcp` is off until `mcpTools` is `all`.

## What was built

- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `HostTool` is `SessionHostTool | SessionlessHostTool`, with `grant`, `ToolCaller` and `SessionlessToolCall`.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `sessionlessContext` and `sessionlessTools`, and `chatsOf`, `modelsKnown`, `providersKnown` and `contextOf` shared with `toolContext`.
- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - the seven sessionless tools with their grants, and `create_session` with `agent` and `config`.
- [`code://packages/sdk/src/tools/server.ts`](../../../../packages/sdk/src/tools/server.ts) - `answerTools`, the transport without the token check.
- [`code://packages/server/src/mcp.ts`](../../../../packages/server/src/mcp.ts) - the door: the setting, the caller and the list for each request.
- [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts) - the `mcp` subject and `mcp:call`.
- [`code://docs/server/MCP.md`](../../../../docs/server/MCP.md) - how a person points a client at `/mcp`.
- The branch `host/20261102-1347-grants-follow-the-answers` builds Softov's answers of 2026-11-02. `guest` does not hold `mcp:call`, as *Answers* said. `/mcp` passes `{ scoped: false }` to `callerOf`, so a person in no team is not refused.

## Verified

- `sessiontools.test.ts` 43 cases, `toolserver.test.ts` 27, `toolauth.test.ts` 4 and `mcp.test.ts` 15.
- `toolserver.test.ts` and `toolauth.test.ts` kept their old cases unchanged, so a session's `/ahp-mcp/<uuid>` answers as before.
- After MayCXC's union was merged in, the sdk suite passed 4032 and the server suite 1752.
- ahpd #190 passed its 11 CI checks, Windows included, on a rerun. The first run failed on two Windows runners, on timeouts in files the PR does not touch.
- A real MCP client at `/mcp` is not verified. It is in [host-1347-mcp-checks.md](../../../pending/host-1347-mcp-checks.md).

## Departures from the plan

- A caller without `session:write` gets the JSON-RPC error `No tool named create_session`, not a refusal in its result. The tool is not in its list.
- `ToolCall` has `providers()`, so `create_session` names an agent that has not reported a model yet.
- `checkedConfig` refuses a value that a declared key rules out, and passes a key the schema does not declare, as `createChat` does.
- `mcpTools` is read in `commands/options.ts` and checked by the config schema's `enum`.
- After MayCXC's union, a session made from a turn takes the union's name for an older VS Code window. A session made from `/mcp` is always `ahp-session:/<uuid>`.
- Each task's *Resume* lists its own departures.

## Left for later

- MCP elicitation, for the first tool that asks a person.
- OAuth at `/mcp`, and connector actions as tools.
