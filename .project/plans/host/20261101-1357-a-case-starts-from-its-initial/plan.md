---
title: A case starts from its initial
domain: host
status: active
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md
  - plans/host/20261101-0207-the-protocol-cases-are-the-oracle/plan.md
refs:
  - git://c7899eff - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145 - the protocol's harness runs a case from its `initial` and holds the result to its `expected`"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1538-L1548 - the reference host's state opens with the seed it is handed"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `driven`, which starts each case from the host's own state"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions`, where `now` and `timer` are the seams a test supplies"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `openState`, where every held state opens"
---

## Goal

Each of the protocol's root, session and chat cases runs through the host from the case's own `initial`.
The result is held to the case's `expected`, and every key the host says otherwise is named with its source.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "initial" packages/sdk/test/ahp-test-cases.test.ts` - the driver starts from the watching client's snapshot of the host's own state.
- `rg -n "now\?\(\)|timer\?\(" packages/sdk/src/types/host.ts` - the seams a test hands a host.
- `rg -n "openState" packages/sdk/src` - the one place a held state opens.

### Gaps

- A case's `initial` is set aside, so a case about a queue, a draft or a working directory runs against a state that has none.
- Cases 272 and 273 name a peer chat and run on the default chat.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A host takes an `opening` seam, read once when a root, session or chat channel opens, the way a test hands it a clock | [code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) `now`, `timer`; [agentHostStateManager.ts#L1538-L1548](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1538-L1548) | 01 |
| The driver opens each case's channel with its `initial`, and runs 272 and 273 on a peer chat it creates | [reducers.test.ts#L116-L145](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145) | 02 |
| The start a watching client is served is held to `initial`, and what it holds afterwards to `expected` when the start is `initial` and nothing was refused | [reducers.test.ts#L116-L145](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145) | 02 |
| What a created session says as it comes up, `session/ready` and its customizations, is allowed at the start with the protocol's sentences | `types/channels-session/actions.ts`, `session/ready` and `session/customizationsChanged` | 02 |
| Each other difference the start shows is a divergence named with its correction, or allowed with the sentence that allows it | the oracle plan's *Answers* | 02 |

## Proposed architecture

- **Data flow** - `driven` hands the host `opening`, which answers the case's channel with a copy of `initial`.
- **State flow** - the held state opens from that copy, and every action after it moves it as it moves any channel.
- **Source-of-truth files** - [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a channel opens with the state it is handed](task-01-a-channel-opens-with-a-given-state.md) | todo | - |
| [02 - each case starts from its initial](task-02-each-case-starts-from-its-initial.md) | todo | 01 |

## Risks and tradeoffs

- A host action that names a chat the seeded state does not list changes nothing on the session channel.
- So case 072, whose session holds no chats, shows no read bits moving together; correction 6's own tests hold that divergence.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-channel-opens-with-a-given-state.md](task-01-a-channel-opens-with-a-given-state.md).
- **Open questions:** none.
- **Watch out for:** a session the driver creates says its customizations and `session/ready` after its state opens.

## Final verification checklist

- [ ] `ahp-test-cases.test.ts` passes, and each new entry failed before it was written.
- [ ] The oracle plan's [deferred.md](../20261101-0207-the-protocol-cases-are-the-oracle/deferred.md) lists only what still waits.
