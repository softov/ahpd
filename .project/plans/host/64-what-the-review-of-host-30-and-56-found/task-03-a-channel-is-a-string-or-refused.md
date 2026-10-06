---
title: A channel is a string or the request is refused
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/admission.ts#L44-L52](../../../../packages/sdk/src/host/admission.ts#L44-L52) - `completions` gated only for a string channel"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L113](../../../../packages/sdk/src/host/sessionmethods.ts#L113) - the handlers coerce with `String(params.channel ?? '')`"
  - "[code://packages/sdk/test/users-gate-tables.test.ts](../../../../packages/sdk/test/users-gate-tables.test.ts) - every served method classified"
---

## Objective

A request whose `channel` is present and not a string is refused `-32602` before the gate or any handler reads it, so no method can be reached with a value the gate did not check.

## Files

- `UPDATE: packages/sdk/src/host/admission.ts` - the refusal, ahead of the per-method grants.
- `UPDATE: packages/sdk/test/users-gate-sessions.test.ts` - the case below.

## Steps

1. Failing case first: a guest with only `file:read` sends `completions` with `channel: ["claude:/one"]`; today it gets the session's slash commands, after the fix it gets `-32602`.
2. In admission, before any method's grants: if `params.channel` is present and `typeof` is not `string`, refuse `-32602` with "channel must be a string".
3. Do the same for any other parameter a handler coerces with `String(...)` and the gate reads only when it is a string; list the ones found in the task's Resume.
4. Leave the handlers' `String(...)` alone; the refusal makes it unreachable for a non-string.

## Validation

- The case fails on `main` and passes after; the string form still refuses `-32009` as before.
- `pnpm exec vitest run packages/sdk/test/users-gate*.test.ts`.

## Resume

Built 2026-10-06.

- The case in `packages/sdk/test/users-gate-sessions.test.ts`, `refuses a channel that is not a string rather than reading it as one`. It failed first on `c4e4dd0`: a guest holding only `file:read` was answered `{ result: { items: [{ insertText: '/shout', ... }] } }` - the session's own command - where the same request with the channel as a string is refused `-32009`. `capabilityFor` gates `completions` only when the channel is a string, so the list fell through to `NEEDS.completions`, which is `file:list` and which `file:read` covers, and `String(params.channel ?? '')` in the handler made it the session.
- `admission.ts` gained `spelled(params, ...names)`: `-32602` with `<name> must be a string` for a parameter that is present and is not one. `admit` asks it for `channel` before `capabilityFor`, and the `file` branch of `capabilityFor` asks it for `uri`, `source` and `destination` - the three the gate reads through a `typeof === 'string'` filter and the handlers read through `String(...)`.
- The rest of the parameters coerced with `String(...)` are read by no grant, so no check is skipped by them: `provider`, `chat`, `kind`, `text`, `offset`, `mode`, `handle`, `scope`, `operationId`, `data`, `property`, `token`, `session`, `resource`, `artifactId` and `automation`. `params.config` is the one other thing the gate reads, and `config.computer` goes through `computerSource`, which answers `undefined` for a non-string on both sides of the gate. `source` is a URI for the file methods only: `createChat` sends an object there and returns before the check.
- The check sits after the gate's `users === undefined || connection.root` return, so an install with no user directory is served exactly as it was.
- `pnpm exec vitest run packages/sdk/test/users-gate*.test.ts` passes, 62 tests.
