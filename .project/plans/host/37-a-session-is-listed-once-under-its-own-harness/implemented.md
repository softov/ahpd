---
title: A session two harnesses both list is listed once, under the harness it runs on - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
---

The host records which harness each session runs on, and the catalogue lists a session two harnesses both read once, under that harness, so Claude loaded twice no longer shows every session twice or resumes one on the other endpoint.

## What was built

- `SessionStore.provider` and `setProvider`, kept by the memory and file stores beside the owner and forgotten with the rest; a file written before reads as nothing recorded.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `keepProvider` at create and resume, and at a turn's end against the chat's own id once the backend names it, which covers forks and ids the backend picked.
- `listing()` gathers every agent's rows, then keeps one per id: the recorded provider's when loaded, else the first loaded agent that listed it; `names` and `owners` come from the kept row.

## Verified

- `packages/sdk/test/sessions.test.ts`: round-trip, forget, an old file, a row with no harness.
- `packages/sdk/test/session-provider.test.ts`: create, resume, fork, a backend naming its id after its first turn, a second turn writing nothing, a refused create; two agents listing one id give one row under the recorded provider in either load order, an unrecorded or unloaded one goes to the first, and a turn on the kept row reaches its own agent.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 145 files, 2129 tests passed; `pnpm boundary` clean.

## Departures from the plan

- A fork is recorded at its first turn's end rather than when it is cut, because its transcript id is named only then.
- `00-host.md` is unchanged; it does not describe the catalogue.

## Left for later

- Presets as harnesses: [claude/15](../../claude/15-one-load-and-each-preset-is-a-variant/plan.md).
