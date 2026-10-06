---
title: The policy form reads its choices from the manifest - implemented
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/policies.ts](../../../../packages/sdk/src/policies.ts) - the tables a body is checked against, now exported"
  - "[code://packages/sdk/src/policy.ts](../../../../packages/sdk/src/policy.ts) - the manifest, built from them"
  - "[code://packages/sdk/test/policy-scheme.test.ts](../../../../packages/sdk/test/policy-scheme.test.ts) - the enums, the per-kind `allOf`, and the ajv cases"
  - "[code://docs/POLICY.md](../../../../docs/POLICY.md) - the paragraph naming the manifest"
---

A client drawing the policy form no longer has to know a single value: the `policy:` scheme's manifest carries every choice a body may take, built from the same tables `checkPolicy` refuses by, so a host that adds a measure offers a form its own check accepts.

## What was built

- [`code://packages/sdk/src/policies.ts`](../../../../packages/sdk/src/policies.ts) - `MEASURES`, `MATCHES`, `PERIODS`, `KINDS`, `EFFECTS` and `LIMIT_POOLS` are exported; nothing else in the file changed.
- [`code://packages/sdk/src/policy.ts`](../../../../packages/sdk/src/policy.ts) - `kind`, `effect` and a limit's `measure`, `period` and `pool` are built with `choice()`, each carrying an `enum`; the manifest's `allOf` holds one `if`/`then` per kind from `narrowed`, narrowing `limits.items.properties.measure.enum` to that kind's measures and giving `match` a `propertyNames.enum` of that kind's value types. `ALL_MEASURES` is the union in the order the kinds name it. The descriptions that repeated a value list dropped it.
- [`code://docs/POLICY.md`](../../../../docs/POLICY.md) - a paragraph under "The scheme" says the choices are the manifest's `enum`s and per-kind `allOf`, and that a client draws its pickers from there rather than from the page.

## Verified

- `packages/sdk/test/policy-scheme.test.ts`: three cases added. The enums are asserted equal to the exported tables (the measure one derived from `MEASURES`, not written out); each `allOf` entry's `if` names its kind and its `then` carries exactly `MEASURES[kind]` and `MATCHES[kind]`; ajv compiles the manifest and accepts a body of each kind, and refuses a `computer` row limited in `usd` and a `model` row whose match names `agent`.
- `pnpm typecheck` clean, `pnpm boundary` clean (every package "declared, none undeclared"), `pnpm build` clean.
- `pnpm test`: 222 files, 3215 tests pass. One earlier run of the same suite reported 34 timeouts at vitest's 5 s default (`wire.test.ts`, `nested-proxy.test.ts` and others) on a loaded machine; the immediate re-run passed every file, and `packages/sdk`'s own `pnpm test` passed before it. None of the timeouts named a policy test, and none failed a second time.

## Departures from the plan

- Task 01, step 3, applied to `period` and the limit `pool`: their description was the value list alone, with no sentence to keep, so each got the short sentence its type in `types/policies.ts` already carries. The other three kept their sentence.
- The test imports ajv's named `Ajv` rather than the default: under `module: nodenext` the default import is not constructable to the checker, though it works at runtime.
- No commit was made, so this file carries no `git://` ref; the work is the working tree of `build/agents/fb939ff8`.

## Left for later

- Nothing. The plan named two tasks and both are implemented.
