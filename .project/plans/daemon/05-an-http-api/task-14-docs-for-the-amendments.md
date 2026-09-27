---
title: Docs for the API's grants, guards and --remote
status: done
depends: [task-09-the-grants-each-command-needs.md, task-10-an-unconfigured-daemon-refuses-http.md, task-11-origin-and-host-are-checked.md, task-12-http-host.md, task-13-remote-needs-a-token-and-proves-it-is-remote.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L357-L483](../../../../docs/DAEMON.md#L357-L483) - the HTTP API section"
  - "[code://docs/USERS.md#L363-L372](../../../../docs/USERS.md#L363-L372) - the subjects table"
---

## Objective

`docs/DAEMON.md` and `docs/USERS.md` say what the API now does, and every example in them works.

## Files

- `UPDATE: docs/DAEMON.md:357-483` - the API needs a token or users to start; `http.host`; the grant per command; `config` without the token's value; commands act on the daemon's own options and take no path; Origin and Host are checked and bodies are JSON; the `curl` examples use refusals that exist; `--remote` needs a token from `--token`, `--token-file` or `AHPD_TOKEN`, warns when plain `http://` to a host that is not loopback carries it in cleartext, and caches under `~/.cache/ahpd/remote`.
- `UPDATE: docs/USERS.md:363-372` - `users` in the subjects table, and `config` with `read` beside `write`.

## Steps

1. The section is already wrapped; keep the file's wrapping, and use no em dashes.
2. The `curl` 403 example uses a refusal that still exists (`ada may not config:read here` on `status`).

## Validation

- Each `curl` and `--remote` example run against a daemon started as the section says.

## Resume

Done.
`docs/DAEMON.md` says the API needs a credential to start, `http.host`, the grant each command needs, that `config` hides the token's value, that a served command reads the daemon's own options, that Origin and Host are checked and bodies are JSON-only, and what `--remote` needs and warns about.
The two `curl` refusals were changed to ones that exist (`ada may not config:read here` for a member on `status`, and the deployment-token sentence for a person installing a plugin), and the `config` command's grant is still `config:write`.
`docs/USERS.md` lists `users` and gives `config` its `read` verb back.
By hand, against one daemon on a temporary `XDG_CONFIG_HOME`: both `curl` 200s, both 403 bodies exactly as documented, `--remote status`, `--remote plugin list`, `--remote --refresh config` and `--remote --token-file` all answered, and the cache directory was mode 700.
