---
title: Every client action is answered
domain: host
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
changes: []
creates: []
refs:
  - git://ea86d32c - the commit of ahpd this plan was checked at
  - git://2f3ff9eb - the refusal of a confirmation or an answer nothing waits on, the pattern for task 01
  - "[code://packages/sdk/src/host/chatactions.ts#L1393-L1397](../../../../packages/sdk/src/host/chatactions.ts#L1393-L1397) - `chat/pendingMessageRemoved` calls `unqueue` and says nothing for an unknown id"
  - "[code://packages/sdk/src/host/chatactions.ts#L1403-L1415](../../../../packages/sdk/src/host/chatactions.ts#L1403-L1415) - `chat/toolCallConfirmed` refused through `no`, the refusal to copy"
  - "[code://packages/sdk/src/host/chatactions.ts#L1108-L1113](../../../../packages/sdk/src/host/chatactions.ts#L1108-L1113) - an idle `chat/turnCancelled` read from `chatState()` and echoed to its sender, the echo to copy"
  - "[code://packages/sdk/src/host/sleep.ts#L104-L108](../../../../packages/sdk/src/host/sleep.ts#L104-L108) - the host reads `queuedMessages` from a chat's state"
  - "[code://packages/sdk/src/host/chatactions.ts#L32-L41](../../../../packages/sdk/src/host/chatactions.ts#L32-L41) - `sessionFlag` returns `false` when the flag did not move"
  - "[code://packages/sdk/src/host/chatactions.ts#L91-L101](../../../../packages/sdk/src/host/chatactions.ts#L91-L101) - `chatFlag` returns `false` when the flag did not move"
  - "[code://packages/sdk/src/host/chatactions.ts#L219-L246](../../../../packages/sdk/src/host/chatactions.ts#L219-L246) - the chat flag caller, which returns with no answer when the bit did not move"
  - "[code://packages/sdk/src/host/actions.ts#L739-L750](../../../../packages/sdk/src/host/actions.ts#L739-L750) - the session flag caller, which ignores the result of `sessionFlag`"
  - "[code://packages/sdk/src/host/actions.ts#L708-L724](../../../../packages/sdk/src/host/actions.ts#L708-L724) - an unchanged `activeClient` echoed to its sender only"
  - "[code://packages/sdk/test/presence.test.ts#L136](../../../../packages/sdk/test/presence.test.ts#L136) - the test of an echo to the sender and to nobody else"
  - "[code://packages/sdk/test/host-snapshots.test.ts#L692-L709](../../../../packages/sdk/test/host-snapshots.test.ts#L692-L709) - the test that a chat marked read twice says nothing"
  - "[code://packages/sdk/test/host-input.test.ts#L469-L480](../../../../packages/sdk/test/host-input.test.ts#L469-L480) - the test of a queued message taken back"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L481](../../../../packages/sdk/test/ahp-test-cases.test.ts#L481) - `HOST_REFUSED`, the protocol cases the host refuses, with the reason"
  - "[code://docs/sdk/AHP.md#L727-L755](../../../../docs/sdk/AHP.md#L727-L755) - \"An action that changes nothing is not a change\""
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/docs/specification/chat-channel.md - a removal with no matching id and kind SHOULD be rejected, and an absent kind means `queued`
  - git://817615bc:.project/briefs/a-client-action-always-gets-an-answer.md - the brief this plan covers
  - file:///github/ahpc/.project/plans/cli/20261030-0802-a-dispatch-waits-for-the-hosts-answer/plan.md - the ahpc plan that waits for this answer
---

## Goal

A client that removes a pending message gets an answer, and so does a client that sets a flag to the value it already has.
A removal of a message the chat does not hold is refused with a reason.
A flag set again is echoed to its sender only, so the sender drops its pending action and no other client hears it.
ahpc then exits with the host's answer, not after a 10-second wait.
The brief is `git://817615bc:.project/briefs/a-client-action-always-gets-an-answer.md`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "unqueue" packages examples` - eight implementers, and `Session.unqueue` returns `void`.
- `rg -n "chatState\(\)" packages/sdk/src/host` - `sleep.ts`, `tooling.ts`, `wakes.ts` and the cancel in `chatactions.ts` read a chat's state.
- `rg -n "echoTo" packages/sdk/src` - `chatactions.ts` and `actions.ts` both have it from the context.
- `rg -n "pendingMessageRemoved" packages/sdk/test` - `host-input.test.ts`, `host-senders.test.ts` and `session-events.test.ts` remove a message that is queued.
- `ls packages/sdk/test/fixtures/ahp-test-cases/reducers | rg "remove"` - cases 043, 044, 050 and 051 remove a message that is not there.

### Runtime path

```
dispatchAction chat/pendingMessageRemoved -> chatAction -> session.unqueue -> the backend emits the removal, or nothing
dispatchAction session/isReadChanged -> sessionFlag -> dispatch to every client, or return false and say nothing
dispatchAction chat/isReadChanged -> chatFlag -> dispatch to every client, or return and say nothing
```

### Gaps

- A removal of an id and kind the chat does not hold gets no answer, and the client holds it as pending.
- A session flag or a chat flag set to its current value gets no answer.
- An archive of a session's default chat goes through `sessionFlag`, and its result is ignored there too.
- `AHP.md` says that the sender of an action that changes nothing is answered, and names only `activeClient` and the cancel.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host reads the chat's `queuedMessages` for the id and the kind before it calls `unqueue` | Softov, 2026-10-31, chose "Host reads the chat" | 01 |
| An absent kind on the action or on an entry means `queued` | the protocol's chat-channel.md, *Shared List Mutations and Ordering* | 01 |
| `Session.unqueue` and its eight implementers do not change | follows from the row above | 01 |
| A refused removal is not passed to `unqueue`, and does not call `forgetSender` | (defaulted: a refused action changes nothing) | 01 |
| The reason names the id and the kind | (defaulted: the refusals of 2f3ff9eb name the id) | 01 |
| A session flag or a chat flag that did not move is echoed to its sender only, with `echoTo` | the brief; [code://packages/sdk/src/host/actions.ts#L723](../../../../packages/sdk/src/host/actions.ts#L723) | 02 |
| The echo keeps the current `serverSeq`, and the other clients hear nothing | plan 97, Softov, 2026-10-16 | 02 |
| An archive of a default chat that did not move is echoed the same way | (defaulted: it is a chat flag that the session carries) | 02 |
| A removal after the agent already has the message is not in this plan | the brief, *Open points*: not checked | - |

## Proposed architecture

- **Data flow** - the host reads `session.chatState().queuedMessages` -> no match refuses through `no` -> a match calls `unqueue` as today.
- **Event flow** - a flag that did not move -> `echoTo(connection.peer, channel, action, origin)` -> only the sender hears it.
- **State flow** - nothing new is kept; both answers leave `serverSeq` where it is.
- **Layer responsibilities** - sdk: `chatactions.ts` and `actions.ts` answer. docs: `AHP.md` says which actions are answered how.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An unknown removal is refused](task-01-an-unknown-removal-is-refused.md) | done | - |
| [02 - A flag set again is echoed](task-02-a-flag-set-again-is-echoed.md) | done | - |

## Risks and tradeoffs

- A backend whose `chatState()` lags its own queue would have a valid removal refused. The tests remove a queued message on the claude backend and on the echo backend, and both must still pass.
- The protocol cases that remove a message that is not there become refusals. They go into `HOST_REFUSED` with the reason, and the counts in that test move.
- A client that relied on silence for a flag now gets an echo to itself. The echo carries no state change, so its reducer applies the value it already holds.

## Resume state

- **Done so far:** both tasks built, see [implemented.md](implemented.md).
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** both tasks edit `chatactions.ts` and `AHP.md`, so build them in one branch, one after the other.

## Final verification checklist

- [x] A removal of an id the chat does not hold is refused to its sender, with the id and the kind in the reason.
- [x] A removal whose kind does not match the entry is refused.
- [x] A removal of a queued message still removes it, and its turn never starts.
- [x] A session flag set again is echoed to its sender, and no other client hears it.
- [x] A chat flag set again is echoed to its sender, and no other client hears it.
- [x] `pnpm typecheck` and the sdk suite pass, and Windows CI is green.
