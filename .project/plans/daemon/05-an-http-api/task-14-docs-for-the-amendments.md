---
title: Docs for the API's grants, guards and --remote
status: todo
depends: [task-09-the-grants-each-command-needs.md, task-10-an-unconfigured-daemon-refuses-http.md, task-11-origin-and-host-are-checked.md, task-12-http-host.md, task-13-remote-needs-a-token-and-proves-it-is-remote.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L357-L430](../../../../docs/DAEMON.md#L357-L430) - the HTTP API section"
  - "[code://docs/USERS.md#L360-L372](../../../../docs/USERS.md#L360-L372) - the subjects table"
---

## Objective

`docs/DAEMON.md` and `docs/USERS.md` say what the API now does, and every example in them works.

## Files

- `UPDATE: docs/DAEMON.md:357-430` - the API needs a token or users to start; `http.host`; the grant per command (`config:read` for `status` and `plugin list`, `config:write` for `config`, the deployment token for `plugin install` and `plugin remove`, `users:write` for the `user` verbs); `config` without the token's value; commands act on the daemon's own options and take no path; Origin and Host are checked and bodies are JSON; `--remote` needs a token from `--token`, `--token-file` or `AHPD_TOKEN`, warns when plain `http://` to a host that is not loopback carries it in cleartext, and caches under `~/.cache/ahpd/remote`.
- `UPDATE: docs/USERS.md:360-372` - `users` in the subjects table, and `config` with `read` beside `write`.

## Steps

1. The section is already wrapped; keep the file's wrapping, and use no em dashes.
2. The `curl` 403 example uses a refusal that still exists (`ada may not config:read here` on `status`).

## Validation

- Each `curl` and `--remote` example run against a daemon started as the section says.

## Resume
