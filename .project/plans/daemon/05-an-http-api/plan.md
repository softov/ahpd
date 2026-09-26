---
title: An HTTP API for the daemon, from the same commands, under the same grants
domain: daemon
status: planned
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

| What | Source | Task |
| --- | --- | --- |
| Administration only; sessions stay on AHP | the API is what the CLI does | - |
| `Authorization: Bearer <token>`, read as the connection token, a user's token or an issuer token, through the path `authenticate` takes | Softov, 2026-09-26: "Bearer, same path as WS" | 03 |
| A refusal carries the same reason the WebSocket gives | "the same permission control already existing" | 03 |
| The CLI acts locally unless given `--remote <url>`; the token from `--token` or `AHPD_TOKEN` | Softov, 2026-09-26: "Only with --remote <url>" | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - @cofold/remote serves a registry (cofold repository)](task-01-serve-in-cofold-remote.md) | todo | - |
| [02 - The daemon mounts the API when http is on](task-02-the-daemon-mounts-it.md) | todo | 01 |
| [03 - A request signs in and is checked against the grants](task-03-requests-sign-in.md) | todo | 02 |
| [04 - The CLI runs commands against a daemon with --remote](task-04-remote-flag.md) | todo | 03 |
| [05 - Docs](task-05-docs.md) | todo | 04 |

## Risks and tradeoffs

- An HTTP surface on a public port is new attack surface; off by default, and `http.port` can keep it on loopback.
- A cofold release comes before task 02 can use `serve()`.

## Resume state

- **Done so far:** the decisions, 2026-09-26.
- **Next action:** [task-01-serve-in-cofold-remote.md](task-01-serve-in-cofold-remote.md), in `/github/cofold`.
- **Open questions:** none.
- **Watch out for:** the dispatch gate and `PER_CONNECTION` have no staleness test; a command reachable over HTTP must be classified the way a WebSocket method is.

## Final verification checklist

- [ ] With `http` off, `/api` answers 404 and nothing else changes.
- [ ] With `http` on, `GET /api/status` answers for the deployment token and is refused without one.
- [ ] A user without `config:write` is refused `plugin install` with the reason the WebSocket gives.
- [ ] `http.port` moves the API to its own listener.
- [ ] `ahpd --remote <url> status` works against a daemon on another port.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/DAEMON.md`, `plans/index.md` updated.
