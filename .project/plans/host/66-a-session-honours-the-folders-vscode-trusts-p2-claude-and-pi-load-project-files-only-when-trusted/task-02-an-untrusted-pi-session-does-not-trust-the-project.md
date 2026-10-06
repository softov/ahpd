---
title: An untrusted pi session does not trust the project
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L124-L131](../../../../packages/agent-pi/src/backend.ts#L124-L131) - `trustProject`"
  - "[code://packages/agent-pi/src/session.ts#L674](../../../../packages/agent-pi/src/session.ts#L674) - `projectTrust` mapped"
---

## Objective

In a folder the host says is not trusted, pi is started with `trustProject: false` whatever the session's `projectTrust` is; in a trusted folder `projectTrust` decides as today.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:674` - narrow by the host's answer; today `projectTrust` defaults to `trust`, so `.pi/extensions` (code) and `.pi/settings.json` load in any folder.
- `UPDATE: packages/agent-pi/test/` - the case below.

## Steps

1. Failing case first: an untrusted folder, `projectTrust` unset; the backend gets `trustProject: false`. Today `true`.
2. A trusted folder with `projectTrust: deny` still gets `false` (passes before and after).

## Validation

- The case fails on `e1c4ccc` and passes after.

## Resume
