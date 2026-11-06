---
title: The model API is served on its gate
status: done
depends: [task-01-the-modelapi-key.md]
layer: server
refs:
  - "[code://packages/server/src/commands/run.ts#L631-L721](../../../../packages/server/src/commands/run.ts#L631-L721) - the chain and the listeners"
---

## Objective

`httpApi` serves `/api` and `/mcp`, and `modelApi` serves the proxy, each on its own listener or a shared one.

## Files

- `UPDATE: packages/server/src/commands/run.ts:631-721` - build the proxy only when `modelApi` is on, and chain each handler on the listener that carries it.
- `UPDATE: packages/server/src/commands/run.ts:2092-2096` - print `models on http://<host>:<port>` for a listener of its own, and close it at stop.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - the mount cases in a real daemon.

## Steps

1. Find the place of the API: the daemon's port, or `httpApi.port`.
2. For `modelApi: true` or no port, use the place of the API as the place of the model API.
3. When `httpApi` is off, use the daemon's port for that place.
4. For a `modelApi.port`, use that port, or the place of the API when the two ports are equal.
5. On each listener, chain `/mcp`, the proxy and `/api` that it carries, and then a 404.
6. Bind a listener of its own for the model API, on `modelApi.host` or the daemon's host.
7. Print its startup line, and close it when the daemon stops.
8. Add a case with `httpApi` on and `modelApi` off: `/api` answers, and `/v1/chat/completions` and `/models` give 404.
9. Add a case with `httpApi` off and `modelApi: true`: `/v1/models` answers on the daemon's port, and `/api` gives 404.
10. Add a case with `modelApi.port`: the model paths answer there only, with the same token.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/server test` passes, run alone.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** every step.
- **Found:** the connector's own model list is read at startup, so the off case checks that no POST reached the provider.
