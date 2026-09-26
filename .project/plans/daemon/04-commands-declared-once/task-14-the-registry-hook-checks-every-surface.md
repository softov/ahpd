---
title: The registry's authorize hook checks a command's scopes on every surface
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/registry.ts#L35-L58](../../../../packages/server/src/commands/registry.ts#L35-L58) - both registries built with an `authorize` hook that allows everything"
  - "[code://packages/server/src/commands/authorize.ts#L59-L84](../../../../packages/server/src/commands/authorize.ts#L59-L84) - `authorizeOverHttp`, which today both identifies the caller and checks the scopes"
  - "[code://packages/server/src/http.ts#L49-L60](../../../../packages/server/src/http.ts#L49-L60) - where `serve()` is given `authorizeOverHttp`"
  - "file:///github/cofold/packages/remote/src/serve.ts - `serve()` calls `authorize` with the request, then `registry.execute` with `request: { metadata: { headers } }` and no `actor`"
  - "file:///github/cofold/packages/commands/src/types/registry.ts - `AuthorizeRequest`, which carries `command`, `context` (with `context.request`) and `scopes`"
  - "[plans/daemon/05-an-http-api/task-09-the-grants-each-command-needs.md](../05-an-http-api/task-09-the-grants-each-command-needs.md) - which grant each command needs"
---

## Objective

Every surface that runs a command goes through the registry's `authorize` hook, which checks the command's `scopes` against who is asking; `authorizeOverHttp` is the HTTP half that turns a request into a principal.

## Files

- `UPDATE: packages/server/src/commands/registry.ts:35-58` - `cliRegistry` and `localRegistry` take the hook that checks scopes; the comment at lines 1-18 says so.
- `UPDATE: packages/server/src/commands/authorize.ts:59-84` - `authorizeOverHttp` identifies the caller (401) and no longer checks scopes.
- `UPDATE: packages/server/src/http.ts:49-60` - how the principal reaches the hook.
- `UPDATE: test/server-http.test.ts` - the scope refusals, proved through the hook.

## Steps

1. This applies decision [ahpd-commands-are-declared-with-cofold-commands](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) as written: "each command's `scopes` are ahpd's grant pairs, checked by the registry's `authorize` hook". It is a code fix to match an accepted decision, not a new one.
2. The hook reads the caller from `context.surface` and `context.request`: on `cli` the caller is the process owner and holds every grant; on `remote` the caller is the principal the HTTP half resolved, or the deployment token, which is root.
3. The hook refuses a missing grant with `HttpError(403, refusalReason(id, grant))`, the WebSocket's sentence, reading the command's scopes from the `scopes` it is handed.
4. `authorizeOverHttp` keeps the Bearer parsing, the token comparison and `users.verify`, refuses with 401 as it does now, and stops reading `scopesFor`.
5. The principal reaches the hook as `request.actor`, per [serve() hands the principal its authorize resolved to the registry as the actor](../../../decisions/serve-hands-the-principal-to-the-registry-as-actor.md): `serve()` in `/github/cofold/packages/remote/src/serve.ts` passes what its `authorize` returned, in the same change as [daemon/05 task 06](../05-an-http-api/task-06-serve-survives-a-malformed-request.md), and the hook reads it; ahpd takes it with `@cofold/remote` 0.3.1, which Softov publishes.
6. Which grant each command declares is [daemon/05 task 09](../05-an-http-api/task-09-the-grants-each-command-needs.md)'s; this task moves where the check runs and changes no scope. Whichever of the two lands second rebases on the other.

## Validation

- `test/server-http.test.ts`, a person whose roles lack the command's grant is answered 403 with the WebSocket's sentence, and the case asserts the refusal came from the registry hook (a registry built with a hook that records its calls sees the command id); today the hook is never consulted, so that assertion fails.
- A registry-level case in `test/server-commands.test.ts`: `execute` of a scoped command on surface `remote` with a principal lacking the grant rejects; today it resolves.
- `node_modules/.bin/vitest run test/server-http.test.ts test/server-commands.test.ts test/server-cli.test.ts` green.

## Resume
