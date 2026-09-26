---
title: Docs
status: implemented
depends: [task-04-remote-flag.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the CLI reference"
---

## Objective

`docs/DAEMON.md` documents `http`, `http.port`, the Bearer token, the grants, and `--remote`.

## Files

- `UPDATE: docs/DAEMON.md`

## Steps

1. A `curl` example and a `--remote` example.

## Validation

- The examples work.

## Resume

`docs/DAEMON.md` has a new `An HTTP API, for the commands the terminal runs` section: `http` and `http.port`, the startup line, the `Authorization: Bearer` token, the same grants and the same refusal sentence, a `curl` example including the 403 body, and `--remote` with a `--token` / `AHPD_TOKEN` example.
The `Configuration` prose names `http` beside the other keys.
