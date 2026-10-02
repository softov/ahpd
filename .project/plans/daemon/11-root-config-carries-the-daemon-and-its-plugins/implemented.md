---
title: Root config carries the daemon's settings and each plugin's options - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts)"
  - "[code://packages/server/src/commands/config.ts](../../../../packages/server/src/commands/config.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
---

A client holding `config:read` sees the daemon's own settings and each plugin's options in root config, and one holding `config:write` edits them: `advancedTools` and `wire` apply at once, everything else is written to `config.json` and root state says a restart is needed. A credential is never sent back.

## What was built

- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `RootConfigPort` (`schema`, `values`, `write`) and `HostOptions.rootConfig`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the daemon's keys shown only to `config:read`; a write goes to the port first and a refusal is the sender's `rejectionReason`; the echo carries what the port answers after the write, so a `writeOnly` value is `<set>` for everybody; the daemon's keys are never kept in the host's own copy; `_meta["ahpd.restartNeeded"]`; `advancedTools` applied live.
- [`code://packages/server/src/rootconfig.ts`](../../../../packages/server/src/rootconfig.ts) - the seven daemon keys and one `plugins.<name>` key per entry, checked before `config.json` is touched, inside `oneAtATime`.
- [`code://packages/server/src/commands/config.ts`](../../../../packages/server/src/commands/config.ts) - one mask that walks a value against the plugin's schema and answers `<set>` for `writeOnly` at any depth; `keyed`, the `#<provider>` key for a repeated plugin.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the live capture, through daemon/06's `writerFor`.
- `@ahpd/agent-claude`, `@ahpd/agent-acp`, `@ahpd/computer`, `@ahpd/agent-cofold` - credentials marked `writeOnly`: preset and server `env` values, and cofold's keys.
- `docs/DAEMON.md`, `docs/PLUGINS.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 160 files and 2351 tests after the rebase onto main, `pnpm boundary` clean.
- `packages/sdk/test/root-config.test.ts`: admin and member see what each should; a member's write is refused; a member sees no daemon key after an admin's write; every echo carries `<set>` for a `writeOnly` key.
- `packages/server/test/server-root-config.test.ts`: the seven keys; writes, refusals and restarts; a nested cofold key and a Claude preset `env` value answer `<set>` and survive being sent back; two `agent-claude` entries are two keys that each edit their own entry.
- A probe written outside the agent's tests reproduced the member and echo leaks before the fix and found neither after.
- The two `agent-claude` entries of the live `~/.config/ahpd/config.json` pass the new options schema.
- Not done: the manual check in ahpapp as admin and as member.

## Departures from the plan

- [A plugin loaded more than once is keyed by its provider](../../../decisions/a-repeated-plugin-is-keyed-by-its-provider.md), decided during the build.
- The live capture was merged onto daemon/06's writer when rebasing.

## Left for later

- See [deferred.md](deferred.md).
