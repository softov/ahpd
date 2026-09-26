---
title: Every flag and verb has a test that pins what it does
status: implemented
depends: []
layer: "server"
refs:
  - "git://7a7e9d1 - packages/server/src/main.ts before the migration: the flag parser and the verbs this task pinned"
  - "[code://test/server-cli.test.ts](../../../../test/server-cli.test.ts) - the pinning cases"
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

Done: `test/server-cli.test.ts` holds 28 cases driving `main.ts` as a process with a temporary `XDG_CONFIG_HOME`, one run carrying every daemon flag and pinning its announcement, and one group per verb.
Green against the hand-written parser (`28 passed`, 39s) and green again unchanged after task 03 (`28 passed`, 46s).
Found in review: every case runs with `CI=1`, so the update-check case cannot fail (task 06), and `--port`, `--host` and `start` are never exercised (task 10).
