---
title: A cofold field says whether its flag negates, released by Softov
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "cofold commands"
refs:
  - file:///github/cofold/packages/commands/src/types/field.ts - `CliField` at lines 59-65, which has no `negatable`
  - file:///github/cofold/packages/commands/src/command.ts - lines 79-96, where an option is built from a field's `cli`
  - file:///github/cofold/packages/commands/src/argv.ts - line 29, the negation registered for `negatable: true` or any flag spelled `--no-X`
  - "[code://packages/server/package.json](../../../../packages/server/package.json) - `@cofold/commands` `^0.2.0`"
---

## Objective

In the cofold repository, a field's `cli.negatable: true` gives its flag a `--no-X` form that sets the field to `false`, `cli.negatable: false` on a `--no-X` flag registers no positive, and ahpd depends on the release that carries both.

## Files

- `UPDATE: /github/cofold/packages/commands/src/types/field.ts:59-65` - `CliField` gains `negatable?: boolean`, documented as what it is.
- `UPDATE: /github/cofold/packages/commands/src/command.ts:79-96` - the option built from a field carries `negatable` when the field's `cli` sets it.
- `UPDATE: /github/cofold/packages/commands/src/argv.ts:29` - the automatic opposite of a `--no-X` flag is registered only when `negatable` is not `false`.
- `UPDATE: /github/cofold/packages/commands/src/argv.test.ts` and `command.test.ts` - the cases below.
- `UPDATE: packages/server/package.json` and `pnpm-lock.yaml` - `@cofold/commands` (and `@cofold/terminal` if the release moves both) at the released version.

## Steps

1. Apply decision [a-cofold-field-says-whether-its-flag-negates](../../../decisions/a-cofold-field-says-whether-its-flag-negates.md) and decision [no-plugins-has-no-positive](../../../decisions/no-plugins-has-no-positive.md) in `/github/cofold/packages/commands`.
2. `CliField.negatable`: pass it through in `command.ts` beside `hidden`.
3. `argv.ts` `addToTable`: register the inverse when `option.negatable === true`, or when the flag is spelled `--no-X` and `option.negatable !== false`.
4. The cofold tree holds other uncommitted work in `packages/remote`; change only `packages/commands`, and commit nothing there without Softov's approval.
5. The release is Softov's: stop after the cofold tests are green and ask him to publish; do not publish.
6. Once the release is on npm, move ahpd's `@cofold/commands` range to it, run `pnpm install --no-frozen-lockfile` once (with `--store-dir /tmp/pnpm-store` in this environment), and add the version to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` if the release is younger than the minimum age.

## Validation

- cofold `argv.test.ts`: a boolean field `updateCheck` with `cli: { negatable: true }` parses `--no-update-check` to `false` and `--update-check` to `true`; today the field cannot declare `negatable`, so the first assertion fails.
- cofold `argv.test.ts`: a boolean field spelled `--no-plugins` with `cli: { negatable: false }` refuses `--plugins` as `Unknown option --plugins.`; today `--plugins` parses.
- cofold's own test run for `packages/commands` green.
- In ahpd, `pnpm install --frozen-lockfile` clean and `pnpm boundary` green after the bump.

## Resume

Done. Released 2026-09-26 from `/github/cofold` by its `release.yml` as `@cofold/commands@0.2.1`.

- `src/types/field.ts:68-73`: `CliField.negatable?: boolean`, documented as what `true` and `false` each do. The `OptionSpec.negatable` doc at `src/types/field.ts:27-31` now says a `--no-X` flag answers to `--X` unless it is `false`.
- `src/command.ts:96`: `commandFor` carries `negatable` onto the option when the field's `cli` sets it, beside `hidden`.
- `src/argv.ts:29`: the automatic opposite of a `--no-X` flag is registered only when `option.negatable !== false`; `negatable: true` still derives `--no-X` for a positive flag.
- `src/argv.test.ts:95-123`: `updateCheck` with `cli: { negatable: true }` reads `--no-update-check` as `false` and `--update-check` as `true`; `noPlugins` spelled `--no-plugins` with `negatable: false` reads `--no-plugins` as `true` and refuses `--plugins` as `Unknown option --plugins.`.
- `src/command.test.ts:113-127`: `negatable: true` and `false` reach the option, and a field that sets neither has no `negatable` key.

Before the fix the three new tests failed for the reasons named: `Unknown option --no-update-check.`, `--plugins` parsed without throwing, and the option had no `negatable`.

Verified in `/github/cofold`: `node_modules/.bin/vitest run packages/commands` 9 files, 109 tests passed; in `packages/commands`, `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` and `../../node_modules/.bin/tsc -p tsconfig.test.json` clean.

Not known to the plan: `command.ts` and `command.test.ts` are CRLF in git and the other touched files are LF; each keeps its own line endings. `@cofold/terminal` builds its table with `optionTable` from this package (`packages/terminal/src/parse.ts:38,60`), so it gets `negatable: false` with no change of its own and does not need a release for this. The release is `0.2.1`, so dependants on `^0.2.0` such as `@cofold/terminal` take it.

Step 6: `packages/server/package.json` takes `@cofold/commands` `^0.2.1`, and `pnpm-workspace.yaml` excludes `@cofold/commands@0.2.1` from the minimum release age. `pnpm install --frozen-lockfile` is clean and `node scripts/boundary.mjs` green.
