---
title: The fake Dev Container CLI behaves like the real one
status: todo
depends: []
layer: "tests"
refs:
  - "[code://test/fixtures/devcontainer.mjs](../../../../test/fixtures/devcontainer.mjs) - the fake, whose `up` always adds a machine and accepts any `--mount`"
  - "[code://packages/computer/src/runtime.ts#L419-L425](../../../../packages/computer/src/runtime.ts#L419-L425) - `cliMount`, which writes `,readonly`"
---

## Objective

The fake refuses what the real CLI refuses and finds what the real CLI finds, so the tests of this plan can fail.
The real CLI checks `--mount` against `type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]` and answers "Unmatched argument format" otherwise (checked against 0.89.0 on 2026-09-26); its `up` with `--id-label` reuses a container carrying those labels; its `exec` fails on a stopped container.

## Files

- `UPDATE: test/fixtures/devcontainer.mjs` - the three behaviours above.
- `UPDATE: test/computer-devcontainer.test.ts` - a Claude need with `readOnly: true`.

## Steps

1. Copy the mount pattern from the installed CLI rather than writing one.

## Validation

- A Claude or cofold need (`readOnly: true`) through `devcontainer://` now fails in the test, as it does against the real CLI; task 09 makes it pass.
- A second `up` with the same labels answers the first container.

## Resume
