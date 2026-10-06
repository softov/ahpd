---
title: The plugins' sdk peer range names the sdk that exports the helpers
status: todo
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
