---
title: The advertised record is true
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/users.ts#L29-L52](../../../../packages/sdk/src/users.ts#L29-L52) - `DEFAULT_RESOURCE`, which names a documentation page as an authorization server and a non-https resource identifier"
  - "[code://packages/sdk/src/users.ts#L53-L70](../../../../packages/sdk/src/users.ts#L53-L70) - `FileUserOptions.resource`, the deployment's own record when it has one"
  - "[code://packages/server/src/config.ts#L9-L61](../../../../packages/server/src/config.ts#L9-L61) - the config keys, which gain the identifier the host advertises"
  - "[code://packages/server/src/main.ts#L548-L560](../../../../packages/server/src/main.ts#L548-L560) - where `fileUsers` is built and where the identifier is known"
  - https://www.rfc-editor.org/rfc/rfc9728.txt - `resource` is an https URL, `authorization_servers` is optional, and `resource_documentation` is the field for a page
---

## Objective

The record the host advertises on every agent says only what is true: a documentation page lives in `resource_documentation`, `authorization_servers` is absent because there is no issuer, and `resource` is an https identifier the deployment named or one derived from the addresses it listens on.

## Files

- `UPDATE: packages/sdk/src/users.ts:29-52` - `DEFAULT_RESOURCE` loses `authorization_servers`, gains `resource_documentation` holding the documentation URL, and keeps a library fallback identifier for an embedder that names none.
- `UPDATE: packages/sdk/src/users.ts:53-70` - the `resource` option's comment says what a conformant identifier is and what the fallback is not.
- `UPDATE: packages/server/src/config.ts` - a `resource` key: the identifier this host advertises for itself, when the operator wants to name one.
- `UPDATE: packages/server/src/main.ts:548-560` - build the record the daemon passes to `fileUsers`, deriving the identifier from the configured `host` and `port` when neither the flag nor the config names one.
- `UPDATE: test/users.test.ts` - the record's shape and the derivation.
- `UPDATE: docs/USERS.md` - the record a daemon advertises, in the words the field names.

## Steps

1. In `DEFAULT_RESOURCE`, replace the `authorization_servers` entry with `resource_documentation` holding the same URL, and delete the comment that explains why a page was used as an issuer.
2. Leave the library fallback for `resource` in place but say in its comment that it is a library default and not an RFC 9728 identifier, and that the daemon always names one of its own.
3. Add `resource?: string` to `Config` and `--resource <url>` to the flags, following whatever the neighbouring keys do.
4. In `main.ts`, compute the identifier once: the operator's when given, otherwise `https://<host>:<port>/` from the resolved options, with the port and host read from the same options the listener is given. Pass it as `resource` to `fileUsers`.
5. Have the daemon log the advertised identifier at startup, so an operator can see what a client will be told without reading root state.
6. Update `test/users.test.ts` with: the default record has no `authorization_servers`; the docs URL is in `resource_documentation`; a deployment that names a resource advertises exactly it; a deployment that names none advertises an https URL containing its host and port.

## Validation

- `test/users.test.ts` - the four cases in step 6.
- `test/users-host.test.ts` and `test/users-gate.test.ts` updated for the identifier they now read, which is what proves the change is threaded rather than cosmetic.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
`DEFAULT_RESOURCE` lost `authorization_servers` and gained `resource_documentation`; `signInRecord` composes the same record under a deployment's identifier, and `signInIdentifier` and `isIdentifier` in the daemon derive and check one, which `--resource` or the `resource` key names.
The daemon prints a `sign-in <url>` line at startup, and `docs/USERS.md` was rewritten under task 04 rather than here.
Verified by `test/users.test.ts`, `test/daemon.test.ts` and the rest of the suite, and by hand: a daemon with a user file printed `sign-in https://127.0.0.1:9199/`.
`test/users-host.test.ts` and `test/users-gate.test.ts` were not changed: both supply their own record, so the identifier they sign in against is theirs and the plan's assumption that they read the default was wrong.

