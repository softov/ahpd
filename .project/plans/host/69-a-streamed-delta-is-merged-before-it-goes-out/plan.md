---
title: Streamed deltas are merged for a short window in the host's dispatch, for every backend
domain: host
status: planned
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L555-L577](../../../../packages/sdk/src/host.ts#L555-L577) - `dispatch`: one `serverSeq`, one replay slot and one broadcast per action"
  - "[code://packages/sdk/src/host.ts#L560-L571](../../../../packages/sdk/src/host.ts#L560-L571) - a `chat/responsePart` carries the live part later deltas write into"
  - "[code://packages/sdk/src/host.ts#L336](../../../../packages/sdk/src/host.ts#L336) - `REPLAY = 1000`, a few seconds of streaming at one delta per token"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L112](../../../../packages/sdk/src/host/sessionmethods.ts#L112) - `subscribe`, which takes a snapshot"
  - "[code://packages/sdk/src/host/handshake.ts#L187](../../../../packages/sdk/src/host/handshake.ts#L187) - `initialize` subscribing, a snapshot"
  - "[code://packages/sdk/src/host/handshake.ts#L361](../../../../packages/sdk/src/host/handshake.ts#L361) - `reconnect` subscribing, a snapshot"
  - "[code://packages/sdk/src/types/host.ts#L68](../../../../packages/sdk/src/types/host.ts#L68) - `HostOptions`"
  - "[code://packages/sdk/src/resources.ts#L469](../../../../packages/sdk/src/resources.ts#L469) - `COALESCE`, the one timer-merge in the sdk today"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ChatDeltaAction` and `ChatReasoningAction` (`turnId`, `partId`, `content`), `ChatToolCallDeltaAction` (`content` appends, `invocationMessage` replaces)
---

## Goal

A streaming turn sends one merged `chat/delta`, `chat/reasoning` or `chat/toolCallDelta` per part per window instead of one per token, for acp, claude, pi, cofold and subagent chats alike, with no change in what a client ends up with.
The window is `deltaWindowMs`, 75 by default; 0 sends every delta as today.

## Reconnaissance

### Searches performed

- `rg -i "coalesc|debounce|throttle" packages/sdk/src` - only file watching (`resources.ts`, `changes.ts`) and session-file saves; nothing on actions.
- The session file holds per-session metadata, not the transcript; each backend keeps its own transcript, so nothing on disk holds the deltas.

### Runtime path

```
backend emit -> spawn.ts emit -> dispatch(channel, action)
  delta: merge into pending[channel, kind, turnId, partId|toolCallId]; timer at the window; flush at the cap
  anything else: flush every pending entry, then dispatch as today
  subscribe / initialize / reconnect: flush every pending entry before the snapshot
```

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |

| What | Source | Task |
| --- | --- | --- |
| The merge is in `dispatch`, so every backend gets it without code of its own | Softov, 2026-10-06 | 01 |
| `deltaWindowMs` in `HostOptions` and the daemon config, default 75; 0 is off | Softov, 2026-10-06, chose "Write it, 75 ms default on" | 01, 02 |
| A pending entry flushes when its merged `content` passes 16 KiB | Softov, 2026-10-06, same answer | 01 |
| Any action that is not a mergeable delta flushes every pending entry, on every channel, before it is dispatched | keeps order within a chat and across a subagent chat and its parent's tool call, with no per-chat bookkeeping | 01 |
| A snapshot (`subscribe`, `initialize`, `reconnect`) flushes first | a snapshot built from live parts already holds pending text; the delta after it would write it twice | 01 |
| `content` appends; `toolCallDelta`'s `invocationMessage` is the last one; a different `_meta` or `origin` flushes before merging | the protocol's semantics; `_meta` can attribute a delta to a subagent | 01 |
| Shutdown and a session's disposal flush | nothing pending is lost | 01 |

## Proposed architecture

- **Data flow** - `sdk/src/host/deltas.ts` (new): `merger({ windowMs, capBytes, send })` with `push(channel, action, origin)` returning whether it held the action, and `flush()`; `dispatch` calls it first.
- **State flow** - a held delta has no `serverSeq` until it is flushed; the merged action is one envelope.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - dispatch merges deltas within the window](task-01-dispatch-merges-deltas.md) | todo | - |
| [02 - The daemon config sets the window](task-02-the-daemon-config-sets-the-window.md) | todo | 01 |

## Risks and tradeoffs

- Text arrives up to 75 ms later than today; a typing effect in a client gets coarser.
- A client that applies deltas by counting envelopes rather than by content would see fewer; the protocol does not promise a count.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-dispatch-merges-deltas.md](task-01-dispatch-merges-deltas.md).
- **Open questions:** none.
- **Watch out for:** `ctx.telemetered`, `ctx.asking` and `ctx.links.observe` run on the merged action, once.

## Final verification checklist

- [ ] A host test streams 500 one-character deltas and a client receives the same final text in far fewer envelopes.
- [ ] A `chat/turnComplete` emitted right after a delta reaches the client after that delta's text.
- [ ] A client that subscribes mid-stream ends with the text once, not twice.
- [ ] `deltaWindowMs: 0` sends every delta as before.
- [ ] `pnpm` gates green.
- [ ] `plans/index.md` updated.
