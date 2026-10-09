---
title: ahpd takes the cofold release
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://package.json#L34-L36](../../../../package.json#L34-L36) - the root cofold ranges"
  - "[code://packages/agent-cofold/package.json#L66-L69](../../../../packages/agent-cofold/package.json#L66-L69) - the package's cofold ranges"
  - "[code://pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) - `minimumReleaseAgeExclude`, which must let a release from today in"
  - npm://@cofold/agents@^0.2.1 - the target range
  - npm://@cofold/tools@^0.4.0 - the target range
  - npm://@cofold/model-openai-compat@^0.2.0 - the target range
  - npm://@cofold/store-file@^0.2.1 - the target range
---

## Objective

ahpd installs agents 0.2.1, tools 0.4.0, model-openai-compat 0.2.0 and store-file 0.2.1, and the schema gate has run.
This task lands with task 02 on one branch, because the range move alone breaks every approval.

## Files

- `UPDATE: package.json:34-36` - the four `@cofold/*` ranges.
- `UPDATE: packages/agent-cofold/package.json:66-69` - the four `@cofold/*` ranges.
- `UPDATE: pnpm-workspace.yaml` - `minimumReleaseAgeExclude` names the four cofold packages, and `overrides` points tools and store-file at the packed tarballs while they are unpublished.
- `UPDATE: pnpm-lock.yaml` - the resolved versions.

## Steps

1. Set the ranges to `^0.2.1`, `^0.4.0`, `^0.2.0` and `^0.2.1` in both package files.
2. Add the two `@cofold/tools` and `@cofold/store-file` `overrides` to `pnpm-workspace.yaml`, each at `file:.cofold-pack/<tarball>`.
3. Run `pnpm install --no-frozen-lockfile` once.
4. Check that `pnpm-lock.yaml` resolves agents 0.2.1 and tools 0.4.0.
5. Run `node tools/schema.mjs`, so `tools/ahp.strict.schema.json` exists.
6. Run `pnpm build` and `pnpm typecheck`.

## Validation

- `pnpm ls -r @cofold/agents @cofold/tools` prints 0.2.1 and 0.4.0.
- `pnpm typecheck` passes.
- "offers allow once, allow the tool for this session, and deny" no longer fails with `ENOENT`.

## Resume

- The two `overrides` in `pnpm-workspace.yaml` are the tarball install and do not ship: they come out when cofold publishes tools 0.4.0 and store-file 0.2.1.
