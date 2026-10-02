---
title: The bridge is on the current SDK entry, and lists sessions properly
domain: acp
status: built
priority: low
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions:
  - decisions/acp-bridge-uses-the-protocol-sdk.md
refs:
  - "[code://packages/agent-acp/src/connection.ts#L14](../../../../packages/agent-acp/src/connection.ts#L14) - `ClientSideConnection`, deprecated in the SDK"
  - "[code://packages/agent-acp/src/connection.ts#L45](../../../../packages/agent-acp/src/connection.ts#L45) - `clientInfo` version `0.0.1`"
  - "[code://packages/agent-acp/src/catalog.ts#L116-L139](../../../../packages/agent-acp/src/catalog.ts#L116-L139) - `list` spawns a process per call and reads the first page only"
  - "[code://packages/agent-acp/package.json](../../../../packages/agent-acp/package.json) - `@agentclientprotocol/sdk` `^1.4.0`"
  - npm://@agentclientprotocol/sdk@^1.5.0 - `client({ name }).connect(stream)`
---

## Goal

The bridge uses the SDK's current client builder on `^1.5.0`, reports its own package version, follows `session/list` pages to the end, and reuses one listing connection instead of spawning per call.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- A deprecated entry point, a fixed version string, one page, one process per list.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [The ACP bridge uses the published protocol SDK](../../../decisions/acp-bridge-uses-the-protocol-sdk.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| Stay on ACP v1 | plugin 18's deferred.md, Softov 2026-09-26 | 01 |
| The listing connection closes after a minute idle | (defaulted) | 02 |

## Proposed architecture

- **Layer responsibilities** - `connection.ts` and `catalog.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The current client entry and version](task-01-the-current-client-entry.md) | done | - |
| [02 - Listing follows pages on one connection](task-02-listing-follows-pages.md) | done | - |

## Risks and tradeoffs

- The builder's handler shapes differ - task 01 is a mechanical move with no behaviour change.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] No deprecated import; `clientInfo` has the real version; a long list is whole.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
