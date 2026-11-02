---
title: /mcp opens to a person's token
status: implemented
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

Built. `/mcp` is served on the listener that carries `/api`, beside `/v1`, and `mcpTools` in `config.json` decides what it serves: `none`, the default, answers 404, and `all` serves the sessionless tools the caller's grants allow. `mcpHandler` in `packages/server/src/mcp.ts` reads the setting, finds the caller with `callerOf(request, caller, 'mcp:call')`, refuses a session's token with 401, builds the list with `host.sessionlessTools(caller)` on every request, and answers through `answerTools` with `toolsChanged: 'list'`. A refusal is answered as a JSON-RPC error with the refusal's status, before the body is read. `withoutApi` treats `/mcp` as an API path beside `/api` and `/v1`, and `run.ts` builds the door in front of the proxy handler, reading the host through a closure because the chain is built before `createHost`. The `mcp` subject is in `OPERATIONS` (`call`, write group); `member` and `guest` hold `mcp:call`, and a team key cannot, because `verifyTeamKey` admits only the proxy grants. `docs/server/MCP.md` is new and `CONFIGURE.md`, `USERS.md`, `docs/sdk/USERS.md`, the sidebar and `docs/README.md` name the setting and the grant.

Departures. The Answers table names `member` for `mcp:call`, but the Validation asks a guest's token to reach the door and list two tools, so the built-in `guest` holds `mcp:call` too: the door is one check and each tool's grants are the second, which leaves a guest with `list_sessions` and `get_session_context`. `mcpHandler` takes a `version` beside `setting`, `caller`, `tools` and `otherwise`, because `initialize` names the server as `ahpd` with the daemon's version, and `tools` is `(caller: ToolCaller) => BoundTool[]` so the root-against-person choice lives in one place. `config.ts` was not the whole setting: `mcpTools` is also read in `commands/options.ts` (`Options`, `serverFields`, `FILE_ONLY` and `optionsFrom`), which is the path every config key takes to `run.ts`, and it is checked by the config schema's `enum`, which `checkConfig` refuses at load, rather than by a branch. `packages/sdk/src/types/index.ts` exports `ToolCaller` and `SessionlessToolCall`, which `mcp.ts` names and the surface did not offer. Validation says a guest's `create_session` "gets a refusal in its result"; it gets a JSON-RPC error, `No tool named create_session`, because the tool is not in that caller's list, and the test asserts the error. The `session` branch of `mcpHandler` is defensive: `run.ts` passes no `whose`, and the test reaches the branch by handing `door()` one. The guest and member people in the test hold the `backend` team, because `callerOf` charges a person's call by scope and refuses a person in no team before any tool is read, as on `/v1`. `packages/sdk/test/users.test.ts` and `users-host.test.ts` expected the old guest grants and the fifteen subjects, so their expected rows now say `mcp:call` and `mcp`; no other case changed.

Gates: `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass; `pnpm run schema` regenerates the strict schema; `packages/server/test/mcp.test.ts` passes 15 of 15; `packages/sdk/test/toolserver.test.ts` passes 27 of 27 and `packages/sdk/test/toolauth.test.ts` 4 of 4 with their cases unchanged; `users.test.ts` 41 of 41, `users-host.test.ts` 18 of 18, `users-gate-tables.test.ts` 4 of 4, `users-gate-names.test.ts` 17 of 17, `users-tokens.test.ts` 35 of 35, `proxy-listener.test.ts` 47 of 47 and `token-command.test.ts` 20 of 20 pass; `config-check.test.ts` 66 of 66, `server-http.test.ts` 68 of 68, `commandparser.test.ts` 10 of 10, `server-root-config.test.ts` 52 of 52, `schema-gaps.test.ts` 34 of 34 and `server-configure.test.ts` 40 of 40 pass.
