---
title: The gate refuses a method it does not know, and the proxy sends a call once - implemented
date: 2026-10-06
refs:
  - git://0cdbb95
  - "[code://packages/sdk/src/host/admission.ts](../../../../packages/sdk/src/host/admission.ts) - the fail-closed branch in `capabilityFor`"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts) - the two rows added to `NEEDS`, and the comment that now says a method with no entry is refused"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `accept` returning `methods`"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `Host.methods`"
  - "[code://packages/sdk/test/users-gate-tables.test.ts](../../../../packages/sdk/test/users-gate-tables.test.ts) - the classification test, now reading the served table"
  - "[code://packages/sdk/test/users-gate-commands.test.ts](../../../../packages/sdk/test/users-gate-commands.test.ts) - the three cases for tasks 01 and 02"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `NEVER_ARRIVED`, `refusalWords` and the answer to a 401 or 403"
  - "[code://packages/server/test/proxy-forward.test.ts](../../../../packages/server/test/proxy-forward.test.ts) - the three cases for tasks 03 and 04"
---

A served method that nobody classified is refused rather than served to anybody who completed a handshake, and `shutdown` and `getManagedSettingsDiagnostics` now have rows saying what they need. The classification test reads the names the host actually serves rather than a regex over the source, so the next method added to the handler table fails the suite instead of being served ungated. The model proxy retries a provider only when the call never arrived there, and answers a provider's refusal of this host's key with this host's own error, keeping the provider's words, and the account and key it names, in the log.

## What was built

- [`code://packages/sdk/src/host/admission.ts`](../../../../packages/sdk/src/host/admission.ts) - `capabilityFor` fails closed: a method in `UNGATED` answers no grant, and one in neither table throws `-32009`, `This host has classified <method> nowhere, so it serves it to nobody`, before any handler runs. Read as "needs nothing", as it was, an entry nobody wrote was the widest answer there is, which is how `shutdown` came to be `SIGTERM` for any connection that had signed in or not.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - two rows added. `shutdown: 'config:change'`, because stopping the daemon ends every session on the machine and is a host-wide change rather than the window's - decision `shutdown-needs-config-change`. `getManagedSettingsDiagnostics: 'diagnostics:network'`, beside `getNetworkDiagnosticsInfo` for the same troubleshooting pane. `diagnosticsFetch` and the rest already had their rows; the two absent ones were the finding. `NEEDS`' own comment now says a method with no entry anywhere is refused by `capabilityFor`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `accept` returns `methods: Object.keys(handlers)`, and `Host` declares `methods: readonly string[]`. The handler table is rebuilt per connection, so this exposes the names without a shared copy that could drift from what is served.
- [`code://packages/sdk/test/users-gate-tables.test.ts`](../../../../packages/sdk/test/users-gate-tables.test.ts) - the `handlerKeys` regex over `host.ts` is gone; the test takes `accept(peer()).methods` and asserts every one is a key of `NEEDS` or a member of `UNGATED`, and that the count is `SERVED`.
- [`code://packages/sdk/test/users-gate-commands.test.ts`](../../../../packages/sdk/test/users-gate-commands.test.ts) - three cases: a connection that is nobody is refused `shutdown` with `-32007` and the spy is not called; a served method deleted from `GATE.NEEDS` inside a `try/finally` is refused `-32009` and named; and `shutdown` is gated on `config:change` while `getManagedSettingsDiagnostics` answers to `diagnostics:network`, with a root connection allowed either.
- [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts) - `NEVER_ARRIVED`, the six codes that mean the provider never received the call (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`, `UND_ERR_CONNECT_TIMEOUT`), read through `codeOf`; `attempt` marks `retry` from that set rather than from every throw, so a socket dropped after the call arrived is answered rather than sent again and charged twice. `refusalWords` reads a 401 or 403 body under a 4 KiB bound through `bodyBound`, and the candidate loop answers `502` with the dialect's own error, `model <name> on <provider> refused this host's key`, while the provider's message and the account it names go to the log - decision `the-proxy-answers-a-providers-key-refusal-with-its-own-error`.

## Verified

- Every case failed first on the code standing before the fix, and passes after. Task 03's dropped-socket case was written asserting the log is empty to surface the code undici reports, which is `UND_ERR_SOCKET`, and the assertion was then pinned to it.
- `npx tsc -b` clean.
- `npx vitest run packages/sdk/test` - 106 files, 1481 tests pass. `npx vitest run packages/server/test` - 38 files, 731 tests pass.
- The work is uncommitted on `0cdbb95`.

## Departures from the plan

- Task 01 named one case for an unsigned connection sending `shutdown` and expected `-32009`. Once task 02 gives `shutdown` its `config:change` row, that connection is refused `-32007`, `Sign in to use this host`, before any grant is asked for. The case is now two: one asserting `-32007` for a connection that is nobody, and one that removes `shutdown` from `GATE.NEEDS` inside a `try/finally` to reach and assert the fail-closed branch, since after task 02 no served method is unclassified and the branch is otherwise unreachable from a test.
- `SERVED` changed from 45 to 47, which is the real key count of the built table. The regex the plan named read two notification names as handlers, `unsubscribe` and `dispatchAction`, which are not in the table, and missed four handlers whose declaration has no `(params)`, among them `ping`, `shutdown` and both diagnostics reads. Reading `accept`'s own keys is what makes the number and the list the same thing.

## Review fixes

- A provider's 401 or 403 sentence went to the log as it came, with the key it quoted still in it. `refusalWords` now takes the values this call was made with and redacts four shapes out of the line: a value the call used, an `sk-`-prefixed one, a `Bearer` value, and a run of 20 or more token characters after the word `key`. The case is `takes every key-shaped run out of the provider's words before the log keeps them`, and it fails without the fix - the line read `key sk-account-1234 for org-acme is 401` - and passes with each key `[redacted]` and the sentence around it kept, which is what the log is read for.
- The comment above the 401 or 403 branch said the next candidate would be called with the same key. Candidates are different providers with keys of their own, so that was not the reason. It now gives the one the decision gives - a key refusal is this host's own configuration, answered with this host's error - and the loop's retry set: only a connection that never arrived, a 429 and a 5xx.
- This file said four `NEEDS` rows were added. Two were, `shutdown` and `getManagedSettingsDiagnostics`; `diagnosticsFetch` already had its row. Corrected in the refs and under What was built.
- The redaction left `npx tsc -b` failing: `packages/server/src/proxy/listener.ts(516,53): error TS2322: Type 'string | undefined' is not assignable to type 'string'`, because a candidate's `key` is optional - a provider with none - and it was passed as `[candidate.key]`. The call names the key only when there is one, `candidate.key === undefined ? [] : [candidate.key]`, which is also what the redaction wants: nothing to replace. The build is clean again, and this is the one review fix here with no case of its own, since it is a type and not a behaviour.

## Left for later

- none. Nothing this plan named is left; there is no `deferred.md`.
