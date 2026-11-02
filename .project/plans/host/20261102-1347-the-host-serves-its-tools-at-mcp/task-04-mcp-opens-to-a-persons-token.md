---
title: /mcp opens to a person's token
status: todo
depends:
  - task-01-a-host-tool-may-run-with-no-session.md
  - task-03-one-answer-serves-every-tools-server.md
layer: server
refs:
  - "[code://packages/server/src/proxy/caller.ts#L94-L150](../../../../packages/server/src/proxy/caller.ts#L94-L150) - `callerOf`, which `/mcp` calls with `mcp:call`"
  - "[code://packages/server/src/http.ts#L128-L151](../../../../packages/server/src/http.ts#L128-L151) - `PROXY_PREFIX` and `withoutApi`"
  - "[code://packages/server/src/commands/run.ts#L605-L626](../../../../packages/server/src/commands/run.ts#L605-L626) - the proxy's options and its `otherwise`, which `/mcp` sits in front of"
  - "[code://packages/server/src/commands/run.ts#L654-L670](../../../../packages/server/src/commands/run.ts#L654-L670) - the chain on the daemon's port and the API's own listener"
  - "[code://packages/server/src/config.ts#L368-L393](../../../../packages/server/src/config.ts#L368-L393) - `httpApi`, `modelProxy` and `mcpServers`, which `mcpTools` sits beside"
  - "[code://packages/sdk/src/access/users.ts#L29-L39](../../../../packages/sdk/src/access/users.ts#L29-L39) - the built-in roles"
  - "[code://packages/sdk/src/access/users.ts#L231-L236](../../../../packages/sdk/src/access/users.ts#L231-L236) - the `proxy` subject"
---

## Objective

`/mcp` answers MCP on the listener that carries `/api`, while `httpApi` is on and `mcpTools` is `all`.
A caller with `mcp:call` lists and runs the sessionless tools its grants allow.

## Files

- `CREATE: packages/server/src/mcp.ts` - `MCP_PREFIX` and `mcpHandler`: the setting, the caller and `answerTools`.
- `UPDATE: packages/server/src/http.ts:128-151` - treat `/mcp` as an API path in `withoutApi`.
- `UPDATE: packages/server/src/commands/run.ts:605-626` - build `mcpHandler` in front of the proxy handler.
- `UPDATE: packages/server/src/config.ts:368-393` - `mcpTools`, `none` or `all`, `none` by default.
- `UPDATE: packages/sdk/src/access/users.ts:231-236` - the `mcp` subject, with `call` in the write group.
- `UPDATE: packages/sdk/src/access/users.ts:29-39` - `mcp:call` for `member`.
- `CREATE: packages/server/test/mcp.test.ts` - the door, the setting and the grants.
- `CREATE: docs/server/MCP.md` - how a person points a client at `/mcp`.
- `UPDATE: docs/server/CONFIGURE.md` - `mcpTools`.
- `UPDATE: docs/server/USERS.md` - the `mcp:call` grant.

## Steps

1. Define `MCP_PREFIX = '/mcp'` in `mcp.ts`.
2. Write `mcpHandler({ setting, caller, tools, otherwise })`, which answers `/mcp` and passes every other path to `otherwise`.
3. Answer 404 on `/mcp` when `mcpTools` is `none`.
4. Find the caller with `callerOf(request, { token, users }, 'mcp:call')`, with no `whose`.
5. Answer a refusal with its status and a JSON-RPC error, and read no body.
6. Refuse a caller of kind `session` with 401.
7. Build the list with `host.sessionlessTools({ principal })`, or `{ root: true }` for root, on each request.
8. Answer with `answerTools`, with `toolsChanged: 'list'` and no `runClient` or `mayRun`.
9. Add `MCP_PREFIX` beside `PROXY_PREFIX` in `withoutApi`.
10. In `run.ts`, build `mcpHandler` with the proxy handler as `otherwise`. Serve it in the place of `served`.
11. Read the host through a getter, because `run.ts` builds the host after the handler.
12. Read `mcpTools` from the config, check it is `none` or `all`, and default it to `none`.
13. Add the `mcp` subject: title "MCP gateway", operation `call`, groups `read: []` and `write: ['call']`.
14. Add `mcp:call` to the `member` role.
15. Write `docs/server/MCP.md`: the setting, the grant, and a VS Code `mcp.json` entry with a made-up host and token.
16. Write `mcpTools` in `docs/server/CONFIGURE.md` and `mcp:call` in `docs/server/USERS.md`.

## Validation

- `packages/server/test/mcp.test.ts` holds: with `none`, `/mcp` answers 404.
- The same file holds: with `all`, a member's token lists the seven session tools, and `create_session` runs.
- The same file holds: a guest's token lists two tools.
- The same file holds: a guest's call to `create_session` gets a refusal in its result.
- The same file holds: no token answers 401, a team key answers 403, and a session's token answers 401.
- The same file holds: a token in the query string alone answers 401.
- The same file holds: the deployment token is root and lists every sessionless tool.
- The same file holds: with `httpApi` off, `/mcp` answers 404.
- `pnpm --filter @ahpd/server test -- mcp` passes.
- `pnpm typecheck`, `pnpm boundary` and `pnpm run schema` pass.

## Resume
