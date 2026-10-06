---
title: The gate refuses a method it does not know, and the proxy sends a call once
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
decisions:
  - decisions/shutdown-needs-config-change.md
  - decisions/the-proxy-answers-a-providers-key-refusal-with-its-own-error.md
refs:
  - "[code://packages/sdk/src/host/gate.ts#L9-L95](../../../../packages/sdk/src/host/gate.ts#L9-L95) - `NEEDS`, whose comment says a method with no entry is served to anybody connected"
  - "[code://packages/sdk/src/host/gate.ts#L172-L205](../../../../packages/sdk/src/host/gate.ts#L172-L205) - `UNGATED`"
  - "[code://packages/sdk/src/host/admission.ts#L113-L114](../../../../packages/sdk/src/host/admission.ts#L113-L114) - a method with no `NEEDS` entry answers no grant"
  - "[code://packages/sdk/src/host/admission.ts#L239](../../../../packages/sdk/src/host/admission.ts#L239) - and no grant is admitted"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L325-L348](../../../../packages/sdk/src/host/vscodemethods.ts#L325-L348) - `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`"
  - "[code://packages/sdk/src/host.ts#L912](../../../../packages/sdk/src/host.ts#L912) - `handlers`, the table a request is served from"
  - "[code://packages/sdk/src/host.ts#L1029-L1061](../../../../packages/sdk/src/host.ts#L1029-L1061) - an unknown method is `-32601` before the gate, then the gate"
  - "[code://packages/sdk/test/users-gate-tables.test.ts#L23-L55](../../../../packages/sdk/test/users-gate-tables.test.ts#L23-L55) - the classification test, which reads handlers by regex"
  - "[code://packages/server/src/proxy/listener.ts#L322-L349](../../../../packages/server/src/proxy/listener.ts#L322-L349) - `attempt`, which marks every fetch failure `retry: true`"
  - "[code://packages/server/src/proxy/listener.ts#L380-L403](../../../../packages/server/src/proxy/listener.ts#L380-L403) - the candidate loop, and the answer streamed back as it came"
  - "[code://packages/server/src/proxy/dialects.ts#L91](../../../../packages/server/src/proxy/dialects.ts#L91) - `refusalBody`"
---

## Goal

On a host with a users directory, a method nobody classified is refused rather than served to anybody, `shutdown` needs `config:change`, and the classification test sees every method the host serves.
The proxy sends a call to a second provider only when the first never received it, and a provider's refusal of the host's key reaches the caller as the proxy's own error.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "shutdown|getManagedSettingsDiagnostics" packages/sdk/src/host` - served in `vscodemethods.ts`, in neither table in `gate.ts`.
- `rg -n "process.kill" packages/server/src/commands/run.ts` - `shutdown` is `SIGTERM` to the daemon (run.ts:633).
- The test's `handlerKeys` regex reads `name: (params)` and quoted keys; `ping`, `shutdown`, `getManagedSettingsDiagnostics` and `getNetworkDiagnosticsInfo` take no `params` and are not read, and `SERVED = 45` counts only what it reads.

### Gaps

- No case sends `shutdown` from a signed-out or a `member` connection.
- No case has a provider drop the socket after it received the call.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A client's `shutdown` needs `config:change`, and the root connection always may](../../../decisions/shutdown-needs-config-change.md) | Softov, 2026-10-06, "A host admin grant"; the name `(defaulted: matches ahpd restart)` |
| 2 | [The proxy answers a provider's 401 or 403 with its own error, and the provider's words go to the log](../../../decisions/the-proxy-answers-a-providers-key-refusal-with-its-own-error.md) | Softov, 2026-10-06, "The proxy's own error" |

| What | Source | Task |
| --- | --- | --- |
| A served method in neither `NEEDS` nor `UNGATED` is refused `-32009` on a host with users | the review, host/48 p9; `(defaulted: fail closed, so a method added later is refused by omission rather than served)` | 01 |
| The classification test reads the keys of the built handler table, not the source | the review, host/48 p9 | 01 |
| `getManagedSettingsDiagnostics` needs `diagnostics:network` | `(defaulted: the window asks it beside getNetworkDiagnosticsInfo, for the same troubleshooting pane)` | 02 |
| Only connect-phase failures go to the next candidate | proxy/02 plan.md:114, Softov 2026-10-06, "Yes, before any byte": a refused connection, a 429 or a 5xx | 03 |

## Proposed architecture

- **Layer responsibilities** - sdk: 01, 02 (gate, admission, the test) · server: 03, 04 (proxy listener).
- **Source-of-truth files** - [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts), [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A method in neither table is refused](task-01-a-method-in-neither-table-is-refused.md) | todo | - |
| [02 - shutdown needs config:change](task-02-shutdown-needs-config-change.md) | todo | 01 |
| [03 - Only a call that never connected goes to the next provider](task-03-only-a-call-that-never-connected-is-retried.md) | todo | - |
| [04 - A provider's key refusal is the proxy's own error](task-04-a-providers-key-refusal-is-the-proxys-own-error.md) | todo | - |

## Risks and tradeoffs

- Task 01 can refuse a method a client uses that nobody classified; the test makes that a failure at build time, and every served method is classified in the same task.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-method-in-neither-table-is-refused.md](task-01-a-method-in-neither-table-is-refused.md).
- **Open questions:** none.
- **Watch out for:** an unknown method is `-32601` before the gate (host.ts:1030-1035) and stays so; only a served method reaches the fail-closed refusal.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm exec vitest run packages/sdk/test/users-gate-*.test.ts packages/server/test/proxy-*.test.ts` passes.
- [ ] `plans/index.md` updated.
