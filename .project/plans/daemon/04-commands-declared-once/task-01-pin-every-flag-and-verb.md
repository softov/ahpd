---
title: Every flag and verb has a test that pins what it does
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L255-L310](../../../../packages/server/src/main.ts#L255-L310) - the flags"
  - "[code://packages/server/src/main.ts#L430-L660](../../../../packages/server/src/main.ts#L430-L660) - the verbs"
---

## Objective

A test per flag and per verb records what it does today (the options it yields, the output, the exit code), so task 03 can prove nothing moved.

## Files

- `CREATE: test/server-cli.test.ts` - the pinning cases, driving the parser and each verb against a temporary config directory.

## Steps

1. List every `case` in the parser and every verb and sub-verb; one test each, plus unknown-flag and `--help` exit codes.
2. Where a verb's output is prose, pin the lines a script would read.

## Validation

- `pnpm test test/server-cli.test.ts` green against today's `main.ts`.

## Resume
