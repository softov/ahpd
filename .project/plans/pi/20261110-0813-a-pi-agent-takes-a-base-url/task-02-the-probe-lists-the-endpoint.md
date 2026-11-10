---
title: The probe lists the endpoint's models
status: implemented
depends:
  - task-01-a-pi-turn-runs-on-the-endpoint.md
layer: "agent-pi, docs"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L126-L131](../../../../packages/agent-pi/src/agent.ts#L126-L131) - the probe"
  - "[code://packages/agent-pi/src/backend.ts#L398-L415](../../../../packages/agent-pi/src/backend.ts#L398-L415) - `runtimeModels`"
  - "[code://packages/agent-cofold/src/agent.ts#L749-L765](../../../../packages/agent-cofold/src/agent.ts#L749-L765) - cofold's `listModels`, the pattern"
---

## Objective

A pi agent with `baseUrl` lists the endpoint's models as `<id>/<model>`, read from its `/models`.
The read carries the record's key, or no `Authorization` header when the record has none.
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
- The probe of a keyless record lists the stub's models, and the listing carries no `Authorization` header.
- An edit of `baseUrl` lists the new stub's models at the next probe.
- A failed listing answers no endpoint models and no error.
- `pnpm typecheck`, then `pnpm exec vitest run packages/agent-pi`.

## Resume

- **Done so far:** `EndpointOptions` names the record's provider id, `baseUrl` and `apiKey`, and one `registerEndpoint` registers it on any runtime, a session's or the probe's, with a `refreshModels` that reads `<baseUrl>/models` with the key again. `RuntimeModels` takes the endpoint, and `runtimeModels` registers it on the runtime it builds before `getAvailable()`, so the probe lists its models beside pi's own and a provider of the same id is replaced for that list. The probe reads `options.recordOf?.()` on each call, so an edit of the record's `baseUrl` lists the new endpoint's models at the next probe. A failed listing registers the provider with no models, and the probe answers what it has rather than failing. The endpoint test covers a listing under the record's id, the key the listing carried, an edit of `baseUrl`, and a failed listing. The README's options and record tables were added with task 01; this task adds the two paragraphs they leave untrue and one line under *Unreleased*, *Plugins* in `docs/updates/v0_15.md`. A record with no `apiKey` registers the placeholder key, so pi lists its provider, and both `<baseUrl>/models` reads ask for no `Authorization` header; the endpoint test covers that listing and that absence.
- **Next action:** review. Both tasks are implemented; nothing is left in the plan's steps.
- **Open questions:** none.
- **Watch out for:** the suite is 275 of 276 on this box; `agent-pi-lazy.test.ts` fails only at its own 4000 ms import budget, with the cold import of the plugin entry measured at about 4.0 s here and at 7.985 s and 8.389 s under the other builds' load. The same case passes with a 30 s budget.

Files changed by this task: `packages/agent-pi/src/backend.ts`, `packages/agent-pi/src/agent.ts`, `packages/agent-pi/test/agent-pi-endpoint.test.ts`, `packages/agent-pi/README.md`, `docs/updates/v0_15.md`.

