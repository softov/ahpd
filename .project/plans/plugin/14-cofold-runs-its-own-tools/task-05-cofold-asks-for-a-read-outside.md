---
title: cofold's harness asks for a read outside the workspace
status: done
depends: []
layer: "cofold agents (/github/cofold)"
refs:
  - "file:///github/cofold/packages/agents/src/policy/modes.ts - `askOnEffects` (line 12) and `policyOf` (line 25), where the modes are defined"
  - "file:///github/cofold/packages/agents/src/types/policy.ts - `PermissionModeRules` (lines 35-40), whose `inside` doc says it is about edits"
  - "file:///github/cofold/packages/agents/src/policy/modes.test.ts - the mode tests this extends"
---

## Objective

In `/github/cofold`, a tool that reads and names a path outside the workspace asks in `default`, `acceptEdits` and `plan`, and is refused in `dontAsk`, per [decision: a read outside the workspace asks](../../../decisions/a-cofold-read-outside-the-workspace-asks-in-default-mode.md).

## Files

- `UPDATE: /github/cofold/packages/agents/src/policy/modes.ts:12-15` - `askOnEffects` allows every read today; it takes `rules` and asks for a read whose path is outside.
- `UPDATE: /github/cofold/packages/agents/src/policy/modes.ts:25-49` - `policyOf` passes `rules` to `askOnEffects` in every case that calls it.
- `UPDATE: /github/cofold/packages/agents/src/types/policy.ts:36` - the `inside` doc says it judges a path a read or an edit names.
- `UPDATE: /github/cofold/packages/agents/src/policy/modes.test.ts` - the new cases.

## Steps

1. Make `askOnEffects` a function of `rules`: a tool with `effects.reads === true` whose input carries a string `path`, or a string `cwd` when there is no `path`, asks when `rules.inside(thatPath)` is false.
2. A read with no path and no `cwd` keeps `allow`, since it works in the workspace.
3. Leave `auto` (`DEFAULT_DECIDE`) and `bypassPermissions` as they are.
4. Update the `inside` doc comment to say what it is now; the comment documents the predicate and does not narrate the change.
5. Follow cofold's own release process for `@cofold/agents`; publishing is Softov's call, and task 08 takes the release into ahpd.

## Validation

- `modes.test.ts`: a `reads` tool with `{ path: '/elsewhere/x' }` and `inside` returning false asks in `default`, `acceptEdits` and `plan`, and is denied in `dontAsk`; the same tool with an inside path allows; `{ cwd: '/elsewhere' }` asks in `default`; the outside-read case fails today, because `askOnEffects` allows every read.
- `auto` and `bypassPermissions` still allow the outside read.
- cofold's `pnpm test` and typecheck green; papo's own tests still pass, since papo shares `policyOf`.

## Resume

Done. Released 2026-09-26 from `/github/cofold` by its `release.yml` as `@cofold/agents@0.1.1`; task 08 takes it into ahpd.

- `src/policy/modes.ts:16` - `askOnEffects(rules)` returns the decide function: writes, destructive and network ask as before, and a `reads` tool asks when `readTarget(input)` (line 27: `path`, else `cwd`) is a string that `rules.inside` rejects. A read naming neither allows.
- `src/policy/modes.ts:42` - `policyOf` builds it once per call (`onEffects`) and uses it in `default`, `acceptEdits`, `plan` and `dontAsk`. `auto` and `bypassPermissions` are unchanged.
- `src/types/policy.ts:36` - the `inside` doc now says it judges a path a read or an edit names.
- `src/policy/modes.test.ts:72,82` - two new cases: an outside `path` asks in `default`, `acceptEdits`, `plan`, is denied in `dontAsk`, and still allows in `auto` and `bypassPermissions`; an inside path allows; `{ cwd: '/elsewhere' }` asks, `{ cwd: '/work' }` allows, `path` wins over `cwd`, and an input with neither (or `undefined`) allows. Both failed before the fix with `expected 'allow' to be 'ask'`.

Verified from `/github/cofold`:
- `node_modules/.bin/vitest run packages/agents` - 216 passed, typecheck no errors.
- `pnpm run typecheck` in `packages/agents` (`tsc -p tsconfig.test.json --noEmit`) - clean.
- papo resolves `@cofold/agents` through `dist`, so `packages/agents/dist` was rebuilt with `node_modules/.bin/tsc -p packages/agents/tsconfig.json` first; then `node_modules/.bin/vitest run packages/papo` - 8 files, 137 passed. No papo test covers an outside read, so none changed outcome.

Not known to the plan: papo's tests run against the built `dist`, not the source, so the agents build has to precede them.

Released as `@cofold/agents@0.1.1`.
