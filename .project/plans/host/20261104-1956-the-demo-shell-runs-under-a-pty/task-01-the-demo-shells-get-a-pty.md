---
title: The demo's shells get the daemon's pseudoterminal
status: done
depends: []
layer: "examples"
refs:
  - "[code://packages/server/src/pty.ts#L192](../../../../packages/server/src/pty.ts#L192) - the binding to ask for"
---

## Objective

`examples/demo` passes the daemon's pseudoterminal binding to `shellTerminals`, so its shells print a prompt and echo what they are sent.

## Files

- `UPDATE: examples/demo/main.ts` - ask `pty()` and pass what it answers to `shellTerminals`.
- `UPDATE: examples/demo/README.md` - say that its shells run under a pseudoterminal where one loads.

## Steps

1. Import `pty` from `packages/server/src/pty.ts` by its relative path.
2. Call it once before `createHost`, and pass its answer to `shellTerminals`.
3. Add one line to the README on the pseudoterminal.

## Validation

- Run `pnpm demo -- --port 9210 --path <scratch>`, open a terminal with ahpc, and send `ls`.
- Check that `ahpc terminal watch` shows a prompt and `ls` before its output.
- The repository's typecheck and tests pass.

## Resume
