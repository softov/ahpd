---
title: The probe lists the endpoint's models
status: todo
depends:
  - task-01-a-pi-turn-runs-on-the-endpoint.md
layer: "agent-pi, docs"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L126-L131](../../../../packages/agent-pi/src/agent.ts#L126-L131) - the probe"
  - "[code://packages/agent-pi/src/backend.ts#L398-L415](../../../../packages/agent-pi/src/backend.ts#L398-L415) - `runtimeModels`"
  - "[code://packages/agent-cofold/src/agent.ts#L749-L765](../../../../packages/agent-cofold/src/agent.ts#L749-L765) - cofold's `listModels`, the pattern"
---

## Objective

A pi agent with `baseUrl` lists the endpoint's models as `<id>/<model>`, read from its `/models` with the record's key.
The probe reads them again each time.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:398-415` - `runtimeModels` takes the record's endpoint, and registers it before it lists.
- `UPDATE: packages/agent-pi/src/agent.ts:126-131` - the probe reads the record as it is now.
- `UPDATE: packages/agent-pi/test/agent-pi-endpoint.test.ts` - the listing cases.
- `UPDATE: packages/agent-pi/README.md` - `baseUrl` and `apiKey` in the options table.
- `UPDATE: docs/updates/v0_15.md` - one line under *Unreleased*, *Plugins*.

## Steps

1. Give the registered provider a `refreshModels` that reads `<baseUrl>/models` with the key, as cofold's `listModels` does.
2. Make `runtimeModels` register the record's provider when it has a `baseUrl`, so the probe lists its models.
3. Answer no models from the endpoint when the listing fails, and keep the probe from failing.
4. Read the record at each probe, so an edit lists the new endpoint, as #269 does for cofold.
5. Add the README rows and the release note line.

## Validation

- The probe of a record with `baseUrl` lists the stub's models as `<id>/<model>`.
- An edit of `baseUrl` lists the new stub's models at the next probe.
- A failed listing answers no endpoint models and no error.
- `pnpm typecheck`, then `pnpm exec vitest run packages/agent-pi`.

## Resume

