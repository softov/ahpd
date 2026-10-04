---
title: The URI routing, the client relay and the connection gate are files of their own
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p1-the-grant-and-uri-tables/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L660-L672](../../../../packages/sdk/src/host.ts#L660-L672) - `spaceHere`, `spaceOf` with this host's providers"
  - "[code://packages/sdk/src/host.ts#L1155-L1207](../../../../packages/sdk/src/host.ts#L1155-L1207) - `heldAs`, `names`, `nameOf`, `ownName`"
  - "[code://packages/sdk/src/host.ts#L1540-L1648](../../../../packages/sdk/src/host.ts#L1540-L1648) - `sessionOfChat`, `sessionFor`, `chatOf`, `meantBy`; `drafts` between them stays"
  - "[code://packages/sdk/src/host.ts#L1810-L1985](../../../../packages/sdk/src/host.ts#L1810-L1985) - `spelledFor`, `respell`, `respelledIn`, `spellingOf`, `answeredAs`"
  - "[code://packages/sdk/src/host.ts#L2180-L2213](../../../../packages/sdk/src/host.ts#L2180-L2213) - `sessionHolding`, `channelKind`, `sessionChannel`, `homeOf`"
  - "[code://packages/sdk/src/host.ts#L7035-L7077](../../../../packages/sdk/src/host.ts#L7035-L7077) - `claimable` and `unheld`"
  - "[code://packages/sdk/src/host.ts#L727-L909](../../../../packages/sdk/src/host.ts#L727-L909) - `ownId`, `claimsId`, `ownerOf`, `ask`, `clients`, `relayed`, `elsewhere`"
  - "[code://packages/sdk/src/host.ts#L7494-L7697](../../../../packages/sdk/src/host.ts#L7494-L7697) - `read`, `capabilityFor`, `ownRecord`, `excusedBy`, `denied`, `admit`, inside `accept`"
  - "[code://packages/sdk/src/types/host.ts#L503-L509](../../../../packages/sdk/src/types/host.ts#L503-L509) - `ToolCall`, the one context every host tool is handed, the shape `HostContext` copies"
  - "[code://packages/sdk/src/calllinks.ts#L12-L47](../../../../packages/sdk/src/calllinks.ts#L12-L47) - an interface of what the factory offers, and `create<Name>()`, the factory naming the areas copy"
---

## Goal

Which channel a client's URI means, how a snapshot is spelt back to the client that asked, which client a published URI belongs to, and what a connection's command needs are each one file.
This is the other half of Softov's request: "organize the url matching routing".
It is also the first stateful move, so it creates `host/context.ts`, the `HostContext` every later child adds its fields to.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- What routing reads: `claims`, `agents`, `sessions`, `owners`, `byChat`, `subagents`, `names`, and `waitingFor` (catalogue, p6) from `unheld`.
- `names` is written by `spawn` (`:4067`) and `listing` (`:4269`), so it is a shared map on the context.
- What the relay reads: `connections`, `options.users`, `claims` (through `relayed`, a `Claiming`).
- What admission reads: the `connection`, `options.users`, `options.resourceProviders` through `storeFor`, `channelKind`, `meantBy`, `NEEDS`.
- Open plans that cite the code this child moves: host/30 (`sessionOfChat`, `chatOf`, `meantBy`, `spelledFor`, `channelKind`, `sessionChannel`, `claimable`, `capabilityFor`, `claims`), host/46 (`capabilityFor`).

### Gaps

- The admission functions close over one `connection`, so their factory is called once per connection inside `accept`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `host/context.ts` is created here, types only, with the shared maps, the funnel and the options; every later child adds its area's fields | Softov, 2026-10-03: "One HostContext", in the parent's second table | 01 |
| A shared map is created in `host.ts` and put on the context; a map only this area writes moves into its factory | (defaulted: the move must not change who can write what) | 01, 02, 03 |
| `drafts` stays in `host.ts` with the chat actions that read and write it | [code://packages/sdk/src/host.ts#L1595](../../../../packages/sdk/src/host.ts#L1595) is read and written by `spawn`, `removeSession`, `snapshotOf`, `disposeChat` and the dispatch branches, not by routing | 01 |

## Proposed architecture

- **State flow** - `createRouting(ctx)` reads the shared maps and owns nothing; `createRelay(ctx)` owns `relayed` and offers `clients`; `createAdmission(ctx, conn)` is built per connection from the `ConnectionContext` and owns `read`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Which channel a URI means is one file](task-01-routing.md) | todo | - |
| [02 - A URI a client published is routed by one file](task-02-relay.md) | todo | 01 |
| [03 - A connection's gate is one file](task-03-admission.md) | todo | 01 |

## Risks and tradeoffs

- `heldAs` and `nameOf` are called from almost every area; code still in `host.ts` takes them off the context once they are on it, so the rest of the closure reads unchanged.
- `unheld` calls `waitingFor`, which is still in `host.ts` until p6; `host.ts` puts it on the context, and `unheld` reads `ctx.waitingFor` at call time.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-routing.md](task-01-routing.md).
- **Open questions:** none of its own.
- **Watch out for:** `respelledIn` reads `URI_KEYS`, which p1 moved to `host/channels.ts`.

## Final verification checklist

- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 800 lines fewer than before.
- [ ] `plans/index.md` updated.
