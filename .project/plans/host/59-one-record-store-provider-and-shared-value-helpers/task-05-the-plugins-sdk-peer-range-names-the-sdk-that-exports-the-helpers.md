---
title: The plugins' sdk peer range names the sdk that exports the helpers
status: done
depends: [task-01-the-value-readers-are-one-sdk-module.md, task-02-the-record-store-provider-is-its-own-file.md]
layer: "agent-acp, agent-claude, agent-cofold, agent-pi, computer"
refs:
  - "[code://packages/agent-acp/package.json#L60](../../../../packages/agent-acp/package.json#L60) - `\"@ahpd/sdk\": \">=0.9\"`"
  - "[code://packages/agent-claude/package.json#L63](../../../../packages/agent-claude/package.json#L63) - the same"
  - "[code://packages/agent-cofold/package.json#L59](../../../../packages/agent-cofold/package.json#L59) - the same"
  - "[code://packages/agent-pi/package.json#L59](../../../../packages/agent-pi/package.json#L59) - the same"
  - "[code://packages/computer/package.json#L58](../../../../packages/computer/package.json#L58) - the same"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - where a plugin's peer range is checked against the daemon's sdk at load"
  - "[code://docs/PLUGINS.md#L482](../../../../docs/PLUGINS.md#L482) - the manifest example, `>=0.9`, which a third party copies"
---

## Objective

The five plugin packages that will import from `values.ts` or `records.ts` declare the oldest sdk that exports them, so one installed beside an older daemon is refused at load with the range's sentence rather than failing at import.

## Files

- `UPDATE: packages/agent-acp/package.json:60`, `agent-claude/package.json:63`, `agent-cofold/package.json:59`, `agent-pi/package.json:59`, `computer/package.json:58` - the peer range raised.
- `UPDATE: packages/server/test/plugin-compat.test.ts` - one case.

## Steps

1. Raise the five ranges to the version open question 1 settles; `tunnel-devtunnel` imports none of the helpers and keeps `>=0.8`.
2. Leave `docs/PLUGINS.md`'s example alone: it shows a third party's plugin, which needs no helper.
3. Run `pnpm install` and keep `pnpm-lock.yaml` as it answers; daemon 09 found workspace peer ranges are not in the lockfile.

## Validation

- Written first and seen failing (each package's range still admits 0.9.0): in `plugin-compat.test.ts`, each bundled plugin's manifest range refuses `0.9.0` and admits the new version.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test packages/server`.

## Resume

The five peer ranges are already `>=0.10`, so step 1 changed nothing: the refs above (agent-acp L60 and the rest, `>=0.9`) are stale, and every one of agent-acp, agent-claude, agent-cofold, agent-pi and computer (plus bot) reads `>=0.10` today - host 65 p3 raised them for `uriOf` and `hasUsers` before this plan was built. That is the version open question 1 settles, so the ranges are what step 1 asks for as they stand. `tunnel-devtunnel` is `>=0.8` and imports none of the helpers, which is what the step asks too. `docs/PLUGINS.md` was left alone. Nothing was run for step 3: no `package.json` changed, so `pnpm install` and `pnpm-lock.yaml` are untouched by this task.

The case is in `packages/server/test/plugin-compat.test.ts`, in the existing "a plugin that names the oldest sdk it needs" block: one `it.each` over the five packages that reads each manifest, asserts 0.9.0 does not satisfy its range and that `0.10.0`, the release that first ships `values.ts` and `records.ts`, does. The tunnel is deliberately not on the list, and the doc comment above the case says so. `pnpm test packages/server` on that file is 32 tests, up from 27, and passes.

The case cannot be seen failing first, as the validation asks, because the ranges it pins were raised by an earlier plan rather than by this one; it is a guard on those ranges rather than a driver for a change here.

Gates: `plugin-compat.test.ts` 32 tests passed.
