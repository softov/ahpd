---
title: A test walks every first-party schema
status: done
depends:
  - task-01-every-schema-entry-point-checks.md
  - task-02-claude-lists-models-and-sources.md
  - task-03-plugin-schemas-have-no-gap.md
  - task-04-the-host-config-names-its-maps.md
layer: "server"
refs:
  - "[code://packages/activepieces/test/pieces.test.ts#L62-L69](../../../../packages/activepieces/test/pieces.test.ts#L62-L69) - the pattern: a stub host that keeps what `apply` registers"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1500](../../../../packages/sdk/src/host/sessionmethods.ts#L1500) - a backend's session config schema"
---

## Objective

A test fails when any first-party schema has a gap, so a new gap cannot merge.

## Files

- `CREATE: packages/server/test/schema-gaps.test.ts` - walk every schema that the first-party plugins and the host register.

## Steps

1. Load each first-party plugin with a stub host that keeps each schema it registers.
2. Walk each manifest's `optionsSchema`.
3. Walk each engine, adapter, capability input, trigger, session config property and agent schema.
4. Walk each backend's session config schema.
5. Walk the host's `configSchema`, `mcpServerSchema` and `proxySchema`.
6. Fail the test with each gap's plugin, place and path.

## Validation

- The test passes.
- Put `{ type: 'object' }` back on Claude's `env`, and the test fails with that path.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Resume

- **Done so far:** `packages/server/test/schema-gaps.test.ts` loads all eleven first-party plugins with a stub host. It walks each manifest's `optionsSchema`, each engine's `schema` and each adapter's `schema`. It walks each backend's session config schema through `open`, each capability's `input` and each trigger's `configSchema`. It walks each session config property and each agent's `schema()`. It also walks the host's `configSchema`, `mcpServerSchema` and `proxySchema`. It has 23 cases: eleven manifests, eleven registration walks and one host walk. With `{ type: 'object' }` back on Claude's `env`, it fails with `agent-claude: engine claude env: object with no properties`.
- **Next action:** Softov reads the report.
- **Files:** `packages/server/test/schema-gaps.test.ts` (new).
- **Open questions:** none.
- **Departures:** the test skips a capability with no `input`, because a capability that takes nothing leaves `input` out. Activepieces is applied with `configDir: ''`, so no piece logo is fetched and the walk never reaches the network. The test opens a record of the engine's own template to read a backend's session config schema. `published` and the session config factory are not exported.
- **Watch out for:** the activepieces walk needs the shipped pieces only. A piece that is not shipped makes `apply` call `install`.
