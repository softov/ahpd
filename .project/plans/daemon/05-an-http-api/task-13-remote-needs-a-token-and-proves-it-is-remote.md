---
title: "`--remote` needs a token, reads it from a file too, warns on cleartext, keeps its cache private, and its tests prove the daemon answered"
status: done
depends: [task-08-served-commands-act-on-the-daemons-own-options.md]
layer: "server"
refs:
  - "[decisions/remote-needs-a-token.md](../../../decisions/remote-needs-a-token.md) - the refusal"
  - "[decisions/remote-reads-its-token-from-a-file-too.md](../../../decisions/remote-reads-its-token-from-a-file-too.md) - `--token-file`"
  - "[decisions/remote-warns-when-its-token-travels-in-cleartext.md](../../../decisions/remote-warns-when-its-token-travels-in-cleartext.md) - the cleartext warning"
  - "[code://packages/server/src/main.ts#L37-L110](../../../../packages/server/src/main.ts#L37-L110) - `ON_MACHINE`, `tokenFor` and `warnCleartext`, read before the program exists"
  - "[code://packages/server/src/commands/options.ts#L106](../../../../packages/server/src/commands/options.ts#L106) - the `--token-file` global"
  - "[code://packages/server/src/commands/registry.ts#L59-L75](../../../../packages/server/src/commands/registry.ts#L59-L75) - `remoteCache`, per user and owner-only"
  - "[code://packages/server/test/server-http.test.ts#L141-L169](../../../../packages/server/test/server-http.test.ts#L141-L169) - the client with its own directories"
  - "[code://packages/server/test/server-http.test.ts#L718-L816](../../../../packages/server/test/server-http.test.ts#L718-L816) - the seven cases"
---

## Objective

`ahpd --remote <url>` with none of `--token`, `--token-file` and `AHPD_TOKEN` exits 2 before any request.
`--token-file <path>` supplies the token from a file.
`--remote` to `http://` on a host that is not loopback warns on stderr that the token travels in cleartext, and still sends it.
The manifest cache is in a per-user directory with mode 0700, not a shared one under `/tmp`.
The `--remote` tests pass only when the daemon answered.

## Files

- `UPDATE: packages/server/src/main.ts:37-110` - `--token-file` read beside `--token`, refused together, a missing or empty file refused, `AHPD_TOKEN` only when neither flag is given (decision `remote-reads-its-token-from-a-file-too`); a `--remote` with no token refused with a sentence naming all three (decision `remote-needs-a-token`); the cleartext warning.
- `UPDATE: packages/server/src/commands/options.ts:106` - the `--token-file` global beside `--token`, so help and completion show it.
- `UPDATE: packages/server/src/commands/registry.ts:59-75` - `remoteCache` moves to `$XDG_CACHE_HOME/ahpd/remote` (default `~/.cache/ahpd/remote`), created with mode 0700 before `loadManifest` writes to it.
- `UPDATE: packages/server/test/server-http.test.ts:141-169, 718-816` - the client gets its own `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`, and the seven cases.

## Steps

1. The token's sources and the refusal in `main.ts`, before `remoteRegistry`.
2. The warning: an `http:` URL whose host is not `127.0.0.1`, `[::1]` or `localhost` (the line `loopbackUrl` in `packages/sdk/src/issuers.ts` draws) writes one line on stderr that the token travels in cleartext, then proceeds (decision `remote-warns-when-its-token-travels-in-cleartext`).
3. The cache directory, with its mode.
4. The test client gets its own `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`, with no configuration and no `daemon.json`, and `recordFor` goes (task 08 made it unnecessary).

## Validation

- `packages/server/test/server-http.test.ts`: `--remote <url> status` with no token and no `AHPD_TOKEN` exits 2 and the daemon's log shows no request; today it fetches the manifest.
- `--token-file <file holding the token>` answers like `--token`; `--token` with `--token-file` exits 2; a missing or empty file exits 2; today `--token-file` is an unknown option.
- `--remote http://127.0.0.1:<port>` writes no warning; a daemon started with `--host 0.0.0.0` and a token, reached as `http://<the machine's non-loopback address>:<port>` (skipped when the machine has none), writes the cleartext warning on stderr and still answers; today neither warns.
- `--remote <url> --token t status` prints the daemon's own pid, which only the daemon knows, and `plugin list` prints `plugin-echo` from the daemon's configuration while the client's has none.
- After a `--remote` run, the client's `XDG_CACHE_HOME/ahpd/remote` exists with mode 0700, and nothing was written under `tmpdir()/ahpd-remote`.

## Resume

Done.
`tokenFor` reads `--token`, `--token-file` or `AHPD_TOKEN` in that order, refuses the two flags together and a file that is missing or empty, and refuses a remote call with no credential at all before anything is fetched; `warnCleartext` writes one line for plain http off loopback.
`--token-file` is a program global, so help and completion carry it.
`remoteCache` is `$XDG_CACHE_HOME/ahpd/remote`, created 0700 before `loadManifest` writes; nothing writes under `tmpdir()` any more.
The test client runs with its own `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`, so a case passes only when the daemon answered; the pid assertions read the served document shape the remote surface renders.
The cleartext case starts the daemon on `0.0.0.0` with `resource` naming the machine's non-loopback address: a wildcard bind answers there, and `resource` is what makes the address one of the daemon's own names for the Origin and Host check of task 11.
`pnpm typecheck` green; `packages/server/test/server-http.test.ts` green, 39 cases.
