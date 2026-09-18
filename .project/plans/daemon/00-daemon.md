---
title: Daemon - what exists today
domain: daemon
revalidated: 2026-09-18
---

The daemon is `packages/server` (`@ahpd/server`, binary `ahpd`): the process a person starts, its command line, its configuration directory, and the record it keeps of itself.
It builds a host from `@ahpd/sdk` with `@ahpd/agent-claude` as its one backend and serves it on a WebSocket; everything protocol-shaped lives in the SDK, not here.

## Packages

- `code://packages/server` - the daemon; entry point `src/main.ts`; configuration in `src/config.ts`; the background process and its record in `src/daemon.ts`; the version in `src/version.ts`.

## Contracts

- `code://packages/server/src/config.ts#L8-L35` - `Config`, what `~/.config/ahpd/config.json` may say; every key is what a flag would have said.
- `code://packages/server/src/daemon.ts#L8-L18` - `Running`, what a detached daemon records about itself in `daemon.json`.

## Runtime path

```
ahpd [start|stop|status|config] [flags]
  -> main.ts parses the verb, then the flags, then config.json under them
  -> start: spawns `ahpd` detached and waits for its first line; status: reads daemon.json
  -> otherwise: createHost({ agents: [claude()], resources, terminals, git }) and listen()
  -> the startup lines on stdout: `ahpd on ws://...`, `automations ...`, where the token came from, `wire to ...`
```

## Tests

- `code://test/host.test.ts` - the host as the daemon builds it, through a scenario client.
- `code://test/wire.test.ts` - `--wire` and the lines it writes.
- `code://test/sessions.test.ts` - the session store beside the configuration.
- No test starts `main.ts` as a process; the verbs are covered by hand.

## Known gaps

- Nothing tells a person the version is old; plan 01.
- The backend list is a literal in `main.ts`; idea [agents as extensions](../../ideas/agents-as-extensions.md).
