---
title: The fake Dev Container CLI and the fake Docker refuse what the real ones refuse
status: todo
depends: [task-18-every-command-reaches-it-by-docker-exec.md]
layer: "tests"
refs:
  - "[code://packages/computer/test/fixtures/devcontainer.mjs#L45-L90](../../../../packages/computer/test/fixtures/devcontainer.mjs#L45-L90) - the fake `up`, which always adds a machine and accepts any `--mount`"
  - "[code://packages/computer/test/fixtures/docker.mjs#L255-L259](../../../../packages/computer/test/fixtures/docker.mjs#L255-L259) - the fake `exec`, which answers whatever the machine's state"
  - "[code://packages/computer/src/runtime.ts#L494-L500](../../../../packages/computer/src/runtime.ts#L494-L500) - `cliMount`, which writes `,readonly`"
---

## Objective

The fakes refuse what the real CLI and Docker refuse and find what they find, so the tests of this plan can fail.
The real CLI checks `--mount` against `type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]` and answers "Unmatched argument format" otherwise (checked against 0.89.0 on 2026-09-26); its `up` with `--id-label` reuses a container carrying those labels; and `docker exec` on a stopped container fails.

## Files

- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs:45-90` - `up` refuses a `--mount` outside the pattern with the CLI's sentence, and answers the existing machine when one carries the same id labels, starting it when it is stopped.
- `UPDATE: packages/computer/test/fixtures/docker.mjs:255-259` - `exec` on a machine that is not running exits 1 with `Error response from daemon: container <id> is not running`.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - a Claude need with `readOnly: true`, and a second `up` with the same labels.

## Steps

1. Copy the mount pattern from the installed CLI rather than writing one.
2. Copy the exact `docker exec` refusal from a real Docker on a stopped container.

## Validation

- A Claude or cofold need (`readOnly: true`) through `devcontainer://` now fails in the test, as it does against the real CLI; task 09 makes it pass.
- A second `up` with the same labels answers the first container, and the fake Docker holds one machine.
- A `docker exec` on a stopped machine in the fake fails with the real sentence; task 13 relies on it.
- `node_modules/.bin/vitest run packages/computer/test` passes, with the read-only case written as `it.fails` until task 09 turns it into `it`.

## Resume
