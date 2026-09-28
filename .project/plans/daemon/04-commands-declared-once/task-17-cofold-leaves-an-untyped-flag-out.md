---
title: cofold leaves a boolean flag nobody typed out of the canonical input, released by Softov
status: done
depends: [task-12-cofold-fields-say-whether-they-negate.md]
layer: "cofold commands"
refs:
  - file:///github/cofold/packages/commands/src/input.ts - line 129 in `canonicalFromCli` and line 173 in `canonicalFromObject`, the `false` written for an untyped flag
  - file:///github/cofold/packages/commands/src/context.ts - line 75, `flag(name)`, which must still answer `false`
  - "[code://packages/server/package.json](../../../../packages/server/package.json) - `@cofold/commands` `^0.2.1`"
---

## Objective

In the cofold repository, a boolean flag with no typed value, no environment value and no declared default is absent from the canonical input from the terminal and from an object, `context.flag` still answers `false` for it, and ahpd depends on the release that carries this, per decision [an-untyped-flag-stays-absent-in-cofold-input](../../../decisions/an-untyped-flag-stays-absent-in-cofold-input.md).

## Files

- `UPDATE: /github/cofold/packages/commands/src/input.ts:129` - `canonicalFromCli` writes nothing where it wrote `false`.
- `UPDATE: /github/cofold/packages/commands/src/input.ts:173` - `canonicalFromObject` the same.
- `UPDATE: /github/cofold/packages/commands/src/context.ts:75` - `flag` answers `false` for an absent key, if it does not already.
- `UPDATE: /github/cofold/packages/commands/src/input.test.ts` - the cases below.
- `UPDATE: packages/server/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` - the released version.

## Steps

1. In `/github/cofold/packages/commands`, drop the `else input[name] = false` branch in `canonicalFromCli` and the `isFlag` branch that writes `false` in `canonicalFromObject`.
2. Make `context.flag` answer `false` when the key is absent, and check `finish` and schema validation accept a missing boolean that is not required.
3. Search the cofold repository for readers of a canonical boolean (`=== false`, `input[...]` on a flag) in `packages/terminal`, `packages/remote` and `packages/mcp`, and keep each one's behaviour.
4. The cofold tree may hold other people's uncommitted work: change only what this task names, and commit nothing there without Softov's approval.
5. The release is Softov's, through cofold's `release.yml` from a `release-*` tag: stop when the cofold tests are green and ask him to publish. It is a patch, 0.2.2, per the decision: the dependents' `^0.2` ranges take it.
6. Once it is on npm, move ahpd's `@cofold/commands` (and `@cofold/terminal` or `@cofold/remote` if the release moves them) to it, run `pnpm install --no-frozen-lockfile --store-dir /tmp/pnpm-store` once, and add the version to `minimumReleaseAgeExclude` if it is younger than the minimum age.
7. In ahpd, check every boolean `optionsFrom` folds (`packages/server/src/commands/options.ts`) still gives the same options for an untyped flag, since each now reads `undefined` where it read `false`.

## Validation

- cofold `input.test.ts`: a command with a boolean `updateCheck` and no default gives `{}` from `canonicalFromCli` with no argv and from `canonicalFromObject` with `{}`; `--no-update-check` (declared `negatable: true`) gives `{ updateCheck: false }` and `--update-check` gives `{ updateCheck: true }`. Today the first two give `{ updateCheck: false }`, so the case fails.
- cofold `context.test.ts`: `flag('updateCheck')` answers `false` for the absent key.
- cofold's own run for `packages/commands`, `packages/terminal`, `packages/remote` and `packages/mcp` green.
- In ahpd, `pnpm install --frozen-lockfile` clean, and `pnpm test` and `pnpm boundary` green after the bump.

## Resume

Steps 1 to 4 are done in `/github/cofold`, uncommitted, on `main`, in `packages/commands/src/input.ts` and `packages/commands/src/input.test.ts` only:

- Seen to fail first: the two existing cases that wanted `dryRun: false`, and the new "leaves a flag nobody typed out of the input" case, which answered `{ updateCheck: false }` where `{}` was wanted. "Keeps a flag that was typed, either way round" already passed, because `--update-check` and `--no-update-check` reach the canonical input as `true` and `false` today.
- `canonicalFromCli` and `canonicalFromObject` leave a flag with nothing typed, no environment value and no declared default out of the input. `context.flag` already answered `false` for an absent key and its case in `context.test.ts` already pinned that, so nothing changed there.
- No reader of a canonical boolean in `packages/terminal`, `packages/remote` or `packages/mcp` depends on an absent flag being `false`: the terminal reads flags through `context.flag`, and the `=== false` hits are a schema keyword and an option object, not the canonical input.
- cofold's whole suite is green: 70 files, 828 tests, no type errors. Nothing was committed there.

Stopped at step 5, waiting on Softov: `packages/commands` is still 0.2.1 and nothing is tagged or published. It is a minor release, 0.3.0, because a consumer reading `false` for an untyped flag now reads `undefined`. Softov publishes it; steps 6 and 7 then move ahpd's `@cofold/commands` to it and check every boolean `optionsFrom` folds.

Committed in cofold on 2026-09-27 as `db8f7af` ("commands: a flag nobody typed stays out of the input; 0.2.2"), at 0.2.2 as Softov chose rather than 0.3.0. Waiting on Softov to tag and publish it; steps 6 and 7 follow the release.

- 2026-09-27: `@cofold/commands` 0.2.2 is on npm (published 15:37 UTC). Step 6: `packages/server` takes `^0.2.2`, the lockfile holds one `@cofold/commands@0.2.2` that `@cofold/terminal` and `@cofold/remote` share through `^0.2`, and `minimumReleaseAgeExclude` names 0.2.2 in place of 0.2.1. Step 7: every flag `optionsFrom` folds keeps its options for a flag nobody typed, checked by the pinning cases in `server-cli.test.ts` and `server-commands.test.ts`, which pass unchanged. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm boundary` and `pnpm test` (102 files, 1348 tests) green. Task 06 can start.
