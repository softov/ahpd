---
title: The door admits, `authenticate` authorizes, and `trustToken` opts out
status: done
depends: []
layer: packages/sdk, packages/server
refs:
  - "[code://packages/sdk/src/listen.ts#L82-L124](../../../../packages/sdk/src/listen.ts#L82-L124) - `identityOf`"
  - "[code://packages/sdk/src/types/listen.ts#L74-L102](../../../../packages/sdk/src/types/listen.ts#L74-L102) - `Arrival` and `ListenOptions`"
  - "[code://packages/sdk/src/users.ts#L130-L155](../../../../packages/sdk/src/users.ts#L130-L155) - `trustToken`, and `trusted` on the principal"
  - "[code://packages/server/src/main.ts#L810-L830](../../../../packages/server/src/main.ts#L810-L830) - the daemon's `identify`"
  - "[code://test/listen-identity.test.ts](../../../../test/listen-identity.test.ts) - the door's cases"
---

## Objective

A personal connection token no longer arrives as a person: `identify` says whether the door opens and the person only when the directory trusts that token. `authenticate` authorizes, the deployment's token is still root, and `trustToken` - in the configuration or on a record - is the only way back.

## Files

- `UPDATE: packages/sdk/src/listen.ts` - `identityOf` returns an arrival with or without a principal, the deployment's token answers root when the caller opts in, and all three runtimes carry `principal` and `root`.
- `UPDATE: packages/sdk/src/types/listen.ts` - `Arrival { principal? }`, `identify` answering it or `undefined`, and `ListenOptions.root`.
- `UPDATE: packages/sdk/src/types/users.ts` - `Principal.trusted`, `UserRecord.trustToken`, and `Users.list` including `trusted`.
- `UPDATE: packages/sdk/src/users.ts` - `trustToken` as the host default, `trusted` resolved as the record's field or the default, and grant validation beside it.
- `UPDATE: packages/server/src/config.ts` - the `trustToken` key.
- `UPDATE: packages/server/src/main.ts` - `--trust-token`, the file merging under `--trust-token`, `user list` printing `trusted` or `sign-in`, and an `identify` that hands the record over only when it is trusted.
- `UPDATE: test/listen-identity.test.ts`, `test/users-gate.test.ts`, `test/users-host.test.ts`, `test/users-issuer.test.ts`, `test/users.test.ts`, `test/daemon.test.ts` - the arrival shape, the default refusal, the opt-out in both places, and root.
- `UPDATE: docs/USERS.md`, `docs/DAEMON.md` - the two layers, the `trustToken` example, the flag, and the shapes.

## Steps

1. Make `Arrival` an optional principal and let `identityOf` admit a token that says nobody, keeping `undefined` as the refusal.
2. Carry `root` through all three runtimes, taken only from the deployment's token and only when `ListenOptions.root` is set.
3. Add `trustToken` to the directory options, resolve `trusted` per record with the host default behind it, and include it in `list`.
4. Add the `trustToken` key, the `--trust-token` flag, and the merge, then have the daemon's `identify` return the record as a principal only when `trusted` is true.
5. Have `user list` print `trusted` or `sign-in` so the choice is visible where the records are.
6. Rewrite the two-layer section of `USERS.md` and the `users` paragraph of `DAEMON.md`, and correct the stale "arrives as them" passage.
7. Cover it: the door's cases, the gate's refusal and its root bypass, `trusted` per record and per host, the flag and the key, and `user list`.

## Validation

- `test/listen-identity.test.ts` - a personal token is admitted as nobody; `{}` admits and `undefined` refuses; the deployment's token is root only when `root` is set.
- `test/users-gate.test.ts` - a personal token is refused `-32007` before `authenticate` and served after; a trusted one is served without it.
- `test/users-host.test.ts`, `test/users-issuer.test.ts`, `test/users.test.ts` - the record's `trustToken` wins over the host default, `list` reports `trusted`, and root is never asked to authorize.
- `test/daemon.test.ts` - `--trust-token`, the `trustToken` key, and `user list`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- By hand: a daemon with a directory on port 9212, the same on 9213 with `--trust-token`, and both doors against `listSessions` and `resourceRead`.

## Resume

Done 2026-09-23.
`identityOf` answers an arrival with or without a principal; `trustToken` is the host default and a record's field, resolved into `Principal.trusted`. Root is unchanged and taken only from the deployment's token.
Verified by hand: on 9212, a personal token got `-32007` for `listSessions` before `authenticate` and `listSessions` served with `resourceRead` refused `-32009` after; the deployment's token was served both; on 9213 with `--trust-token`, the personal token was served `listSessions` and still refused `resourceRead`.
