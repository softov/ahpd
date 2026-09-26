---
title: An HTTP API for the daemon, from the same commands, under the same grants
domain: daemon
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/daemon/04-commands-declared-once/plan.md
changes: []
creates: []
decisions:
  - decisions/ahpd-commands-are-declared-with-cofold-commands.md
  - decisions/the-http-api-is-on-the-daemon-port-under-api.md
  - decisions/an-http-api-is-served-by-cofold-remote.md
  - decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md
  - decisions/status-and-plugin-list-need-config-read.md
  - decisions/installing-a-plugin-over-http-is-root-only.md
  - decisions/the-config-command-hides-the-connection-token.md
  - decisions/the-http-api-acts-on-the-daemons-own-options.md
  - decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md
  - decisions/http-host-binds-the-apis-own-listener.md
  - decisions/remote-needs-a-token.md
  - decisions/the-user-commands-need-users-write.md
  - decisions/cofold-remote-0-3-1-is-cut-by-softov-from-a-tagged-commit.md
  - decisions/remote-warns-when-its-token-travels-in-cleartext.md
  - decisions/remote-reads-its-token-from-a-file-too.md
refs:
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - the listener; plain requests to `/api` are answered beside the WebSocket upgrade"
  - "[code://packages/sdk/src/host.ts#L141](../../../../packages/sdk/src/host.ts#L141) - `NEEDS`, the grant pairs a command is checked against"
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts) - `verify`, the path `authenticate` takes for a token"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the configuration `http` joins"
  - file:///github/cofold/examples/commands/clerver/server.ts - the server `serve()` is promoted from
  - file:///github/cofold/examples/commands/clerver/cli.ts - the client: manifest, `commandsFrom`, `httpTransport`, Bearer
---

## Goal

A person who turns on `http` can do over HTTP what the CLI does (status, plugins, users, config), signed in the way a WebSocket connection is and allowed by the same grants, with a manifest and OpenAPI describing it.
`ahpd --remote <url>` runs the same commands against a daemon over that API.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `ls /github/cofold/packages/remote/src` - `manifest`, `openapi`, `http` (a client transport), `auth`, `cache`: nothing that serves a request.
- `examples/commands/clerver/server.ts` - routes from `meta.http`, `canonicalFromObject`, `registry.execute(command, { surface: 'remote', input })`, `/cli-manifest`, errors mapped to 404/400/500.

### Runtime path

```
GET /api/status, Authorization: Bearer T -> [new] listen.ts: /api -> serve(registry)
  -> [new] authorize: T as connection token (root), user token, or issuer token -> principal
  -> scopes vs the principal's grants -> run -> JSON
ahpd --remote URL plugin list -> [new] manifest from URL/api/cli-manifest -> commandsFrom -> httpTransport
```

### Gaps

