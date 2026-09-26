---
title: The CLI runs commands against a daemon with --remote
status: todo
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
