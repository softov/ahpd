---
title: A harness answers its own setting
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/agent.ts#L626-L700](../../../../packages/sdk/src/types/agent.ts#L626-L700) - `Agent`, which gains the answerers"
  - "[code://packages/sdk/src/types/completions.ts#L48](../../../../packages/sdk/src/types/completions.ts#L48) - `SessionConfigAnswerer`, the type each answerer has"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1615-L1655](../../../../packages/sdk/src/host/sessionmethods.ts#L1615-L1655) - the lookup by name, which asks the harness first after this task"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L345-L353](../../../../packages/sdk/src/host/sessionconfig.ts#L345-L353) - `sessionSchema`, where the harness's key gets `enumDynamic`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L655-L662](../../../../packages/sdk/src/plugins/plugins.ts#L655-L662) - the plugin fold sets `enumDynamic` beside its answerer, the pattern to copy"
---

## Objective

A harness can answer `sessionConfigCompletions` for a key of its own schema.
The host marks that key `enumDynamic`, and asks that harness only when the ask names it.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:626-700` - `Agent` gains `completions?: Record<string, SessionConfigAnswerer>`.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:345-353` - `sessionSchema` marks each answered key of the harness `enumDynamic`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1615-1655` - the lookup asks the named harness's answerer before a plugin's.
- `CREATE: packages/sdk/test/session-config-answerer.test.ts` - the cases below.
- `UPDATE: docs/sdk/AGENT.md` - `completions` on `Agent`.

## Steps

1. Add `completions` to `Agent`, with a doc comment that says the keys are keys of `schema()`.
2. In `sessionSchema`, add `enumDynamic: true` to each key that `agent.completions` answers.
3. Skip a `completions` key that `schema()` does not declare, and log one line for it.
4. In `sessionConfigCompletions`, find the agent by `params.provider`.
5. Call that agent's answerer for the property when it has one, in the same `try` as a plugin answerer.
6. Keep the plugin answerer as the next choice, and the host's own keys after it.
7. Run the `resolveSessionConfig` path once, and check that `seeded` fills the harness key's `enum`.
8. Document `completions` in `docs/sdk/AGENT.md`.

## Validation

- A harness with `completions.bot` gives `bot` with `enumDynamic: true` in `resolveSessionConfig`.
- `sessionConfigCompletions` with that harness's `provider` answers that harness's items.
- The same property asked with another `provider` does not call that answerer.
- An answerer that throws gives `{ items: [] }`.
- `pnpm -s typecheck` passes, and the touched tests pass.

## Resume

Implemented 2026-10-30.
`Agent.completions` is the map, and `sessionSchema` marks each answered key `enumDynamic`, skipping an undeclared key with one log line.
`seeded` takes an optional third map, so `resolveSessionConfig` fills the harness key's `enum` from the same answerer.
`sessionConfigCompletions` asks the named provider's answerer before a plugin's, in the same `try`.
`packages/sdk/test/session-config-answerer.test.ts` covers the seed, the provider match, a throw and an undeclared key, and `docs/sdk/AGENT.md` documents `completions`.
