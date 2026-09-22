---
title: A transcript that answered nothing is read again
domain: host
status: built
priority: high
created: 2026-09-22
revalidated: 2026-09-22
requires: []
changes: []
creates: []
decisions:
  - decisions/a-failed-transcript-read-is-not-an-empty-session.md
refs:
  - code://packages/agent-claude/src/transcript.ts#L38-L51 - `turnsOf`'s catch, which answers `[]` for any failure
  - code://packages/sdk/src/host.ts#L3772 - `history`, the cache that outlives the failure
  - code://packages/sdk/src/host.ts#L3790-L3825 - `past`, which is where an empty answer becomes permanent
  - code://packages/sdk/src/host.ts#L3899 - the annotations probe, which must keep seeing a known session
  - code://packages/sdk/src/host.ts#L6366-L6428 - the seeds, which must keep seeing a known session
  - code://test/host.test.ts#L32-L85 - the SDK mock and its `sdk.reads` counter
  - code://test/host.test.ts#L2324-L2380 - the transcript describe the new cases join
  - code://test/host.test.ts#L6140-L6161 - the one-read-per-open case that must stay green
---

## Goal

A session whose transcript could not be read, or was read while it had no turns yet, is read again the next time somebody opens it, instead of answering empty for as long as the host process runs.
A read that failed outright is tried once more before it is drawn as an empty session, and a transcript that has turns is still read only once.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "transcript" packages/sdk/src/host.ts` - the port is called from one place, `past`, and the five call sites of `past` all use a non-`undefined` answer to mean "this session is known".
- `rg -n "history\\b" packages/sdk/src/host.ts` - `history` is written only in `past` and read only at the top of it, so the cache has exactly one entry point.
- `rg -n "sdk.reads" test/host.test.ts` - the mock counts reads, and one case already asserts a single read for three concurrent subscriptions.
- Checked by hand in the environment that reported it: the four newest files under the Claude projects directory read as `user,assistant` through `getSessionMessages`, so the data and the reader are both fine and the failure was transient.

### Runtime path

```
a client subscribes to a catalogue session's chat
  -> snapshotOf -> past(id)
  -> listing() says the row exists; owner.transcript(id) -> turnsOf(id, dir)
  -> getSessionMessages -> the Claude JSONL
  -> [] on a parse it cannot make  ->  history.set(id, [])  ->  every later subscribe gets []
```

### Gaps

- An empty answer is cached, so a failure that lasted one call lasts the process: `code://packages/sdk/src/host.ts#L3817-L3819`.
- A failure and a session with no turns are the same value on the port, so nothing downstream can tell them apart or retry one of them: `code://packages/agent-claude/src/transcript.ts#L46-L51`.
- `Not found: any log or event for a transcript that would not parse - searched "transcript" through the host's `log` calls and the event names; the failure is silent.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A transcript read that failed is not kept as an empty session](../../../decisions/a-failed-transcript-read-is-not-an-empty-session.md) | The user, 2026-09-22: reported the symptom and answered "do the plan" to the fix direction. |

| What | Source | Task |
| --- | --- | --- |
| A read with no turns is not stored in `history` | decision 1 | 01 |
| A read with turns is still stored, so the one-read-per-open case is unchanged | decision 1 | 01 |
| A failed read is attempted once more before it answers empty | decision 1 | 02 |
| The empty answer still means "this session is known" at the probe and the seeds | (defaulted: the four call sites treat `undefined` as no such session) | 01 |

## Proposed architecture

- **Data flow** - unchanged: `past` still asks `listing()` and then `owner.transcript(id)`, and the answer's shape does not move.
- **Event flow** - unchanged; nothing gains an event.
- **State flow** - `history` keeps only a transcript with turns, so an empty answer is re-derived on the next open rather than remembered.
- **Layer responsibilities** - packages/sdk: the cache rule in `past` · packages/agent-claude: the retry in `turnsOf` · test/: the two cases and the mock's throw switch.
- **Source-of-truth files** - `code://packages/sdk/src/host.ts`, `code://packages/agent-claude/src/transcript.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An empty read is not remembered](task-01-an-empty-read-is-not-remembered.md) | done | - |
| [02 - A failed read is tried once more](task-02-a-failed-read-is-tried-once-more.md) | done | 01 |

## Risks and tradeoffs

- A session that is genuinely empty is read on every open rather than once; the file is small and the read is still shared by concurrent callers, so this is the cheaper half of the trade.
- The retry doubles the SDK calls only on the failure path, so the read count a passing test asserts does not move.
- The failure is still silent: this plan stops it being permanent, it does not make it visible. If a blank session is seen again after this, the next step is a log line for a catalogue row that answered no turns, which needs the port to carry a reporter and is deliberately not in this plan.

## Resume state

- **Done so far:** both tasks, 2026-09-22. `past` keeps a read only when it has turns, and `turnsOf` reads once more when the first attempt throws. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built. The by-hand item below is the one thing not run here.
- **Open questions:**
  1. Should the retry wait a moment rather than run immediately? - answered: no, an immediate second read is free and a timer would be a wall-clock wait in a suite that is trying to remove them. If a blank session is seen again, the answer is the log line the risks section names, not a longer wait.
- **Watch out for:** the two behaviours are independent but land together: without task 01 a retried read still gets cached empty once it fails twice, and without task 02 a single transient failure is drawn empty until the next open.

## Final verification checklist

- [x] `pnpm test` green: 63 files, 851 tests, the two new cases included. Both new cases were checked against the code with the fixes reverted, and both fail there.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [ ] By hand: a session opened with an empty answer shows its turns on the next subscribe, without restarting the window or the daemon. Not run here; the failure was not reproducible in this sandbox.
- [x] `plans/index.md` and [00-host.md](../00-host.md) updated.
