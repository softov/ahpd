---
title: The door is a door, and trusting the token is the opt-out - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/listen.ts
  - code://packages/sdk/src/types/listen.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/types/users.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://docs/USERS.md
  - code://docs/DAEMON.md
---

A person's connection token now opens a socket and names nobody, so `authenticate` is what authorizes, which is what the two layers described in `docs/USERS.md` always claimed. The deployment's token is unchanged: a socket on it is the host. `trustToken` is the way back, off by default, in the configuration for everybody and on a record for one person.

## What was built

- `code://packages/sdk/src/listen.ts` - `identityOf` admits a token that says nobody, distinguishes the deployment's token, and takes `root` from `ListenOptions`; a principal-less arrival is admitted and a missing arrival is refused. All three runtimes carry `principal` and `root`.
- `code://packages/sdk/src/types/listen.ts` - `Arrival { principal? }`, `identify` answering it or `undefined`, and `ListenOptions.root`.
- `code://packages/sdk/src/users.ts` - `trustToken` as the host default, `Principal.trusted` as the record's field or that default, and `list` reporting `trusted` beside `grants`.
- `code://packages/sdk/src/types/users.ts` - the three fields above, with the reason `trusted` is stamped once per connection.
- `code://packages/server/src/config.ts` - the `trustToken` key.
- `code://packages/server/src/main.ts` - `--trust-token`, merged with the file, and an `identify` that answers `{ principal }` only for a trusted record so an untrusted token arrives as nobody.
- `code://docs/USERS.md` - the door and the authorization as two layers, the `trustToken` example, and the three shapes.
- `code://docs/DAEMON.md` - the `users` paragraph and the `trustToken` key; the stale passage claiming a personal token "arrives as them" is corrected.

## Verified

- `test/listen-identity.test.ts` - a personal token is admitted as nobody, `{}` from `identify` is admitted, `undefined` is refused, and the deployment's token is root only when the caller opts in.
- `test/users-gate.test.ts` - a personal token gets `-32007` on the first gated command and is served after `authenticate`; a trusted one is served without it; root is served without being asked.
- `test/users.test.ts`, `test/users-host.test.ts`, `test/users-issuer.test.ts` - `trusted` is the record's field or the host default, and `list` reports it.
- `test/daemon.test.ts` - `--trust-token` and the `trustToken` key, and `user list` printing `trusted` or `sign-in`.
- By hand, a daemon with a directory: on the default port a personal token got `listSessions REFUSED -32007` before `authenticate`, then `listSessions ALLOWED` and `resourceRead REFUSED -32009` after; the deployment's token was served both commands; with `--trust-token` the personal token was served `listSessions` and still refused `resourceRead`.

## Departures from the plan

- None. `trustToken` is resolved on the principal rather than at each gate, because the door asks once per connection and the person's answer does not change while the socket is open.

## Left for later

- `ahpapp` and `ahpc` still need to handle `-32007` by presenting a sign-in; that is their own work and is tracked in `working/HANDOFF.md`.
