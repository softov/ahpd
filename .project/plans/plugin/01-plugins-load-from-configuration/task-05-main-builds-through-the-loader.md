---
title: The daemon builds its host through the loader
status: done
depends:
  - task-03-load-and-apply.md
  - task-04-config-and-flags.md
layer: packages/server
refs:
  - code://packages/server/src/main.ts#L342-L433 - the `createHost` literal, which becomes a `base` value plus a fold
  - code://packages/server/src/main.ts#L320-L341 - the flow between `parse` and `createHost`, where `loadPlugins` is awaited
  - code://packages/server/src/main.ts#L457-L477 - the startup lines, one of which becomes the plugins line
  - code://packages/server/src/daemon.ts#L88-L100 - the stdout parser that reads `sessions in` and the automations line, which must not be disturbed
  - code://packages/server/src/plugins.ts - `loadPlugins`, which this task calls
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, the type of the `base` value
  - code://.project/decisions/plugin-contributes-host-options.md - a plugin contributes this object and nothing else
---

## Objective

`main.ts` builds its `HostOptions` as a `base` value named once, calls `loadPlugins` with the specs it parsed, prints one line per problem and one line naming what loaded, and hands `createHost` the folded result, so a daemon with no plugins behaves exactly as it does today and a daemon with plugins serves what they contributed.

## Files

- `UPDATE: packages/server/src/main.ts:342-L433` - the literal becomes `const base: HostOptions = { … }` with the same keys and the same comments.
- `UPDATE: packages/server/src/main.ts:320-341` - the `loadPlugins` call, the problem lines and the refusal over a duplicate `provider`.
- `UPDATE: packages/server/src/main.ts:457-L477` - a `plugins …` line beside the automations line.
- `UPDATE: packages/server/src/main.ts:1-L30` - the `loadPlugins` import and the `HostOptions` type import from `@ahpd/sdk`.
- `CREATE: test/plugin-host.test.ts` - the folded options drive a real host.

## Steps

1. Rename the object handed to `createHost` to `base: HostOptions`, keeping every key, every comment and the order, so the diff reads as a rename plus an indirection.
2. Import `HostOptions` from `@ahpd/sdk` and `loadPlugins` from `./plugins.js`.
3. After `const { token, from } = secret(options)` and before `createHost`, call `await loadPlugins(options.plugins, { base, configDir: configDir(), cwd: process.cwd(), log: (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`) })`.
4. Print every problem as its own line through the same timestamped writer `onEvent` uses, so a skipped plugin is in the log where a log reader looks.
5. Refuse to start when a problem names a duplicate `provider`: write the problems, then exit non-zero, because a collision is the one failure the idea says is not skipped and a host built over it routes a turn to the wrong backend.
6. Pass the returned `options` to `createHost` and leave everything after it untouched.
7. Add the requested plugin names to `loaded` for the startup line, and print `plugins <names>` or `plugins none` as its own line after the automations line, so the regular expressions in `daemon.ts` still match the lines they already read.
8. Import `configDir` from `./config.js` beside the other path helpers.

## Validation

- `test/plugin-host.test.ts`: build a `base` with a fake agent and one plugin contribution, call `foldHostOptions`, hand the result to `createHost`, accept a fake peer, initialize and list sessions, and assert the contributed backend appears in the root channel's `agents` with its `provider` and `displayName`.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green.
- By hand: `node packages/server/dist/main.js --port 0` with no plugins prints `plugins none` and serves Claude as before.
- By hand: the same with `--plugin <fixture>` prints the fixture's name and the root channel lists two backends.
- By hand: a fixture with a duplicate `provider` refuses to start and names both plugins.

## Resume

Done 2026-09-20.
`main.ts` names the old `createHost` literal `base: HostOptions` with every key and comment kept, extracts one `stamp` writer that both `onEvent` and the loader's `log` use, awaits `loadPlugins` between `secret` and `createHost`, stamps every problem, exits 1 when one is a provider clash, and prints `plugins <names>` or `plugins none` as its own line after the automations line.
`test/plugin-host.test.ts` folds one contribution into a base, hands the result to `createHost`, initializes a fake peer, sees the contributed backend beside `echo` with its `displayName`, lists the empty catalogue, and pins the clash marker.
Verified: `pnpm test` 699 passed, `pnpm typecheck` green, `pnpm boundary` green, `pnpm build` builds three packages.
By hand: `node packages/server/dist/main.js --port 0` prints `plugins none`; the same with `--plugin ./test/fixtures/plugin-hello` prints `plugin hello from …` and `plugins hello`; with `plugin-hello` and `plugin-alike` it prints the clash and exits 1.
Departure from the plan: the refusal needs to tell a `provider` clash from the problems that are only reported, so `foldHostOptions` now prefixes a clash with the exported `AGENT_CLASH` constant rather than the daemon matching English; task 01's own test still passes because it asserts on the names inside the message.
The refusal exits 1 after writing the problems, which is a non-zero status without the stderr-and-exit-2 shape `stop` uses for a bad flag.
