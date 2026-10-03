---
title: A fake ssh runs the remote command on this host, so the tests need no box
status: todo
depends: [task-01-several-runtimes-on-one-host.md]
layer: "computer"
refs:
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - the fake Docker, the pattern"
  - "[code://packages/computer/test/fixtures/container-host.mjs](../../../../packages/computer/test/fixtures/container-host.mjs) - a scripted host inside a machine"
---

## Objective

`packages/computer/test/fixtures/ssh.mjs` takes ssh's flags, records them, refuses a destination it is told is unreachable, and runs the remote string with `sh -c`, so a nested session over "ssh" runs a real inner host in a test.

## Files

- `CREATE: packages/computer/test/fixtures/ssh.mjs`.
- `CREATE: packages/computer/test/computer-ssh.test.ts` - the file tasks 02 and 03 add their cases to; this task's case is the fixture answering a scripted command.
- `UPDATE: packages/computer/test/computer-ssh.test.ts` (after task 03) - one nested session end to end through the fixture.

## Steps

1. Parse `-T`, `-o`, `-p`, `-i` and `--`, write the argv to a file the test names, and `exec sh -c <remote string>`.
2. A destination listed in an env variable exits 255 with ssh's own sentence.
3. Build the fixture first, before tasks 02 and 03, since their tests run through it; the end-to-end case is added once task 03 lands: it starts `container-host.mjs` as the remote `ahpd`, and a turn crosses it.

## Validation

- `pnpm --filter @ahpd/computer test` passes with no network and no `ssh` installed.

## Resume
