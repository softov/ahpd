---
title: A queued message taken up while idle is held to its turn
domain: host
status: built
priority: medium
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd this plan was checked at
  - "git://f48055f0 - the last commit that holds `.project/working/maycxc-union-20261101-review.md`; Softov's review: `ALLOWED` exempts whole keys for 045-047 and 052"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L427-L445](../../../../packages/sdk/test/ahp-test-cases.test.ts#L427-L445) - `CONSUMED`, and the four entries that exempt `activeTurn`, `modifiedAt`, `queuedMessages` and `status`"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L571-L586](../../../../packages/sdk/test/ahp-test-cases.test.ts#L571-L586) - `Driven`: what a watching client holds, and the reducer's goal"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L612-L673](../../../../packages/sdk/test/ahp-test-cases.test.ts#L612-L673) - the driver, which builds the goal from the accepted actions alone"
  - "[code://packages/agent-claude/src/session/turns.ts#L325-L335](../../../../packages/agent-claude/src/session/turns.ts#L325-L335) - the turn the driver's backend says for a queued message, naming it in `queuedMessageId`"
---

## Goal

A case whose queued message the host takes up while the chat is idle holds the host to that turn.
The goal carries the two actions the protocol has the host say, and only the host's activity stays exempt.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "CONSUMED" packages/sdk/test/ahp-test-cases.test.ts` - one constant, four entries: 045, 046, 047 and 052.
- `rg -n "queuedMessageId" packages/agent-claude/src/session/turns.ts` - the turn a queued message becomes names it.
- `rg -n "Queued Messages" docs/specification/chat-channel.md` in AHP at 5f16d81b - the two-step sequence and the idle rule.

### Runtime path

```
client chat/pendingMessageSet {kind: queued, id: pm-1}, chat idle
  -> host: pendingMessageSet (the echo), turnStarted {queuedMessageId: pm-1}, activityChanged
  -> watching client holds an active turn, an empty queue, status and modifiedAt of the turn
goal = reducer(start, [pendingMessageSet]) -> pm-1 queued, no turn
  -> differs on activeTurn, modifiedAt, queuedMessages, status, activity: all five exempt
```

### Gaps

- The exemption covers any value on five keys, so a turn with the wrong message or a queue left full passes.
- `Not found: a mutation of the queued turn that fails these cases - searched the oracle and the cases near it.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| A queued message added while idle is consumed in two steps: its removal, then the turn naming it | chat-channel.md, Queued Messages: "When a queued message is added while the chat is idle (no active turn), the server SHOULD immediately consume it using the same two-step sequence." https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L365-L372 | 01 |
| The turn carries the queued message's `message` and names it in `queuedMessageId` | the same section, step 2 | 01 |
| The turn's id and start are the host's | the protocol names no id for a turn a host starts from its queue | 01 |
| The host's activity stays exempt | THINKING, chat/activityChanged: "Dispatched by the server to indicate what the chat is currently doing" | 01 |

## Proposed architecture

- **Data flow** - the driver walks the accepted actions through the reducer.
  After a queued message that finds the chat idle, it adds the removal and the turn that names it.
- **State flow** - the turn's id and start come from the turn the host said with that `queuedMessageId`.
  A host that said no such turn leaves them unset, and the case fails.
- **Layer responsibilities** - the sdk's protocol case driver alone.
- **Source-of-truth files** - [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the goal carries a queued message taken up while idle](task-01-the-goal-carries-a-queued-message-taken-up-while-idle.md) | done | - |

## Risks and tradeoffs

- The rule says the host consumes the message it was given, so the goal takes up the added message.
  In 046 and 047 the case's `initial` already waits in the queue while idle, and the host leaves it waiting.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the goal is the case's `expected` only when the host refused nothing and said nothing of its own.

## Final verification checklist

- [x] 045, 046, 047 and 052 exempt `activity` alone, and pass.
- [x] A host whose queued turn carries another message fails the four cases, and passed them before.