- `@cofold/remote` has no server.
- The listener serves only the WebSocket upgrade.
- No request path turns a Bearer token into a principal.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An HTTP API is served by @cofold/remote, and ahpd mounts it](../../../decisions/an-http-api-is-served-by-cofold-remote.md) | 01, 02 |
| [The HTTP API is off by default, and on the daemon's own port under /api unless http.port is set](../../../decisions/the-http-api-is-on-the-daemon-port-under-api.md) | 02 |
| [ahpd's commands are declared once, with @cofold/commands](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) | 03 |
| [A daemon with neither a connection token nor a user directory refuses to start with the HTTP API on](../../../decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md) | 10 |
| [`status` and `plugin list` need config:read](../../../decisions/status-and-plugin-list-need-config-read.md) | 09 |
| [Installing or removing a plugin over HTTP needs the deployment token](../../../decisions/installing-a-plugin-over-http-is-root-only.md) | 09 |
| [The config command hides the connection token over HTTP](../../../decisions/the-config-command-hides-the-connection-token.md) | 09 |
| [The user commands need users:write](../../../decisions/the-user-commands-need-users-write.md) | 09 |
| [The HTTP API acts on the daemon's own options, and takes no path from a request](../../../decisions/the-http-api-acts-on-the-daemons-own-options.md) | 08 |
| [The HTTP API checks Origin and Host, and takes only JSON bodies](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) | 06, 11 |
| [http.host binds the API's own listener](../../../decisions/http-host-binds-the-apis-own-listener.md) | 12 |
| [`--remote` needs a token](../../../decisions/remote-needs-a-token.md) | 13 |
| [`--remote` to plain http on a host that is not loopback sends the token, with a warning](../../../decisions/remote-warns-when-its-token-travels-in-cleartext.md) | 13 |
| [`--remote` reads its token from a file too, with --token-file](../../../decisions/remote-reads-its-token-from-a-file-too.md) | 13 |
| [@cofold/remote 0.3.1 is cut by Softov, from a tagged commit, once serve() is fixed](../../../decisions/cofold-remote-0-3-1-is-cut-by-softov-from-a-tagged-commit.md) | 06 |

| What | Source | Task |
| --- | --- | --- |
| Administration only; sessions stay on AHP | the API is what the CLI does | - |
| `Authorization: Bearer <token>`, read as the connection token, a user's token or an issuer token, through the path `authenticate` takes | Softov, 2026-09-26: "Bearer, same path as WS" | 03 |
| A refusal carries the same reason the WebSocket gives | "the same permission control already existing" | 03 |
| The CLI acts locally unless given `--remote <url>`; the token from `--token` or `AHPD_TOKEN` | Softov, 2026-09-26: "Only with --remote <url>" | 04 |
| No request ends the daemon: a malformed `Host`, a malformed percent-escape or a refused command is answered with a status | the daemon serves every other connection | 06, 07, 08 |
| A 500 carries a sentence, never an error's own message | a message can quote a file the daemon read | 06 |
| The `--remote` manifest cache is per user, mode 0700 | Softov, 2026-09-26: "move to a per-user directory, 0700: treat as a fix" | 13 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - @cofold/remote serves a registry (cofold repository)](task-01-serve-in-cofold-remote.md) | implemented | - |
| [02 - The daemon mounts the API when http is on](task-02-the-daemon-mounts-it.md) | implemented | 01 |
| [03 - A request signs in and is checked against the grants](task-03-requests-sign-in.md) | implemented | 02 |
| [04 - The CLI runs commands against a daemon with --remote](task-04-remote-flag.md) | implemented | 03 |
| [05 - Docs](task-05-docs.md) | implemented | 04 |
| [06 - `serve()` survives a malformed request and takes only JSON bodies (cofold repository)](task-06-serve-survives-a-malformed-request.md) | done | - |
| [07 - The daemon's listener survives a malformed request, with the API on or off](task-07-the-listener-survives-a-malformed-request.md) | todo | - |
| [08 - Served commands act on the daemon's own options, and no request ends the daemon](task-08-served-commands-act-on-the-daemons-own-options.md) | todo | 07 |
| [09 - Each served command needs its own grant, and config hides the token](task-09-the-grants-each-command-needs.md) | todo | 08, and daemon/04's registry-hook task |
| [10 - A daemon with no token and no users refuses to start with http on](task-10-an-unconfigured-daemon-refuses-http.md) | todo | - |
| [11 - The API checks Origin and Host, and takes only JSON bodies](task-11-origin-and-host-are-checked.md) | todo | 07, 12 |
| [12 - http.host binds the API's own listener](task-12-http-host.md) | todo | - |
| [13 - `--remote` needs a token, reads it from a file too, warns on cleartext, keeps its cache private, and its tests prove the daemon answered](task-13-remote-needs-a-token-and-proves-it-is-remote.md) | todo | 08 |
| [14 - Docs for the API's grants, guards and --remote](task-14-docs-for-the-amendments.md) | todo | 09, 10, 11, 12, 13 |

## Risks and tradeoffs

- An HTTP surface on a public port is new attack surface; it is off by default, needs a credential to start, and `http.port` with `http.host` keeps it on loopback.
- A cofold release comes before task 02 can use `serve()`.

## Resume state

- **Done so far:** tasks 01 to 06; task 06 is `@cofold/remote` 0.3.1, released, and ahpd depends on `^0.3.1`. With `http` on, the daemon serves the CLI registry under `/api` on its own listener or on `http.port`, a request signs in with `Authorization: Bearer` and is checked against the same grants, `ahpd --remote <url>` runs the daemon's commands, and `docs/DAEMON.md` documents it.
- **Next action:** task 07; tasks 10 and 12 do not depend on it.
- **Open questions:** none.
- **Watch out for:**
  - The daemon/04 plan's scope row (`status` and `plugin list` need nothing, `user` needs `admin`) is replaced by the decisions task 09 applies.
  - Task 09 waits on [daemon/04 task 14](../04-commands-declared-once/task-14-the-registry-hook-checks-every-surface.md), which moves the scope check into the registry's `authorize` hook; task 09 applies the grants in that hook, and `authorizeOverHttp` only turns a request into a principal.
  - A command added to the API later must take no path from the request, must not reach `stop`, and must declare a grant pair.
  - The dispatch gate and `PER_CONNECTION` have no staleness test, so a command reachable over HTTP must be classified the way a WebSocket method is.
  - No agent publishes a cofold package.

## Final verification checklist

- [x] With `http` off, `/api` answers 404 and nothing else changes.
- [x] With `http` on, `GET /api/status` answers for the deployment token and is refused without one.
- [x] A user without `config:write` is refused `plugin install` with the reason the WebSocket gives.
- [x] `http.port` moves the API to its own listener.
- [x] `ahpd --remote <url> status` works against a daemon on another port.
- [ ] A `Host: a b` request, or a path with `%E0%A4%A`, is answered 400 and the daemon keeps running, with `http` on and off.
- [ ] No request reaches `process.exit`, and no request names a file the daemon reads or writes.
- [ ] `status` over HTTP answers for a daemon run in the foreground.
- [ ] A 500 carries no error's own message.
- [ ] `status` and `plugin list` need `config:read`, the `user` verbs `users:write`, and `plugin install` and `plugin remove` the deployment token.
- [ ] `GET /api/config` carries no `connectionToken` value.
- [ ] `http` with no token and no users refuses to start.
- [ ] A foreign `Origin` or `Host` is refused with 403, and a non-JSON body with 415.
- [ ] `http.host` binds the API's own listener.
- [ ] `--remote` with no token exits 2, `--token-file` supplies one, plain `http://` to a host that is not loopback warns on stderr, its cache is 0700 in the user's cache directory, and its tests fail when the daemon does not answer.
- [ ] Grants are checked in the registry's `authorize` hook, and `authorizeOverHttp` checks none.
- [ ] `@cofold/remote@0.3.1`, released by Softov, is the version `packages/server/package.json` names.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/DAEMON.md`, `plans/index.md` updated.
