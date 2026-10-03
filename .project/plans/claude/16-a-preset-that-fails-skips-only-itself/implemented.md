---
title: A Claude preset that cannot be resolved skips only itself - implemented
---

## What exists

- `packages/agent-claude/src/plugin.ts`: `optionsOf` is async and checks each preset alone - `presetSchema`, then each `env` `{ "$secret" }` read with `host.secret` (`secretsOf`). A preset that fails is dropped with one `host.problem` line naming `options.presets.<id>`; the others register. No variant left fails the load naming the skipped ids. A top-level `provider`, `displayName`, `models` or `keepCliModels` still fails the load.
- A preset's `env` values are declared `secretAtUse`, so the loader hands `$secret` through; a `user:` or `team:` name skips that preset.
- `extraArgs` values that are not a string or `null` reach the CLI as JSON text; a lone `{ fromEnv }` there is refused.
- README rows for `env`, `extraArgs` and the skip line.

## Verified

- Reviewer probes: a missing `$secret`, no vault, a `user:`/`team:` name, a missing `fromEnv`, a wrong `env` type and a bad `models` entry each skip only their preset and `claude` still registers; a known vault value never appears in a problem or log line; every preset failing fails the load; `extraArgs` object, number, boolean and array become JSON text.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (2592; `agent-acp-ports` flaked once and passes alone, as on main).

## Departures

- Skip lines go through `host.problem` (host/41 task 03) rather than `host.log` alone, so they reach the starting terminal.
- A `$secret` under a preset's `extraArgs` is still read by the loader; only `env` is read at use, as the plan decided.
