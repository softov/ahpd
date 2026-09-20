---
title: Daemon - what exists today
domain: daemon
revalidated: 2026-09-20
---

The daemon is `packages/server` (`@ahpd/server`, binary `ahpd`): the process a person starts, its command line, its configuration directory, and the record it keeps of itself.
It builds a host from `@ahpd/sdk` with `@ahpd/agent-claude` as its one backend and serves it on a WebSocket; everything protocol-shaped lives in the SDK, not here.

## Packages

- `code://packages/server` - the daemon; entry point `src/main.ts`; configuration in `src/config.ts`; the background process and its record in `src/daemon.ts`; the version in `src/version.ts`; the update check in `src/update.ts`; the plugin loader in `src/plugins.ts` and the plugin range check in `src/compat.ts`.

## Contracts

- `code://packages/server/src/config.ts#L9-L52` - `Config`, what `~/.config/ahpd/config.json` may say; every key is what a flag would have said, `plugins` included.
- `code://packages/server/src/config.ts#L162-L176` - `asSpec`, the one normaliser between a configuration entry and a `PluginSpec`.
- `code://packages/server/src/daemon.ts#L8-L18` - `Running`, what a detached daemon records about itself in `daemon.json`.
- `code://packages/server/src/plugins.ts` - `resolvePlugin`, `loadPlugins`, `describePlugin`: the half of the plugin mechanism that touches the filesystem and the module loader.
- `code://packages/sdk/src/types/plugin.ts` - `Plugin`, `PluginHost` and `PluginSpec`, the contract a plugin is written against.
- `code://.project/decisions/plugin-contributes-host-options.md` - what a plugin is allowed to contribute.

## Runtime path

```
ahpd [start|stop|status|config|plugin list] [flags]
  -> main.ts parses the verb, then the flags, then config.json under them
  -> start: spawns `ahpd` detached and waits for its first line; status: reads daemon.json
  -> otherwise: a base HostOptions (Claude, the ports) then loadPlugins(specs) then createHost(folded) and listen()
  -> the startup lines on stdout: `ahpd on ws://...`, `automations ...`, `plugins <names>`, where the token came from, `wire to ...`, `update: ...`
  -> plugin list: resolvePlugin and readManifest per spec, importing nothing
```

## Tests

- `code://test/host.test.ts` - the host as the daemon builds it, through a scenario client.
- `code://test/wire.test.ts` - `--wire` and the lines it writes.
- `code://test/sessions.test.ts` - the session store beside the configuration.
- `code://test/update.test.ts` - the update check, against a local registry.
- `code://test/plugin-fold.test.ts`, `code://test/plugin-validate.test.ts`, `code://test/plugin-resolve.test.ts`, `code://test/plugin-load.test.ts`, `code://test/plugin-compat.test.ts`, `code://test/plugin-spec.test.ts`, `code://test/plugin-host.test.ts`, `code://test/plugin-end-to-end.test.ts` and `code://test/plugin-list.test.ts` - the plugin mechanism, from the contract to a served backend and a listing.
- No test starts `main.ts` as a process; the verbs are covered by hand.

## Known gaps

- The record the detached daemon keeps about itself holds the port and where the token came from, and not the token, so a connection URL has to be assembled by hand; plan [02 - Connect URL in the record](02-connect-url-in-record/plan.md).
