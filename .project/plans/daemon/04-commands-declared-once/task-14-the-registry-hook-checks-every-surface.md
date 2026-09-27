---
title: The registry's authorize hook checks a command's scopes on every surface
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/scopes.ts#L34-L45](../../../../packages/server/src/commands/scopes.ts#L34-L45) - `checkScopes`, the hook both registries are built with"
  - "[code://packages/server/src/commands/registry.ts#L37-L57](../../../../packages/server/src/commands/registry.ts#L37-L57) - `cliRegistry` and `localRegistry`, built with `checkScopes`"
  - "[code://packages/server/src/commands/authorize.ts#L28-L33](../../../../packages/server/src/commands/authorize.ts#L28-L33) and [#L61-L87](../../../../packages/server/src/commands/authorize.ts#L61-L87) - `ROOT` and `authorizeOverHttp`, which identifies the caller and answers the actor"
  - "[code://packages/server/src/http.ts#L81-L107](../../../../packages/server/src/http.ts#L81-L107) - `apiHandler`, where `serve()` is given `authorizeOverHttp`"
  - "[code://packages/server/test/server-commands.test.ts#L71-L80](../../../../packages/server/test/server-commands.test.ts#L71-L80) and [#L104-L114](../../../../packages/server/test/server-commands.test.ts#L104-L114) - the registry-level cases, remote with and without the grant"
  - "[code://packages/server/test/server-http.test.ts#L443-L449](../../../../packages/server/test/server-http.test.ts#L443-L449) - the 403 and the WebSocket sentence, which only the hook produces now"
  - file:///github/cofold/packages/remote/src/serve.ts - `serve()` calls `authorize`, then `registry.execute` with what it answered as `request.actor`
  - file:///github/cofold/packages/commands/src/types/registry.ts - `AuthorizeRequest`, which carries `command`, `context` (with `context.request`) and `scopes`
  - "[plans/daemon/05-an-http-api/task-09-the-grants-each-command-needs.md](../05-an-http-api/task-09-the-grants-each-command-needs.md) - which grant each command needs"
---

## Objective

Every surface that runs a command goes through the registry's `authorize` hook, which checks the command's `scopes` against who is asking; `authorizeOverHttp` is the HTTP half that turns a request into a principal.

## Files

- `CREATE: packages/server/src/commands/scopes.ts` - `checkScopes`, the `authorize` hook `cliRegistry` and `localRegistry` are built with.
- `UPDATE: packages/server/src/commands/registry.ts:37-57` - `cliRegistry` and `localRegistry`, both built with `checkScopes`; the header comment says so.
- `UPDATE: packages/server/src/commands/authorize.ts:21-26, 61-87` - `authorizeOverHttp` identifies the caller (401) and answers the actor, and no longer checks scopes; `AuthorizeOptions` loses the registry.
- `UPDATE: packages/server/src/http.ts:81-107` - `apiHandler` hands `serve()` the identity hook alone.
- `UPDATE: packages/server/test/server-http.test.ts:443-449` - the scope refusal, which now comes from the hook.
- `UPDATE: packages/server/test/server-commands.test.ts:71-80, 104-114` - the registry-level cases.

## Steps

1. This applies decision [ahpd-commands-are-declared-with-cofold-commands](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) as written: "each command's `scopes` are ahpd's grant pairs, checked by the registry's `authorize` hook". It is a code fix to match an accepted decision, not a new one.
2. The hook reads the caller from `context.surface` and `context.request`: on `cli` the caller is the process owner and holds every grant; on `remote` the caller is the principal the HTTP half resolved, or the deployment token, which is root.
3. The hook refuses a missing grant with `HttpError(403, refusalReason(id, grant))`, the WebSocket's sentence, reading the command's scopes from the `scopes` it is handed.
4. `authorizeOverHttp` keeps the Bearer parsing, the token comparison and `users.verify`, refuses with 401 as it does now, and stops reading `scopesFor`.
5. The principal reaches the hook as `request.actor`: `serve()` in `/github/cofold/packages/remote/src/serve.ts` passes what its `authorize` returned, in the same change as [daemon/05 task 06](../05-an-http-api/task-06-serve-survives-a-malformed-request.md), and the hook reads it; ahpd takes it with `@cofold/remote` 0.3.1, which Softov publishes.
6. Which grant each command declares is [daemon/05 task 09](../05-an-http-api/task-09-the-grants-each-command-needs.md)'s; this task moves where the check runs and changes no scope. Whichever of the two lands second rebases on the other.

## Validation

- `packages/server/test/server-http.test.ts`, a person whose roles lack the command's grant is answered 403 with the WebSocket's sentence, and the case asserts the refusal came from the registry hook (a registry built with a hook that records its calls sees the command id); today the hook is never consulted, so that assertion fails.
- A registry-level case in `packages/server/test/server-commands.test.ts`: `execute` of a scoped command on surface `remote` with a principal lacking the grant rejects; today it resolves.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts` green.

## Resume

Done.
`checkScopes` is the `authorize` hook both registries are built with: it lets the terminal caller through, reads the caller from `context.request.actor`, and refuses a missing grant with `HttpError(403, refusalReason(id, grant))` over the `scopes` cofold hands it.
`authorizeOverHttp` only identifies: it answers `ROOT` for the deployment token, the verified principal for a person, and throws 401 on a host with no gate; `AuthorizeOptions` no longer carries the registry, so nothing reads `scopesFor`.
The hook is proved two ways because `apiHandler` is handed a registry the test process cannot see inside: `test/server-commands.test.ts` executes `daemon.config` on surface `remote` with a caller lacking the grant and gets the sentence, and the HTTP case's 403 sentence can only come from the hook now that `authorizeOverHttp` checks no scope.
`node_modules/.bin/vitest run packages/server/test/server-http.test.ts packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts` green, 52 cases; `pnpm typecheck` green.
