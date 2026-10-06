---
title: The method table is split by family
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p8-tools-terminals-and-automations/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L7762-L9811](../../../../packages/sdk/src/host.ts#L7762-L9811) - `handlers`, 47 methods in one object literal inside `accept`"
  - "[code://packages/sdk/src/host.ts#L7380-L7468](../../../../packages/sdk/src/host.ts#L7380-L7468) - `tokensFor`, `expiring`, `LONGEST`, `expire`, `forgetExpiry`"
  - "[code://packages/sdk/src/host.ts#L7470-L7493](../../../../packages/sdk/src/host.ts#L7470-L7493) - `storeFor`"
  - "[code://packages/sdk/src/host.ts#L7698-L7761](../../../../packages/sdk/src/host.ts#L7698-L7761) - `alive`, `containers`, `CONTAINER_TAIL`, `containerAsk`, `namedContainer`"
  - "[code://packages/sdk/src/host.ts#L11526-L11654](../../../../packages/sdk/src/host.ts#L11526-L11654) - `handle`, which looks a method up in `handlers` and stays"
  - "[code://packages/sdk/test/users-gate.test.ts#L135-L163](../../../../packages/sdk/test/users-gate.test.ts#L135-L163) - finds the handlers by reading `host.ts` with an 8-space indent"
  - "[code://packages/sdk/src/sessiontools.ts#L355](../../../../packages/sdk/src/sessiontools.ts#L355) - `sessionTools()`, a family's entries returned as a table, the shape each method family copies"
---

## Goal

The JSON-RPC methods a connection is served are grouped by family, one file each, and `accept` builds `handlers` by spreading the families' tables.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -nE "^        '?[a-zA-Z/]+'?: (async )?\(" packages/sdk/src/host.ts` - the 47 methods and where each starts.
- Per-connection state the methods read: `connection`, `handshook` (written by `initialize` and `reconnect`), `tokensFor` (also read by three dispatch branches), `forgetExpiry` (also read by `handle`'s close), `storeFor`, `admit`, `alive` (written by the close in `handle`), `containers`.
- Open plans that cite the code this child moves: host/43 p2 (`ping`, the seven `return {}`, `fetchAutomationRuns`, the `vscode/devContainers/*` requests, `resolveSessionConfig`), host/43 p4 (`argumentHint` in `completions`), host/30 (`initialize`, `reconnect`, `subscribe`), host/44 (`initialize`), host/44 p2 (`runAutomation`), host/44 p3 (`createChat`, `disposeChat`), host/46 (`initialize`'s `_meta`, `createChat`), container/02 and container/03 (`containers`, the dev container handlers), container/05 p9 (`disposeSession`).

### Gaps

- The handler classification test reads `host.ts` alone, so it must read every file that holds handlers before the first one moves.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each method family's factory takes the `HostContext` and the `ConnectionContext` built once per connection | the parent's second table, Softov's "One HostContext" | 02 to 05 |
| Each family is a table its factory returns, spread into `handlers` in today's order | Softov, 2026-10-03: "~29 files as drafted", in the parent's second table | 02 to 05 |
| The classification test reads `host.ts` and every file under `host/`, and finds a handler by its key whatever the indent | [code://packages/sdk/test/users-gate.test.ts#L142](../../../../packages/sdk/test/users-gate.test.ts#L142) | 01 |
| The per-connection `let`s (`handshook`, `alive`) become fields on the `ConnectionContext` | Softov, 2026-10-03: "One HostContext", in the parent's second table | 02, 05 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The handler classification test reads every file that holds handlers](task-01-the-classification-test-reads-every-file.md) | done | - |
| [02 - Introduction and sign-in are one file](task-02-handshake.md) | done | 01 |
| [03 - The resource methods are one file](task-03-resource-methods.md) | done | 01 |
| [04 - The session methods are one file](task-04-session-methods.md) | done | 01 |
| [05 - The vscode, diagnostic, terminal and automation methods move to their files](task-05-vscode-terminal-and-automation-methods.md) | done | 01 |

## Risks and tradeoffs

- The classification test's count floors (`> 30`, `> 5`) would still pass if it found only some handlers; task 01 counts every handler it finds and compares with the keys of a built `handlers` table where it can.

## Resume state

- **Done so far:** built 2026-10-04 in `ca6adcb`; see [implemented.md](implemented.md).
- **Next action:** Softov's review, which moves the tasks from `implemented` to `done`.
- **Open questions:** none.

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `users-gate.test.ts` finds the same number of handlers it found before task 01 - 45, checked after every task.
- [x] `wc -l packages/sdk/src/host.ts` recorded: 5,077 before p9, 2,768 after.
- [ ] `plans/index.md` updated - the brief for this session says not to edit it.
