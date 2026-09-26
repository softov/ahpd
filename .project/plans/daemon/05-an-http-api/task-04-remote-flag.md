---
title: The CLI runs commands against a daemon with --remote
status: implemented
depends: [task-03-requests-sign-in.md]
layer: "server"
refs:
  - file:///github/cofold/examples/commands/clerver/cli.ts - the client pattern
---

## Objective

A global `--remote <url>` (with `--token` or `AHPD_TOKEN`) loads `<url>/api/cli-manifest`, turns it into commands with `commandsFrom`, and runs the typed command through `httpTransport` instead of locally.

## Files

- `UPDATE: packages/server/src/main.ts` - the global and the remote registry.

## Steps

1. Cache the manifest the way the example does, with a `--refresh`.
2. `start` and `stop` stay local only.

## Validation

- A test against a daemon started in the test: `--remote` `status` and `plugin list` answer.

## Resume

`--remote <url>`, `--token <secret>` (falling back to `AHPD_TOKEN`) and `--refresh` are program globals in `packages/server/src/main.ts`, read before the program exists because the program is built from the manifest.
`remoteRegistry` in `packages/server/src/commands/registry.ts` loads `<url>/api/cli-manifest` with `loadManifest` (cached under `tmpdir()/ahpd-remote`, `--refresh` bypassing it), registers `commandsFrom(manifest, { capability: 'transport' })` over a registry of only `run`, `start` and `stop`, and provides `httpTransport` against `<url>/api`.
`localRegistry` keeps `start` and `stop` local, which is the whole of what stays behind.
The admin declarations gained `http` bindings (`status`, `config`, `plugin list|install|remove`, `user list|add|rm|token`) so the manifest describes what the CLI already declares.
`test/server-http.test.ts` runs `--remote` `status` and `plugin list` against a daemon it starts, and again with the token in `AHPD_TOKEN`.
