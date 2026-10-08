---
title: Our plugins take any @ahpd/sdk from 0.8 on
status: done
depends: [task-08-the-daemon-pins-the-sdk.md]
layer: "plugins"
refs:
  - "[code://packages/server/src/compat.ts](../../../../packages/server/src/compat.ts) - the loader's range check, which reads `>=`"
---

## Objective

The six plugins' `peerDependencies["@ahpd/sdk"]` is `">=0.8"` instead of `"^0.8"`, so a daemon on a later minor still loads them.

## Steps

1. Failing first: the loader loads a plugin with `">=0.8"` on a 0.9 daemon and refuses one with `">=0.9"` on 0.8.
2. Change the six `package.json` files, then `pnpm install --no-frozen-lockfile` once so the lockfile follows.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree: `peerDependencies["@ahpd/sdk"]` is `">=0.8"` in `agent-acp`, `agent-claude`, `agent-cofold`, `agent-pi`, `computer` and `tunnel-devtunnel`. `pnpm install --no-frozen-lockfile` answered "Already up to date" and left `pnpm-lock.yaml` unchanged; it records no workspace peer ranges.
Failing first: the six `declares @ahpd/<name> as taking any sdk from 0.8 on` cases in `packages/server/test/plugin-compat.test.ts` read `^0.8`. The loader cases beside them (`>=0.8` loads on 0.9; `>=0.9` is refused on 0.8 with `plugin oldest-sdk needs @ahpd/sdk >=0.9, this is 0.8.0`) passed before and after: `compat.ts` already reads `>=`. `docs/PLUGINS.md` still shows `"^0.8"` in its example manifest; that is task 04's.

