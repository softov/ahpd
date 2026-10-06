---
title: The host's tools are offered to a session in a machine only where the machine can reach the daemon
status: implemented
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L143-L196](../../../../packages/agent-acp/src/session.ts#L143-L196) - `serversFor`, which adds the host's tools endpoint and says what it leaves out"
  - "[code://packages/agent-acp/src/session.ts#L236-L252](../../../../packages/agent-acp/src/session.ts#L236-L252) - `toolsServer`, the endpoint asked once per session"
  - "[code://packages/agent-acp/src/session.ts#L926-L955](../../../../packages/agent-acp/src/session.ts#L926-L955) - a session whose settings name a computer, spawned through the port's `how`"
  - "[code://packages/agent-acp/src/session.ts#L1081](../../../../packages/agent-acp/src/session.ts#L1081) - where the server list is built for `session/new` and `session/load`"
  - "[code://packages/sdk/src/types/agent.ts#L216](../../../../packages/sdk/src/types/agent.ts#L216) - `toolsServer()`, the endpoint the host serves on its listener"
  - "[code://packages/server/src/commands/run.ts#L333-L334](../../../../packages/server/src/commands/run.ts#L333-L334) - the endpoint's origin is the bound host, which may be a wildcard (`0.0.0.0`, `::`)"
---

## Objective

An ACP session that runs in a machine is handed the host's tools endpoint only when the machine can reach the daemon at the endpoint's address; otherwise the endpoint is left out and a log line says why, as `serversFor` already does for a server the agent cannot take.
A session on this host is unchanged.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:143-196` - `serversFor` takes where the session runs, and asks `toolsReachable(endpoint, where)` before adding the host's tools; a `false` answer says `host tools: <machine> cannot reach the daemon at <host:port>, so they were left out`.
- `UPDATE: packages/agent-acp/src/session.ts` - `toolsReachable(endpoint, where)`, one function: on this host it answers `true`; in a machine it answers `true` for now only when the endpoint's host is neither a loopback address nor a wildcard bind (`0.0.0.0`, `::`, `[::]`), since inside a container a wildcard address is the container itself. It is the one place the rule is made, so a reachable-address answer from the machine's port can replace it later.
- `UPDATE: packages/agent-acp/test/` - the cases below, in the test file that covers `serversFor` today.

## Steps

1. Pass whether the session was placed in a `computer://<id>`, and which, into `serversFor` from the call at `:1081`.
2. Write `toolsReachable`; never print the endpoint's token in the log line.
3. Leave the endpoint asked once per session, so a session that moves to this host later still has it.

## Validation

- A session in a machine whose endpoint URL is `http://127.0.0.1:<port>/...` gets no host tools server, and the log has the sentence; today it is handed an address it cannot reach.
- The same session with an endpoint on `http://0.0.0.0:<port>/...` or `http://[::]:<port>/...` gets no host tools server and the log has the sentence.
- The same session with an endpoint on a non-loopback, non-wildcard address gets it.
- A session on this host gets the endpoint as today.
- `pnpm --filter @ahpd/agent-acp test` green.

## Resume

- Implemented 2026-10-05. The refs' `session.ts` lines are stale: `serversFor` and the endpoint asked once per session live in `packages/agent-acp/src/session/opening.ts` since the session was split by area, and the call is in `open()` there.
- `toolsReachable(url, where)` is exported from `opening.ts`; `where` is the `computer://<id>` only when `placed()` returned a spawn. Loopback is `localhost`, any `127.x` and `[::1]`; wildcard is `0.0.0.0` and `[::]` (WHATWG `URL` spells `::` with brackets). An address that is not a URL counts as unreachable.
- The line names the machine and `host:port` only, never the token or the path.
- Tests: `packages/agent-acp/test/agent-acp-catalog.test.ts`, five unreachable addresses, one reachable, and two `toolsReachable` cases; a session on this host is the existing cases, unchanged.
