---
title: A policy says who may use which agent, model and computer - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/decide.ts](../../../../packages/sdk/src/decide.ts)"
  - "[code://packages/sdk/src/policies.ts](../../../../packages/sdk/src/policies.ts)"
  - "[code://packages/sdk/src/policy.ts](../../../../packages/sdk/src/policy.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
---

A host can keep policies that say who may use which harness, model and machine, edit them through the `policy:` scheme, and, with `"policies": { "check": true }`, refuse a session or a turn no policy allows, naming the row that refused it.

## What was built

- [`code://packages/sdk/src/types/policies.ts`](../../../../packages/sdk/src/types/policies.ts) - the policy row and the `policies` port.
- [`code://packages/sdk/src/policies.ts`](../../../../packages/sdk/src/policies.ts) - row validation, and the file and memory stores; `limits`, `pool` and `cap` are stored and enforce nothing.
- [`code://packages/sdk/src/policy.ts`](../../../../packages/sdk/src/policy.ts) - the `policy:` scheme, behind `policy:read` and `policy:write`.
- [`code://packages/sdk/src/decide.ts`](../../../../packages/sdk/src/decide.ts) - `decide`: `*:*` allowed, candidates by kind, window, scope and match, any deny wins, no candidate refuses; a deny binds only when everything it names was asked.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `checked` at session creation (harness and machine, before the machine is made, `-32009`) and at each turn (harness, machine and the turn's model); a store that cannot be read refuses.
- `packages/server` - the `policies` setting, file only, the store at `policies.json`, and the start line when checks are on.
- `docs/POLICY.md`, `docs/DAEMON.md`, `docs/USERS.md`, `README.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 157 files and 2299 tests, `pnpm boundary` clean.
- `decide.test.ts`, `policies.test.ts`, `policy-scheme.test.ts`: the draft's examples 15, 16, 19, 21, 22, 26 and 27, limits aside; a deny with an unasked value is not a candidate.
- `policy-checks.test.ts`: created, refused at creation naming the machine, refused at the turn on a denied model (example 21 with the draft's `A5`), the `*:*` holder, root and a host with no users directory refused nothing, all of it again with the switch off, and a store that throws refusing.
- `policy-option.test.ts`: the switch in the file, off by default, a row written through `policy:` read back by a second daemon.

## Departures from the plan

- [A deny binds only when everything it names was asked](../../../decisions/a-deny-binds-only-what-was-asked.md), decided during the build: the draft's `A5` refused the whole session before.
- `beginOrRun` answers at once when there is nothing to check and returns a promise only when a store was read, so the order of a turn's actions is kept.
- A store that cannot be read refuses the work.

## Left for later

- See [deferred.md](deferred.md).
