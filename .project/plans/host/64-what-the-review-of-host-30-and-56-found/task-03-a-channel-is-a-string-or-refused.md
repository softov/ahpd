---
title: A channel is a string or the request is refused
status: todo
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
