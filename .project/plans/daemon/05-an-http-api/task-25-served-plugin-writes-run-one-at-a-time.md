---
title: Served plugin installs and removes run one at a time
status: todo
depends: [task-21-npm-runs-without-holding-the-daemon.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L43-L100](../../../../packages/server/src/commands/plugin.ts#L43-L100) - `plugin install` and `plugin remove`, which read and rewrite the configuration file"
---

## Objective

Two served `plugin install` or `plugin remove` requests at once never lose one another's edit to the configuration file: the second starts after the first has written.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts:43-100` - one queue for the two writes.
- `UPDATE: packages/server/test/server-http.test.ts` - the case below.

## Steps

1. Hold one promise chain in `declarePlugin` that both write commands append to, so each runs after the one before it settles, failure or not.

## Validation

- `server-http.test.ts`: with the fake npm sleeping, two served installs of two different plugins sent together both answer 200 and the configuration names both. With the queue removed, the file names one of them.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts` green.

## Resume
