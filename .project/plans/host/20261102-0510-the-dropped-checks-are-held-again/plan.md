---
title: The dropped checks are held again
domain: host
status: planned
priority: medium
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd this plan was checked at
  - "[code://.project/working/maycxc-union-20261101-review.md](../../../working/maycxc-union-20261101-review.md) - Softov's review: host-turn no longer checks the session-level error, host-deltas no longer lands a delta while the snapshot read waits"
  - "[code://packages/sdk/test/host-turn.test.ts#L429-L478](../../../../packages/sdk/test/host-turn.test.ts#L429-L478) - the failed turn case, which reads the chat channel alone"
  - "[code://packages/sdk/test/host-deltas.test.ts#L145-L203](../../../../packages/sdk/test/host-deltas.test.ts#L145-L203) - the awaited snapshot case, whose delta lands after the read resumed"
  - "[code://packages/sdk/src/host/catalogue.ts#L1458-L1480](../../../../packages/sdk/src/host/catalogue.ts#L1458-L1480) - `chatMoved`, which keeps the session's row for a chat in step with it"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L394-L455](../../../../packages/sdk/src/host/sessionmethods.ts#L394-L455) - `subscribe`, which reads the snapshot and then replays what came after `fromSeq`"
---

## Goal

The two checks c8a586a1 moved are held again in the form the held state can express.
A failed turn leaves neither the session's row for the chat nor its list row in error once the next turn starts.
A delta that lands while a snapshot read waits reaches the late client once.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git show c8a586a1 -- packages/sdk/test/host-turn.test.ts packages/sdk/test/host-deltas.test.ts` - the two changes.
- `rg -n "error" types/channels-session/state.ts` in AHP at 5f16d81b - a session declares `creationError` alone, so the session-level `error` is gone.
- `rg -n "status" dist/types/channels-session/reducer.js` in the installed protocol - no session action moves a session's activity bits.
- `rg -n "subagents" packages/sdk/src/host/snapshots.ts packages/sdk/src/host/history.ts` - the workers read is not shared between calls in flight.

### Runtime path

```
failed turn t1 -> chat Error; session row for the chat Error; list row Error (the default chat's bits)
turn t2 starts -> chat, row and list row InProgress; t2 ends -> all three Idle
late subscribe parks in the record's workers read -> a turn resumes the session, the chat speaks
  -> the read answers: the snapshot holds what was said, and fromSeq sits after it
```

### Gaps

- host-turn reads the chat channel alone, so a session row left in error after the next turn passes.
- host-deltas emits after the read resumed, so nothing lands while it waits.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A session shows a chat's status in its row for the chat and in its list row, whose bits are the default chat's | types/channels-session/state.ts, "Aggregation across chats" https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/state.ts#L465-L480 | 01 |
| A session carries no error field of its own, so the case pins it absent | the same file declares `creationError` alone | 01 |
| A delta said while the read waits is in the snapshot once, and nothing at or below `fromSeq` is replayed | sessionmethods.ts `subscribe`: "flushed first, the delta is at or below the number the snapshot is taken at" | 02 |

## Proposed architecture

- **Data flow** - host-turn reads the session channel and `listSessions` beside the chat at each of the three points.
- **State flow** - host-deltas parks a subscribe in the first workers read, and a turn resumes the session through the second.
- **Layer responsibilities** - the sdk's tests alone; the host holds both already.
- **Source-of-truth files** - [`code://packages/sdk/test/host-turn.test.ts`](../../../../packages/sdk/test/host-turn.test.ts), [`code://packages/sdk/test/host-deltas.test.ts`](../../../../packages/sdk/test/host-deltas.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a failed turn leaves the session out of error](task-01-a-failed-turn-leaves-the-session-out-of-error.md) | todo | - |
| [02 - a delta lands while the snapshot read waits](task-02-a-delta-lands-while-the-snapshot-read-waits.md) | todo | - |

## Risks and tradeoffs

- The deltas case counts the backend's workers reads: the first parks, and later ones answer at once.
  A host that read the workers once per session would park the resume too, and the case would say so.

## Resume state

- **Done so far:** nothing built.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a session's own `status` keeps its activity bits; the protocol's session reducer has no action to move them.

## Final verification checklist

- [ ] The session's row and list row go Error, InProgress, Idle with the chat, and the session carries no error.
- [ ] A host whose row for a failed chat stops following it fails the case, and main's case passes it.
- [ ] A delta said while the read waits is in the snapshot and is not replayed.
- [ ] A subscribe that reads `fromSeq` before the wait fails the case, and main's case passes it.
