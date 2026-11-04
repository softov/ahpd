---
title: The demo host's shells run under a pseudoterminal - implemented
date: 2026-11-04
refs:
  - git://f2c4d859 - the main this was built on
  - "[code://examples/demo/main.ts](../../../../examples/demo/main.ts)"
---

A terminal on the demo host now shows the shell's prompt and the command it was sent, as a terminal on the daemon does.

## What was built

- [`code://examples/demo/main.ts`](../../../../examples/demo/main.ts) - asks the daemon's `pty()` once, and passes its answer to `shellTerminals`.
- [`code://examples/demo/README.md`](../../../../examples/demo/README.md) - a row on its terminals.

## Verified

- `pnpm typecheck` passed, and `demo.test.ts` and `notes.test.ts` passed 18 tests.
- On a scratch port, `ahpc terminal send` then `terminal watch` showed the prompt, `echo hello` and `hello`.
- With `SHELL=/bin/sh` and `PS1='$ '`, the prompt is `$ `, which is how ahpc's picture script keeps a user name out of its pictures.

## Departures from the plan

- None.
