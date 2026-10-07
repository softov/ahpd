---
title: The root config schema is one a client can read - implemented
date: 2026-10-07
refs:
  - git://920d23d
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts)"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts)"
---

A connection with `config:read` now receives a root config schema whose every property is one the protocol declares. Each carries a title and one of five types, and nothing else. A bound, a pattern or a `writeOnly` no longer reaches a client, and a bound is said in the description instead. The daemon still checks a write against its own schema, so a value it would refuse at the next start is refused now.

## What was built

- [`code://packages/server/src/rootconfig.ts`](../../../../packages/server/src/rootconfig.ts) - `conforming()`, a pure mapping, with `titleOf`, `boundOf` and `typeOf` above it. It runs on every daemon key and every plugin key in `schema()`. `pluginKey` answers a conforming `options` for a plugin that did not load. `answered()` and `values()` answer a stored `http: true` as `{}`, and leave a stored `false` out.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - a `title` on each of the eight daemon keys, and `title: 'Folder'` on the items of `paths`.
- [`code://packages/server/test/server-root-config.test.ts`](../../../../packages/server/test/server-root-config.test.ts) - five cases for the schema a client reads and four for the `http` key.
- [`code://packages/server/test/fixtures/plugin-bounded/index.ts`](../../../../packages/server/test/fixtures/plugin-bounded/index.ts) - a plugin whose options carry `minItems` and `maxItems` on an array and on a string.
- [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts) - `KNOWN` holds nothing.

## Verified

- `packages/server/test/server-root-config.test.ts`: 44 tests, all pass.
- `packages/sdk/test/wire.test.ts`: 17 tests, all pass with no `RootState /config/schema` line in `KNOWN`.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary`: all pass.
- `npx vitest run`: 4215 tests in 240 files. The run does not come back green on this box. The load average stood between 24 and 32 on eight cores, with fourteen containers of another session running.
- The failures are the box rather than the code. Each run failed a different set of load-sensitive tests, every one a timeout. Every one passes when its file or its package runs alone. With the per-test timeout raised to 60s the suite is 4214 of 4215. The one failure is `packages/computer/test/computer-disposable.test.ts > takes the machine's own git volume with it`, an assertion under fake timers that also passes alone. Nothing in `packages/computer` imports the root config, so this plan cannot have moved it.

## Departures from the plan

- Task 01 named `port: 70000` as the write that stays refused. `serverFields.port` declares no bound, so that write is not refused; the case is `http: { port: 70000 }`, which is bounded. The refusal itself is unchanged.
- Task 01's Files kept the `http` type line in `KNOWN` for task 02. The first-member rule already reads `['object', 'boolean']` as `object`, so the line left `KNOWN` with the rest. Task 02 still sets the type explicitly, so the order of the list cannot change it. Softov confirmed the reading on 2026-10-07, and the plan's table records it.

## Left for later

- Task 03, a client telling which keys are secrets, is dropped: `writeOnly` is not sent, and a secret's value already goes out masked as `<set>`.
