---
title: List every provider under its own id
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L233-L269](../../../../packages/agent-cofold/src/agent.ts#L233-L269) - `connectionOf`"
  - "[code://packages/agent-cofold/src/agent.ts#L546-L577](../../../../packages/agent-cofold/src/agent.ts#L546-L577) - `listModels`, `catalogueOf` and `knownCatalogue`"
  - "[code://packages/agent-cofold/src/agent.ts#L733-L739](../../../../packages/agent-cofold/src/agent.ts#L733-L739) - `probe`"
  - "[code://packages/agent-cofold/src/agent.ts#L833](../../../../packages/agent-cofold/src/agent.ts#L833) - `create`"
---

## Objective

The model list has the models of every file provider, each id as `<provider id>/<model id>`, and each provider is asked with its own key.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts` - add `connectionsOf`, change the key rule in `connectionOf`, and make `probe` and `create` merge the catalogues.
- `UPDATE: packages/agent-cofold/test/agent-cofold-models.test.ts` - tests for two providers, their prefixes and their keys.

## Steps

1. Add `connectionsOf(options, settings, credentials, harness)` next to `connectionOf`.
2. Without an explicit `baseUrl`, return one connection per file provider, with the provider id as `prefix`.
3. With an explicit `baseUrl`, or with no file provider, return the one connection of `connectionOf`.
4. Give each file provider connection its own `apiKey` and `headers`.
5. Give the lent key and `options.apiKey` only to the connection whose base URL origin equals `resourceOf`.
6. Remove the fallback to `providers[0].apiKey` for an endpoint that is not that provider's.
7. Apply the same key rule in `connectionOf`, so a turn uses the key that its listing used.
8. Make `probe` ask every connection in parallel and merge the rows in file order.
9. Keep the configured reference first in `probe` when no catalogue has it.
10. Make the catalogue that `create` gives a session merge `knownCatalogue` over every connection.
11. Add a test with two file providers that expects both sets of ids, each under its provider id.
12. Add a test that each provider's `GET /models` carries that provider's key and no other key.
13. Add a test that a provider that fails adds no rows while the other still lists.
14. Change the test at line 190 so that it expects `open_router/` ids with no `model` configured.

## Validation

- `pnpm -s vitest run packages/agent-cofold` passes.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** `connectionsOf` answers one `Connection` per file provider.
  Each connection has its own id, `apiKey` and `headers`.
  An explicit `baseUrl` or an empty file gives the one connection `connectionOf` resolves.
  `connectionOf` and `connectionsOf` share `keyOf`.
  A file provider's key goes only to its own endpoint.
  The lent key and the plugin key go only where the endpoint's origin is `resourceOf`.
  The `providers[0].apiKey` fallback is gone.
  `probe` asks every connection in parallel and merges the rows in file order.
  It keeps the configured reference first when no catalogue carries it.
  `create` merges `knownCatalogue` over every connection.
  Tests added: two providers listed under their own ids, each asked with its own key and no other.
  One failing provider leaves the others listing.
  The resolve-back test now runs with no configured model.
  The full `packages/agent-cofold` suite passes, and `pnpm -s typecheck` passes.
- **Next action:** none. Task 02 follows.
- **Files:** `packages/agent-cofold/src/agent.ts`, `packages/agent-cofold/test/agent-cofold-models.test.ts`, this task file, `plan.md` and `plans/index.md`.
- **Open questions:** none.
- **Departures:** none.
- **Watch out for:** a key must never reach an endpoint of another provider.
  It does not: `keyOf` picks a key by the connection's own base URL and the origin `resourceOf` names.
  `connectionOf` still sends a named provider's `headers` with an explicit `baseUrl`, as it did before.
  This task moved keys only.
