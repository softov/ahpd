---
title: The grant tables and the URI names are files of their own
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area/plan.md
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L156-L397](../../../../packages/sdk/src/host.ts#L156-L397) - `GREETINGS`, `NEEDS`, `UNGATED`, `dispatchNeeds`, `computerNeeds`, `PER_CONNECTION`, `seesConfig`, `Home`, `ACTION_HOMES`, `HOME_WORDS`"
  - "[code://packages/sdk/src/host.ts#L703-L726](../../../../packages/sdk/src/host.ts#L703-L726) - `DECLARED` and `REVERSE`, method tables inside the closure that read only `ROOT` and `AUTOMATIONS`"
  - "[code://packages/sdk/src/host.ts#L520-L538](../../../../packages/sdk/src/host.ts#L520-L538) - `GATE` and `refusalReason`, both exported from `host.ts`"
  - "[code://packages/sdk/src/host.ts#L65-L139](../../../../packages/sdk/src/host.ts#L65-L139) - `uriOf`, `need`, `ROOT`, `isRootChannel`, `AUTOMATIONS`, `BANG`, `MARKS`, `CLOSING`, `reason`"
  - "[code://packages/sdk/src/host.ts#L398-L518](../../../../packages/sdk/src/host.ts#L398-L518) - `Space`, `spaceOf`, `baseOf`, `NameKind`, `Claimed`, `Claiming`, `URI_KEYS`, `ChannelKind`, `schemeOf`"
  - "[code://packages/sdk/src/host.ts#L615-L630](../../../../packages/sdk/src/host.ts#L615-L630) - `named`"
  - "[code://packages/sdk/src/host.ts#L1512-L1538](../../../../packages/sdk/src/host.ts#L1512-L1538) - `chatUriFor`, `subagentChatUri`, `WORKER_ACTIONS`, `toolCallOfSubagentChat`: inside the closure and reading none of it"
  - "[code://packages/sdk/src/host.ts#L1649](../../../../packages/sdk/src/host.ts#L1649) - `isAutomations`, the same"
  - "[code://packages/sdk/src/host.ts#L950-L979](../../../../packages/sdk/src/host.ts#L950-L979) - `Held`, an interface inside the closure that names imported types only"
  - "[code://packages/sdk/src/host.ts#L1081-L1097](../../../../packages/sdk/src/host.ts#L1081-L1097) - `LiveSubagent`"
  - "[code://packages/sdk/src/host.ts#L1262-L1275](../../../../packages/sdk/src/host.ts#L1262-L1275) - `Learned`"
  - "[code://packages/sdk/src/host.ts#L1999-L2002](../../../../packages/sdk/src/host.ts#L1999-L2002) - `Origin`"
  - "[code://packages/sdk/src/host.ts#L11658](../../../../packages/sdk/src/host.ts#L11658) - `export { ROOT, isRootChannel, type Summary }`"
  - "[code://packages/sdk/test/users-gate.test.ts#L5](../../../../packages/sdk/test/users-gate.test.ts#L5) - imports `GATE` from `../src/host.js`"
---

## Goal

The tables that say what each method and each action needs, and the names a URI is read by, are files of their own, read without reading the host.
This is the half of Softov's request that needs no state: "organize the url matching routing. etc NEEDS in another file."

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -nE "\bneed\b|\breason\b|\bCLOSING\b|\bBANG\b" packages/sdk/src/host.ts` - read by areas that move in different children, so they go to `host/common.ts` now rather than with any one of them.
- The module-level constants read by one area only stay in `host.ts` and move with that area: `runState` (p6), `LISTING_FRESH` (p6), `PAGE_CAP`, `PAGE_MOST`, `sealed`, `opened` (p9), `WRITE_MODES` (p9), `PROXY_ENV`, `PROBE_TIMEOUT`, `MAX_BODY`, `resolved` (p9), `claimOf` (p8), `dispatchable` (p10).
- `URI_KEYS` is read by `respell` alone and `uriOf` by `completions` alone, but both are URI names, so they move here with the rest.
- Open plans that cite the code this child moves: host/30 (`NEEDS`, `dispatchNeeds`, `ACTION_HOMES`, `spaceOf`, `baseOf`, `Claiming`, `named`, `chatUriFor`, `subagentChatUri`), host/45 (`dispatchNeeds`, `PER_CONNECTION`, `seesConfig`), host/46 (`NEEDS`, `UNGATED`, `dispatchNeeds`, `seesConfig`, `ACTION_HOMES`), container/02 (the `container:write` rows of `NEEDS`).

### Gaps

- `dispatchNeeds` reads `isRootChannel` and `ChannelKind`, so `host/gate.ts` imports `host/channels.ts`; neither imports `host.ts`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The pieces with no state move first, unchanged, comments with them | the parent's second table | 01, 02 |
| `host.ts` re-exports `ROOT`, `isRootChannel`, `GATE` and `refusalReason` under the same names | the parent's second table | 01, 02 |
| A helper read by several areas goes to `host/common.ts` | (defaulted: a new file cannot import `host.ts` without a cycle) | 01 |

## Proposed architecture

- **Layer responsibilities** - sdk: `host/common.ts`, `host/state.ts`, `host/channels.ts`, `host/gate.ts` hold declarations only; `host.ts` imports them.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The URI names, the shared helpers and the state's interfaces are their own files](task-01-uri-names-helpers-and-state.md) | done | - |
| [02 - The grant tables are their own file](task-02-the-grant-tables.md) | done | 01 |

## Risks and tradeoffs

- The folder is Softov's answer ("Folder src/host/"), in the parent's second table.

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 450 lines fewer than before.
- [x] `plans/index.md` updated.
