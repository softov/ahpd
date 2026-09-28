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
  - decisions/the-config-command-hides-its-secrets.md
  - decisions/served-answers-hide-plugin-option-values-and-url-credentials.md
  - decisions/http-host-binds-the-apis-own-listener.md
  - decisions/remote-needs-a-token.md
  - decisions/the-user-commands-need-users-write.md
  - decisions/remote-warns-when-its-token-travels-in-cleartext.md
  - decisions/remote-reads-its-token-from-a-file-too.md
  - decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md
  - decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md
  - decisions/a-caller-gives-only-the-grants-it-holds.md
refs:
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - the listener; plain requests to `/api` are answered beside the WebSocket upgrade"
  - "[code://packages/sdk/src/host.ts#L141](../../../../packages/sdk/src/host.ts#L141) - `NEEDS`, the grant pairs a command is checked against"
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts) - `verify`, the path `authenticate` takes for a token"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the configuration `http` joins"
  - file:///github/cofold/examples/commands/clerver/server.ts - the server `serve()` is promoted from
  - "file:///github/cofold/examples/commands/clerver/cli.ts - the client: manifest, `commandsFrom`, `httpTransport`, Bearer"
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
| [The config command hides the connection token over HTTP](../../../decisions/the-config-command-hides-the-connection-token.md) (superseded) | 09 |
| [The config command hides the connection token and every plugin option value over HTTP](../../../decisions/the-config-command-hides-its-secrets.md) (superseded) | 20 |
| [Served answers hide the connection token, every plugin option value, and the credentials in a plugin spec's URL](../../../decisions/served-answers-hide-plugin-option-values-and-url-credentials.md) | 20, 24, 31 |
| [The user commands need users:write](../../../decisions/the-user-commands-need-users-write.md) | 09, 17 |
| [http.host binds the API's own listener](../../../decisions/http-host-binds-the-apis-own-listener.md) | 12 |
| [`--remote` needs a token](../../../decisions/remote-needs-a-token.md) | 13 |
| [`--remote` to plain http on a host that is not loopback sends the token, with a warning](../../../decisions/remote-warns-when-its-token-travels-in-cleartext.md) | 13 |
| [`--remote` reads its token from a file too, with --token-file](../../../decisions/remote-reads-its-token-from-a-file-too.md) | 13 |
| [cofold's serve() takes a Request and answers a Response, and Node gets an adapter](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md) | 15, 16 |
| [The HTTP API checks Origin and Host, and takes only JSON bodies](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) | 06, 11, 18 |
| [A user command gives, mints for and removes only what its caller holds](../../../decisions/a-caller-gives-only-the-grants-it-holds.md) | 17 |

| What | Source | Task |
| --- | --- | --- |
| Administration only; sessions stay on AHP | the API is what the CLI does | - |
| `Authorization: Bearer <token>`, read as the connection token, a user's token or an issuer token, through the path `authenticate` takes | Softov, 2026-09-26: "Bearer, same path as WS" | 03 |
| A refusal carries the same reason the WebSocket gives | "the same permission control already existing" | 03 |
| The CLI acts locally unless given `--remote <url>`; the token from `--token` or `AHPD_TOKEN` | Softov, 2026-09-26: "Only with --remote <url>" | 04 |
| No request ends the daemon: a malformed `Host`, a malformed percent-escape or a refused command is answered with a status | the daemon serves every other connection | 06, 07, 08 |
| A 500 carries a sentence, never an error's own message | a message can quote a file the daemon read | 06 |
| The `--remote` manifest cache is per user, mode 0700 | Softov, 2026-09-26: "move to a per-user directory, 0700: treat as a fix" | 13 |
| A served command never blocks the daemon's event loop, and npm's stderr streams as it runs | the daemon serves every other connection while a request runs | 21 |
| The remote surface drops `configFile`, `users`, `plugins` and `paths`, and a served command acts on the daemon's own options. | Softov, 2026-09-26: "drop them from the remote surface; the API acts on the daemon's own options". | 08 |
| `personalUrl` brackets an IPv6 host. | Softov, 2026-09-27, asked whether the unbracketed IPv6 host in `personalUrl` becomes a task: "Make it a task". | 28 |
| A users-file role named `__proto__` is read as a role. | Softov, 2026-09-27, asked whether the `__proto__` role becomes a task: "Make it a task". | 29 |
| `ahpd start` passes `process.execArgv` to the child. | Softov, 2026-09-27, asked whether `start` under the dev runner becomes a task: "Make it a task". | 30 |
| Tasks 28 to 31 go in this plan. | Softov, 2026-09-27, asked where the four new tasks go: "daemon/05". | 28-31 |
| The comment on `urlHost` says what it is, not why it moved. | Softov, 2026-09-27, asked which review findings become fix tasks: "urlHost comment narrates". | 32 |
| A `--remote` token is trimmed from `--token` and `AHPD_TOKEN` as it is from a file. | Softov, 2026-09-27, asked which earlier findings become tasks: "tokenFor trims every source". | 33 |
| `docs/DAEMON.md`'s long `--remote` line is wrapped, and the flag row names the update check as declared. | Softov, 2026-09-27, asked which earlier findings become tasks: "DAEMON.md long line and wording". | 34 |
| The exported `RequestHandler` type keeps its name with the fetch shape. | Softov, 2026-09-27, asked whether the type keeps its name in 0.4.0: "Keep RequestHandler". | 15 |
| cofold's CI `runtimes` job runs the clerver server on Node, Bun and Deno. | Softov, 2026-09-27, asked whether to add the round trip the Validation names: "Add clerver to runtimes". | 15 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - @cofold/remote serves a registry (cofold repository)](task-01-serve-in-cofold-remote.md) | done | - |
| [02 - The daemon mounts the API when http is on](task-02-the-daemon-mounts-it.md) | done | 01 |
| [03 - A request signs in and is checked against the grants](task-03-requests-sign-in.md) | done | 02 |
| [04 - The CLI runs commands against a daemon with --remote](task-04-remote-flag.md) | done | 03 |
| [05 - Docs](task-05-docs.md) | done | 04 |
| [06 - `serve()` survives a malformed request and takes only JSON bodies (cofold repository)](task-06-serve-survives-a-malformed-request.md) | done | - |
| [07 - The daemon's listener survives a malformed request, with the API on or off](task-07-the-listener-survives-a-malformed-request.md) | done | - |
| [08 - Served commands act on the daemon's own options, and no request ends the daemon](task-08-served-commands-act-on-the-daemons-own-options.md) | done | 07 |
| [09 - Each served command needs its own grant, and config hides the token](task-09-the-grants-each-command-needs.md) | done | 08, and daemon/04's registry-hook task |
| [10 - A daemon with no token and no users refuses to start with http on](task-10-an-unconfigured-daemon-refuses-http.md) | done | - |
| [11 - The API checks Origin and Host, and takes only JSON bodies](task-11-origin-and-host-are-checked.md) | done | 07, 12 |
| [12 - http.host binds the API's own listener](task-12-http-host.md) | done | - |
| [13 - `--remote` needs a token, reads it from a file too, warns on cleartext, keeps its cache private, and its tests prove the daemon answered](task-13-remote-needs-a-token-and-proves-it-is-remote.md) | done | 08 |
| [14 - Docs for the API's grants, guards and --remote](task-14-docs-for-the-amendments.md) | done | 09, 10, 11, 12, 13 |
| [15 - `serve()` takes a Request and answers a Response, with a Node adapter (cofold repository)](task-15-serve-takes-a-request.md) | done | 06 |
| [16 - The HTTP API is served on Node, Bun and Deno](task-16-the-api-on-bun-and-deno.md) | todo | 07, 15 |
| [17 - A user command gives, mints for and removes only what its caller holds](task-17-a-caller-gives-only-what-it-holds.md) | done | 09 |
| [18 - The API's guards have no gaps](task-18-the-guards-have-no-gaps.md) | done | 11, 12, 13 |
| [19 - The API's tests prove what their tasks' Validation says](task-19-the-tests-prove-their-validation.md) | done | 08, 10, 12, 13 |
| [20 - A served config answers from the daemon's own file, hides its secrets, or says it is gone](task-20-served-config-reads-the-daemons-file-or-says-it-is-gone.md) | done | 08 |
| [21 - npm runs without holding the daemon, and a served install says to restart](task-21-npm-runs-without-holding-the-daemon.md) | done | 08 |
| [22 - The docs, comments and task refs for the API say what the code does](task-22-the-docs-comments-and-refs-say-what-the-code-does.md) | done | 17, 18, 19, 20, 21 |
| [23 - user add on a person who exists is bounded by the roles they hold](task-23-user-add-on-an-existing-person-is-bounded.md) | done | 17 |
| [24 - A served plugin list hides every plugin option value](task-24-plugin-list-hides-option-values.md) | done | 20 |
| [25 - Served plugin installs and removes run one at a time](task-25-served-plugin-writes-run-one-at-a-time.md) | done | 21 |
| [26 - The addresses the daemon prints and accepts read back as URLs](task-26-addresses-read-back-as-urls.md) | done | 18 |
| [27 - A blank token or host is refused, and the comments and refs say what is true](task-27-blank-values-are-refused-and-the-records-are-true.md) | done | 22 |
| [28 - A personal URL brackets an IPv6 host](task-28-a-personal-url-brackets-an-ipv6-host.md) | done | 26 |
| [29 - A role named __proto__ in the users file is read as a role](task-29-a-role-named-proto-is-a-role.md) | done | 23 |
| [30 - ahpd start runs the daemon under the same node flags it was run with](task-30-start-runs-the-child-under-the-same-node-flags.md) | done | - |
| [31 - Served answers hide the credentials in a plugin's URL](task-31-served-answers-hide-credentials-in-a-plugin-url.md) | done | 24 |
| [32 - The comment on urlHost says what it is](task-32-urlhost-says-what-it-is.md) | done | 28 |
| [33 - A --remote token is trimmed whichever of the three it came from](task-33-a-remote-token-is-trimmed-from-every-source.md) | done | 27 |
| [34 - DAEMON.md is wrapped where it is prose, and its flag table names the update check as declared](task-34-daemon-md-is-wrapped-and-names-the-update-flag.md) | done | - |

## Risks and tradeoffs

- An HTTP surface on a public port is new attack surface; it is off by default, needs a credential to start, and `http.port` with `http.host` keeps it on loopback.
- A cofold release comes before task 02 can use `serve()`.

## Resume state

- **Done so far:** every task but 16 is `done`, reviewed by Softov on 2026-09-28.
  With `http` on, the daemon serves its own declarations under `/api` on its own listener or on `http.port`, a request signs in with `Authorization: Bearer` and is checked in the registry's `authorize` hook, and `ahpd --remote <url>` runs the same commands against it.
  Task 15 is `@cofold/remote` 0.4.0, released on 2026-09-28 (cofold tag `release-2026-09-28`); ahpd still depends on `^0.3.1` until task 16 moves it.
- **Next action:** task 16, the API on Node, Bun and Deno over 0.4.0, is being built in the worktree `/github/ahpd-d05t16` on branch `d05-16`, then Softov's review; the plan closes after it.
- **Open questions:** none.
- **Watch out for:**
  - Task 15 made `serve()` take a `Request` and answer a `Response`, with a Node adapter; task 16 serves the API on Node, Bun and Deno with it.
  - A command added to the API later must take no path from the request, must not reach `stop`, and must declare a grant pair.
  - The dispatch gate and `PER_CONNECTION` have no staleness test, so a command reachable over HTTP must be classified the way a WebSocket method is.
  - A cofold release is staged by cofold's `release.yml` from a `release-*` tag and approved by Softov on npm; nobody runs `npm publish`.
  - `plugin install` and `plugin remove` are served to the deployment token only, and `http` needs a token or a users directory to start at all.

## Final verification checklist

- [x] With `http` off, `/api` answers 404 and nothing else changes.
- [x] With `http` on, `GET /api/status` answers for the deployment token and is refused without one.
- [x] A user without `config:write` is refused `plugin install` with the reason the WebSocket gives.
- [x] `http.port` moves the API to its own listener.
- [x] `ahpd --remote <url> status` works against a daemon on another port.
- [x] A `Host: a b` request, or a path with `%E0%A4%A`, is answered 400 and the daemon keeps running, with `http` on and off.
- [x] No request reaches `process.exit`, and no request names a file the daemon reads or writes.
- [x] `status` over HTTP answers for a daemon run in the foreground.
- [x] A 500 carries no error's own message.
- [x] `status` and `plugin list` need `config:read`, the `user` verbs `users:write`, and `plugin install` and `plugin remove` the deployment token.
- [x] `GET /api/config` carries no `connectionToken` value.
- [x] `http` with no token and no users refuses to start.
- [x] A foreign `Origin` or `Host` is refused with 403, and a non-JSON body with 415.
- [x] `http.host` binds the API's own listener.
- [x] `--remote` with no token exits 2, `--token-file` supplies one, plain `http://` to a host that is not loopback warns on stderr, its cache is 0700 in the user's cache directory, and its tests fail when the daemon does not answer.
- [x] Grants are checked in the registry's `authorize` hook, and `authorizeOverHttp` checks none.
- [x] `@cofold/remote@0.3.1`, released by Softov, is the version `packages/server/package.json` names.
- [x] A caller with `users:write` cannot give, mint for or remove a role or person holding a grant it lacks (task 17).
- [x] A request with no `Host` is refused, an IPv6 bind answers to `[addr]:port`, an empty `http.host` is refused, no actor is 401, and `HTTP://` warns (task 18).
- [x] The bind, sentence, cache and plugin-list cases fail when their behaviour breaks, and the cache is 0700 even when it existed (task 19).
- [x] A served config never shows another file's contents, and masks every plugin option value (task 20).
- [x] A served plugin install does not hold the daemon, and npm's stderr streams (task 21).
- [x] `docs/DAEMON.md` and `docs/USERS.md` match the served fields and the `users` grants, and the refs in tasks 07 to 21 are current (task 22).
- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/DAEMON.md`, `plans/index.md` updated.
