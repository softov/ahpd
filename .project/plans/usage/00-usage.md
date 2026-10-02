---
title: Usage - what exists today
domain: usage
revalidated: 2026-10-02
---

Usage is what the host records about model use and computer time, so it can be reported and, later, limited per user, team and project.
The host now writes one `ModelUse` per turn from what the harness reported while that turn ran, so a turn can be charged to the person who sent it and to the team and project its session was scoped to.

## Packages

- [`code://packages/sdk`](../../../packages/sdk) - the host and its ports; the `usage` port and the meter that feeds it live here.
- [`code://packages/server`](../../../packages/server) - the composition root that wires the default store.

## Contracts

- [`code://packages/sdk/src/types/host.ts`](../../../packages/sdk/src/types/host.ts) - `HostOptions`, where a port is injected.
- [`code://packages/sdk/src/types/plugin.ts`](../../../packages/sdk/src/types/plugin.ts) - `PortKey`, the closed union of ports.

## Runtime path

```
backend chat/usage -> session emit -> meter (holds it against the turn) -> dispatch -> clients
backend chat/turnStarted -> meter (when the turn began, and the model it named)
backend chat/turnComplete|turnCancelled|error -> meter -> usage.record -> one ModelUse for the turn
```

`usage.per: "report"` in the daemon configuration is the same path with the record written as each report arrives rather than at the turn's end, each holding what that report added since the one before it.

A worker's chat reports through `sendSubagent`, not the session's own emit, so a turn that delegated to a worker is billed once and not twice.

## Tests

- [`code://packages/sdk/test/sessions.test.ts`](../../../packages/sdk/test/sessions.test.ts) - the versioned file store pattern a usage store copies.
- [`code://packages/sdk/test/usage-meter.test.ts`](../../../packages/sdk/test/usage-meter.test.ts) - what a turn is charged, and for whom, driven through a real host.

## Known gaps

- Computer time has no record yet: the record kind exists and nothing writes it.
- A report that names no model and a turn that asked for none is written with an empty `model.name` (decision `a-model-record-with-no-model-named-has-an-empty-name`).
- Per report, a count that came down is written as the value it is now, so a harness that recounts overstates rather than understates.
- The policy rules are a draft: file:///github/ahp-review/prospect/ahp-user-rules.md.
