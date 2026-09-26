---
title: "`--remote` needs a token, reads it from a file too, warns on cleartext, keeps its cache private, and its tests prove the daemon answered"
status: todo
depends: [task-08-served-commands-act-on-the-daemons-own-options.md]
layer: "server"
refs:
  - "[decisions/remote-needs-a-token.md](../../../decisions/remote-needs-a-token.md) - the refusal"
  - "[decisions/remote-reads-its-token-from-a-file-too.md](../../../decisions/remote-reads-its-token-from-a-file-too.md) - `--token-file`"
  - "[decisions/remote-warns-when-its-token-travels-in-cleartext.md](../../../decisions/remote-warns-when-its-token-travels-in-cleartext.md) - the cleartext warning"
  - "[code://packages/server/src/main.ts#L33-L53](../../../../packages/server/src/main.ts#L33-L53) - where `--remote` and the token are read"
  - "[code://packages/server/src/commands/registry.ts#L144-L181](../../../../packages/server/src/commands/registry.ts#L144-L181) - `remoteCache` and `remoteRegistry`"
  - "[code://test/server-http.test.ts#L115-L140](../../../../test/server-http.test.ts#L115-L140) - `cli` and `recordFor`, which share the daemon's configuration directory"
---

## Objective

`ahpd --remote <url>` with none of `--token`, `--token-file` and `AHPD_TOKEN` exits 2 before any request.
`--token-file <path>` supplies the token from a file.
`--remote` to `http://` on a host that is not loopback warns on stderr that the token travels in cleartext, and still sends it.
The manifest cache is in a per-user directory with mode 0700, not a shared one under `/tmp`.
The `--remote` tests pass only when the daemon answered.

## Files

- `UPDATE: packages/server/src/main.ts:33-53` - `--token-file` read beside `--token`, refused together, a missing or empty file refused, `AHPD_TOKEN` only when neither flag is given (decision `remote-reads-its-token-from-a-file-too`); a `--remote` with no token refused with a sentence naming all three (decision `remote-needs-a-token`); the cleartext warning.
- `UPDATE: packages/server/src/main.ts:100-104` - the `--token-file` global beside `--token`, so help and completion show it.
- `UPDATE: packages/server/src/commands/registry.ts:144-145` - `remoteCache` is `tmpdir()/ahpd-remote`, created with default permissions and a predictable name, so another local user can plant a manifest; it moves to `$XDG_CACHE_HOME/ahpd/remote` (default `~/.cache/ahpd/remote`), created with mode 0700 before `loadManifest` writes to it.
- `UPDATE: test/server-http.test.ts:115-140, 216-259` - the client runs with the same `XDG_CONFIG_HOME` as the daemon and `recordFor` writes a fake `daemon.json`, so `status` and `plugin list` would pass if they ran locally.

## Steps

1. The token's sources and the refusal in `main.ts`, before `remoteRegistry`.
2. The warning: an `http:` URL whose host is not `127.0.0.1`, `[::1]` or `localhost` (the line `loopbackUrl` in `packages/sdk/src/issuers.ts` draws) writes one line on stderr that the token travels in cleartext, then proceeds (decision `remote-warns-when-its-token-travels-in-cleartext`).
3. The cache directory, with its mode.
4. The test client gets its own `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`, with no configuration and no `daemon.json`, and `recordFor` goes (task 08 made it unnecessary).

## Validation

- `test/server-http.test.ts`: `--remote <url> status` with no token and no `AHPD_TOKEN` exits 2 and the daemon's log shows no request; today it fetches the manifest.
- `--token-file <file holding the token>` answers like `--token`; `--token` with `--token-file` exits 2; a missing or empty file exits 2; today `--token-file` is an unknown option.
- `--remote http://127.0.0.1:<port>` writes no warning; a daemon started with `--host 0.0.0.0` and a token, reached as `http://<the machine's non-loopback address>:<port>` (skipped when the machine has none), writes the cleartext warning on stderr and still answers; today neither warns.
- `--remote <url> --token t status` prints the daemon's own pid, which only the daemon knows, and `plugin list` prints `plugin-echo` from the daemon's configuration while the client's has none.
- After a `--remote` run, the client's `XDG_CACHE_HOME/ahpd/remote` exists with mode 0700, and nothing was written under `tmpdir()/ahpd-remote`.

## Resume
