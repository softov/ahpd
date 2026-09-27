---
title: Served plugin installs and removes run one at a time
status: implemented
depends: [task-21-npm-runs-without-holding-the-daemon.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L61-L118](../../../../packages/server/src/commands/plugin.ts#L61-L118) - `plugin install` and `plugin remove`, which read and rewrite the configuration file"
---

## Objective

Two served `plugin install` or `plugin remove` requests at once never lose one another's edit to the configuration file: the second starts after the first has written.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts:61-118` - one queue for the two writes.
- `UPDATE: packages/server/test/server-http.test.ts` - the case below.

## Steps

1. Hold one promise chain in `declarePlugin` that both write commands append to, so each runs after the one before it settles, failure or not.

## Validation

- `server-http.test.ts`: with the fake npm sleeping, two served installs of two different plugins sent together both answer 200 and the configuration names both. With the queue removed, the file names one of them.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts` green.

## Resume

Implemented 2026-09-27, with a departure in the Validation. The case was written first as the Validation says: two served installs of `left-pad` and `is-odd` sent together, with the fake npm sleeping. Without the queue both answered 200 and the configuration named both, so the check "with the queue removed, the file names one of them" cannot fail: `enableNames` and `disableNames` read and write the file synchronously after npm settles, so two edits in one process never interleave. What did overlap was npm: two runs in the same `--prefix` at once. The fake npm now appends `start` and `end` to `FAKE_NPM_LOG` when it is set, and the case also asserts the log is `start, end, start, end`; without the queue it read `start, start, end, end` and failed.

`declarePlugin` holds one promise chain, `oneAtATime`, which `plugin install` and `plugin remove` both run through, so each starts once the one before it settled, failure or not. `server-http.test.ts` is green (51).
