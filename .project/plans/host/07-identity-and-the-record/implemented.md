---
title: A person reaches the host as themselves, and the host advertises only what is true - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/index.ts
  - code://packages/sdk/src/types/listen.ts
  - code://packages/sdk/src/listen.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/host.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://test/listen-identity.test.ts
  - code://test/users.test.ts
  - code://test/users-gate.test.ts
  - code://test/daemon.test.ts
  - code://docs/USERS.md
  - code://docs/DAEMON.md
  - code://.project/research/client-auth-and-the-reference-client.md
---

A person's own token now opens a socket and is who they are, resolved against the user directory before the first frame, so a client that can only carry a URL arrives as somebody without an `authenticate`.
The host advertises a record it can defend: the documentation page moved to `resource_documentation`, `authorization_servers` is absent because there is no issuer, and `resource` is an https identifier named by the operator or derived from where the daemon listens.
A daemon with no `users` configured advertises nothing and refuses exactly what it refused before.

## What was built

- `code://packages/sdk/src/users.ts` - `DEFAULT_RESOURCE` without `authorization_servers` and with `resource_documentation`, and `signInRecord`, which puts the same record under a deployment's identifier.
- `code://packages/sdk/src/types/listen.ts` - `ListenOptions.identify`, and an `OnConnect` that carries the `Principal` the token resolved to.
- `code://packages/sdk/src/listen.ts` - `identityOf` in place of the boolean check: the deployment's token admits and names nobody, anything else is put to `identify`, and all three runtimes resolve before the socket. Bun carries the answer on `ws.data`, Deno closes over it, and Node carries it from `verifyClient` to `connection`.
- `code://packages/sdk/src/types/host.ts`, `code://packages/sdk/src/host.ts` - `Host.accept(peer, principal?)`, which writes the principal onto the `Connection` before any handler can run.
- `code://packages/server/src/config.ts` - the `resource` key, `signInIdentifier` and `isIdentifier`, and `personalUrl`, which composes the URL a person pastes.
- `code://packages/server/src/main.ts` - the directory built once and handed to both doors, `identify` wired to `users.verify`, `--resource` and `--users` documented, a `sign-in <url>` startup line, and `ahpd user token <id> --url`.
- `code://docs/USERS.md` - three ways in, the record and what each field means, the honest revocation sentence, and what each client can do.
- `code://docs/DAEMON.md` - the `users` and `resource` keys.
- `code://.project/research/client-auth-and-the-reference-client.md` - what the reference client does with `authorization_servers`, the RFC 8414 dynamic-provider path it has for MCP servers only, and why a host-level login has no home in the protocol.

## Verified

- `pnpm test`: 71 files, 917 tests, up from 70 and 900. `test/listen-identity.test.ts` is new and holds the door matrix; `test/users.test.ts`, `test/users-gate.test.ts` and `test/daemon.test.ts` gained the record, the arrived-principal case and the URL composition.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green, and the suite green with no `packages/*/dist` touched by the tests.
- By hand: a real daemon with a real user file and a connection token, two people connected at their own `?tkn=` URLs, `initialize` and `listSessions` served for both with no `authenticate`, `sam` (member) refused `-32009 sam may not automation here` and `ana` (admin) reaching the handler, which is the principal deciding and the error naming the person.
- By hand: the startup line printed `sign-in https://127.0.0.1:9199/`, which is the derived identifier and no `authorization_servers`.

## Departures from the plan

- Task 01 - `test/users-host.test.ts` and `test/users-gate.test.ts` were expected to move to the new identifier and did not have to: both supply their own record, so the identifier they sign in against was never the default.
- Task 03 - the plan named a test for the `user token --url` line in `test/daemon.test.ts`, which is a CLI path. The composition moved to `personalUrl` in `config.ts` and is tested there, and the line itself was verified by hand.

## Left for later

- The issuer option behind the `Users` port, which gives `authorization_servers` a real value - `host/08`, and the reason the field is empty rather than wrong today.
- The shared connection token becoming a login of its own, removal landing on the next command, an issuer's token at the door, a host-level protected resource in AHP, and the reference client's dynamic provider path extended to agent resources - see [deferred.md](deferred.md).
