---
title: The wire is the protocol's, and the wire test proves every frame against AHP 0.9.0
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires: []
refs:
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the strict schema check over a recorded host, which checks snapshots and actions only"
  - "[code://tools/schema.mjs](../../../../tools/schema.mjs) - generates the strict schema the check runs on"
  - "[code://tools/wire.mjs](../../../../tools/wire.mjs) - routes a frame to its declaration"
  - "[code://packages/sdk/src/rpc.ts#L220](../../../../packages/sdk/src/rpc.ts#L220) - `result ?? {}`, which turns every `null` into `{}`"
  - "[code://packages/server/src/rootconfig.ts#L156-L201](../../../../packages/server/src/rootconfig.ts#L156-L201) - the root config schema a `config:read` connection reads"
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - the protocol surface, row by row, and where this host departs"
  - "npm://@microsoft/agent-host-protocol@0.9.0 - `CommandMap` and `ServerNotificationMap` (`src/types/common/messages.ts:160-191`, `:244-254`), `ConfigPropertySchema` (`src/types/common/state.ts:158-183`)"
  - "file:///home/softov/.local/cache/tmp/claude-1000/-home-softov/f22339a5-d379-4c13-91e4-d62f169fefc8/scratchpad/proto-audit.test.ts - the scratch audit these plans come from, with `audit-report.txt` beside it; scratch, so it may be gone"
---

## Goal

Every frame ahpd sends is one AHP 0.9.0 declares: request results are the declared shapes, `null` included, actions carry only declared fields, the root config schema is one a client can read, and every `_meta` key ahpd invents says it is ahpd's.
The wire test is what proves it, so it is extended first: every request and result by `CommandMap`, every notification by `ServerNotificationMap`, over a host with a users directory, a signed-in person on a team, an automation with an owner and its run, and the daemon's root config with a plugin's options.
What ahpd keeps on purpose for VS Code parity stays, and is listed by name in the test and in `docs/AHP.md`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
An audit on main ran the wire test's machinery over a wider host and reported the defects below; each one was re-read on `08371ca` before it became a task.

### Searches performed

- `rg -n "result \?\? \{\}" packages/*/src` - one site, `packages/sdk/src/rpc.ts:220`.
- `rg -n "return \{\};" packages/sdk/src/host.ts` inside the seven handlers - `ping` (:7667), `createTerminal` (:8231), `disposeTerminal` (:8242), `createSession` (:8867), `createChat` (:8991), `disposeChat` (:9022), `disposeSession` (:9026).
- `rg -n "inputRequested" packages examples` - `packages/agent-claude/src/session.ts:2085`, `examples/notes/agent.ts:271`.
- `rg -n "sessionState: \(\) => \(\{" -A3 packages examples` - `resource` on the session state from echo, notes, acp and cofold; claude already leaves it off.
- `rg -n "_meta" packages/*/src` - the unprefixed keys listed in p4, and the reference's own keys, which stay.
- `/github/ahpapp`, `/github/ahpc` - the readers of each renamed key, listed in p4.

### Runtime path

```
handler result -> rpc.ts response frame -> client
backend emit -> host dispatch -> action notification -> client
rootConfig port schema -> RootState.config -> config:read connection
```

### Gaps

- The wire test records `result` before `rpc.ts` turns it into the frame, checks no request params, no result outside a snapshot or a resolved config, and no notification but `action`.
- `tools/schema.mjs` folds every `Partial<T>` into one `Partial` definition, and checks the bit-flag `SessionStatus` as an enum of single flags.

## Decisions locked in

| What | Source | Plan |
| --- | --- | --- |
| The wire test is extended first, and every later fix is proven by a line leaving its known-defects list | the request, 2026-10-03: "p1 the checker and the permanent wire coverage (item 8) first, so every later fix is proven by it" | p1 |
| Results, actions and the session config schema match the protocol | AHP 0.9.0 `CommandMap`, `ChatInputRequestedAction`, `SessionConfigSchema`, `SessionState` | p2 |
| `activity: null`, the bare `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch`, the `vscode/*` requests and the `vscode/devContainers/*` notifications stay, as deliberate departures | the request, 2026-10-03: "Keep, for VS Code parity (do not change)" | p2 |
| The root config schema is mapped to `ConfigPropertySchema`, and validation stays on ahpd's own schema | the request, 2026-10-03, item 4 | p3 |
| Every `_meta` key ahpd invents becomes `_meta['ahpd.<name>']`, `ahp.commit` becomes `ahpd.commit`, and ahpapp and ahpc are updated in the same wave | Softov, 2026-10-03, asked "how are `_meta` keys that ahpd invents named?": "Rename all + clients" | p4 |

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The wire test checks every request, result and notification](../43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md) | planned | - |
| [p2 - Results and actions are the protocol's shapes](../43-the-wire-is-the-protocols-p2-results-and-actions-are-the-protocols/plan.md) | planned | p1 |
| [p3 - The root config schema is one a client can read](../43-the-wire-is-the-protocols-p3-the-root-config-schema-conforms/plan.md) | planned | p1 |
| [p4 - Every `_meta` key ahpd invents is named `ahpd.<name>`](../43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) | planned | p1, and ahpapp and ahpc reading both names |

## Risks and tradeoffs

- p2 changes two answers clients read: seven results become `null`, and `fetchAutomationRuns` answers `{}` with the page on `automation/set`; ahpc's `automationRuns` reads `result.runs` today and must read the entry (see the client hand-off note).
- p4 renames keys ahpapp and ahpc read; landing it before both read the new name blanks a cost, a cache-write count, a staged mark and a session's model in those clients.

## Resume state

- **Done so far:** nothing.
- **Next action:** [p1](../43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md).
- **Open questions:** p3's `http` type, explained to Softov and awaiting confirmation; `writeOnly` (not sent) and the timing keys (prefixed) are answered in p3 and p4.
- **Waits on:** AHP 1.0.0, released 2026-10-03 as `latest`: every child is re-checked against it before a task is built, since these plans were written against 0.9.0.
- **Watch out for:** a fix that lands without removing its line from p1's known-defects list fails the wire test, and that is the point.

## Final verification checklist

- [ ] p1 to p4 built, and the wire test's known-defects list and pending-rename list are empty.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
