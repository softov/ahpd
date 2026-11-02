---
title: Every accepted action goes to every subscriber
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://e4694965 - R1's continuation, the commit this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/ahp-and-acp.md#how-they-compose - a client's action: \"Host sequences it - assigns a `serverSeq`, applies it to the authoritative state, broadcasts the action envelope to all subscribed clients.\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143 - root, session, chat and terminal actions go to all clients subscribed to the channel"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/state.ts#L357 - `Snapshot.fromSeq`: \"Subsequent actions will have `serverSeq > fromSeq`.\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L18 - `serverSeq`: \"Monotonically increasing sequence number assigned by the server, used for ordering and replay.\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md - a refusal removes the sender's pending action; a client that reconnects clears what it held pending"
  - "https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1237-L1253 - VS Code's session handler sends its active client set only when the held entry and what it sent last both differ"
  - "[code://packages/sdk/src/host.ts#L1102-L1112](../../../../packages/sdk/src/host.ts#L1102-L1112) - `refuse`, to the sender alone and unbuffered"
  - "[code://packages/sdk/src/host/actions.ts#L733-L790](../../../../packages/sdk/src/host/actions.ts#L733-L790) - the active client set, with the guard of cf90c9e4"
  - "[code://.project/plans/host/97-an-unchanged-client-set-is-echoed-back/plan.md](../97-an-unchanged-client-set-is-echoed-back/plan.md) - the sender-only echo and its reused `serverSeq`, chosen by Softov on 2026-10-16"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the oracle, whose `DIVERGES` holds ten cases as `BROKEN.senderOnly`, by correction 4"
---

## Goal

A client's action this host accepts goes to every client of its channel.
It takes the next `serverSeq`, is applied through the channel's reducer and is kept for replay, as every other action is.
An action the reducer leaves as it was is one of them.
A refusal goes to its sender alone, unbuffered, at the next `serverSeq`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "echoTo\(" packages/sdk/src` - fifteen calls, nine in `chatactions.ts` and six in `actions.ts`, each for an action that moves nothing.
- `rg -n "serverSeq: ctx.serverSeq" packages/sdk/src` - `refuse` and `echoTo`, the two envelopes that reuse the current number.
- `rg -n "activeClientSet" ahpc ahpw cligma` and VS Code at 3a242139 - the clients that send a set, and when.
- `git log -S"round trips in a few seconds"` - cf90c9e4, Softov's silence for an unchanged set, and why.

### Runtime path

```
client dispatchAction {session/isReadChanged, isRead: true}, the bit already set
  -> sessionFlag answers false
  -> echoTo(sender): the sender's envelope at the current serverSeq, nobody else, not buffered
  -> a second client's reduced state never sees the action
client dispatchAction refused right after a subscribe
  -> refuse(sender) at serverSeq === the snapshot's fromSeq
```

### Gaps

- Ten oracle cases diverge as `BROKEN.senderOnly`: a client that only watched holds less than the reducer's state.
- A refusal or an echo sent right after a subscribe carries the snapshot's own `fromSeq`.
- `Not found: a source for an echo to the sender alone - searched subscriptions.md, ahp-and-acp.md, reconciliation.md and commands.ts.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| An accepted action goes to every subscriber of its channel, sequenced and applied | ahp-and-acp.md "How They Compose", step 2; subscriptions.md L140-L143 | 01 |
| An action the reducer leaves as it was is accepted and goes the same way | the same; no validation table lists a no-op as invalid | 01 |
| Terminal input goes to every client of the terminal | terminal-channel.md L110-L112: a side-effect-only client action, and a terminal action | 01 |
| A refusal takes the next `serverSeq` | state.ts L357; actions.md L18 | 01 |
| A refusal stays with its sender, unbuffered | reconciliation.md steps 2 and 3, and L81 | 01 |
| A client that reconciles on every move sends its set once | VS Code's session handler L1237-L1253; the loop of cf90c9e4 kept as the acceptance | 01 |
| Plan host/97's sender-only echo and its reused `serverSeq` go | Softov's choices of 2026-10-16 name no source; "spec wins more like always" | 01 |

## Proposed architecture

- **Data flow** - an accepted action that moves nothing goes through `dispatch`, as every other accepted action does; `echoTo` goes.
- **State flow** - `emit` sequences, reduces, buffers and broadcasts it; the reducer leaves the state as it was.
- **Layer responsibilities** - sdk host: `chatactions.ts`, `actions.ts`, `host.ts`, `context.ts`. docs: AHP.md's section on accepted actions, and each row that said sender-only.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - every accepted action goes to every subscriber](task-01-every-accepted-action-goes-to-every-subscriber.md) | planned | - |

## Risks and tradeoffs

- Terminal input reaches every client of the terminal, and the replay buffer, as VS Code's host has it.
- A client that sends its set again on every state move loops with any host that echoes.
  Every client found that sends a set guards against it or sends it once.

## Resume state

- **Done so far:** planned 2026-11-02.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the oracle's `DIVERGES` rows for `senderOnly` go with the change; a row left behind fails the oracle.

## Final verification checklist

- [ ] Each new or changed case fails on e4694965 and passes after the change.
- [ ] A client that reconciles on every move as VS Code does sends its set once; one that sends on every move does not stop.
- [ ] The oracle passes with the ten `senderOnly` rows gone.
- [ ] `pnpm run typecheck`, `pnpm run boundary` and `pnpm run i18n` report no errors.
