---
title: Every dispatch is answered once, by its own action
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://e4694965 - R1's continuation, the commit this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/commands.ts#L573-L575 - `dispatchAction`: \"the server echoes them back as an ActionEnvelope once accepted\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L20 - `rejectionReason`: \"the server rejected the action. The client should revert its optimistic prediction.\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md - a client holds its action pending until its echo or a rejection"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-automation/actions.ts#L61-L103 - an automation request leaves optimistic state unchanged, and the host publishes the result with `automation/set`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-automation/actions.ts - `automation/removed`: removing an unknown resource is an idempotent no-op"
  - "[code://packages/sdk/src/host.ts#L959-L976](../../../../packages/sdk/src/host.ts#L959-L976) - `dispatch`, where a turn's end lets go of the answers owed to it"
  - "[code://packages/sdk/src/host.ts#L2018-L2024](../../../../packages/sdk/src/host.ts#L2018-L2024) - `refuseFailed`, which refuses any dispatch whose apply threw"
  - "[code://packages/sdk/src/host/actions.ts#L596-L710](../../../../packages/sdk/src/host/actions.ts#L596-L710) - an automation's create, update and removal"
  - "[code://packages/sdk/src/host/chatactions.ts#L533-L543](../../../../packages/sdk/src/host/chatactions.ts#L533-L543) - a stop owed to the backend running the turn"
---

## Goal

Every dispatch this host accepts is answered once, by the client's own action, and a refused one by its rejection.
An answer a backend owes is given when the turn it belongs to ends first.
A dispatch already answered is never refused after.
An automation request is answered by itself, beside the `automation/set` it causes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "owe\(" packages/sdk/src` - a stop, a turn start, a queued message and a client's result are owed by a backend.
- `rg -n "refuseFailed" packages/sdk/src/host.ts` - every throw from an apply is refused, answered or not.
- `rg -n "automation/(create|update)Requested|automation/removed" packages/sdk/src/host` - the request's only answer is the store's `automation/set`.

### Runtime path

```
client chat/turnCancelled {turnId: t1} -> owed under the stop -> the backend's cancel
  -> the backend completes t1 first -> chat/turnComplete t1
  -> dispatch's turn end deletes the owed stop -> the client's stop is never answered
client chat/draftChanged -> the backend says the draft (the echo) and then throws
  -> refuseFailed -> a rejection after the echo
client automation/createRequested -> store.create -> automation/set, no origin
  -> the client's request is never answered
```

### Gaps

- A stop, a start or a client's result owed to a turn that ended first goes unanswered.
- A dispatch whose apply answered it and then threw is refused as well.
- An automation request, and a removal of an unknown automation, go unanswered.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An owed start is said before the end of its turn, and an owed stop or result after it | commands.ts L573-L575; the reducer ends only the active turn | 01 |
| A dispatch answered once is not refused after | actions.md L20; reconciliation.md | 02 |
| An automation request is answered by itself, once the store took it | commands.ts L573-L575; automation actions.ts L61-L103 | 03 |
| A removal of an unknown automation is answered by itself | the same; "an idempotent no-op" | 03 |

## Proposed architecture

- **Data flow** - the answers owed to a turn are given at its end; the dispatches answered are held by their origin.
- **State flow** - an owed start goes out before the end, so the reducer has the turn to end.
  An owed stop or result goes out after it, and reduces to nothing.
- **Layer responsibilities** - sdk host: `host.ts` and `actions.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the answers a turn owes are given at its end](task-01-the-answers-a-turn-owes-are-given-at-its-end.md) | planned | - |
| [02 - a dispatch answered is not refused after](task-02-a-dispatch-answered-is-not-refused-after.md) | planned | - |
| [03 - an automation request is answered by itself](task-03-an-automation-request-is-answered-by-itself.md) | planned | - |

## Risks and tradeoffs

- The rest of correction 3 is not in this plan.
  The ledger's section "Corrections 3 and 4, as built" lists each label left and its next step.

## Resume state

- **Done so far:** planned 2026-11-02.
- **Next action:** task 01.
- **Open questions:** none for these tasks. C12, a client set's `clientId` rewritten to the connection's, stays open in the ledger.
- **Watch out for:** an owed start said after its turn's end would start a turn nothing ends.

## Final verification checklist

- [ ] Each new case fails on e4694965 and passes after the change.
- [ ] `pnpm run typecheck`, `pnpm run boundary` and `pnpm run i18n` report no errors.
