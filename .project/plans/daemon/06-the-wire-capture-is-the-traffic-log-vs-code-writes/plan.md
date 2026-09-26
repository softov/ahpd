---
title: The wire capture is the traffic log VS Code writes
domain: daemon
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions:
  - decisions/the-traffic-log-is-the-wire-capture-in-vs-codes-shape.md
refs:
  - "[code://packages/server/src/commands/run.ts#L344-L360](../../../../packages/server/src/commands/run.ts#L344-L360) - the `--wire` tap and the line it writes"
  - "[code://packages/server/src/commands/run.ts#L275-L279](../../../../packages/server/src/commands/run.ts#L275-L279) - `diagnostics.logs`, which hands the capture to a client that collects debug logs"
  - "[code://packages/server/src/config.ts#L95-L96](../../../../packages/server/src/config.ts#L95-L96) - the `wire` key"
  - "[code://packages/sdk/src/types/listen.ts#L26-L35](../../../../packages/sdk/src/types/listen.ts#L26-L35) - `Tap`: `from`, `text`, `peer`"
  - "[code://tools/wire.mjs#L221-L232](../../../../tools/wire.mjs#L221-L232) - `framesIn`, which `pnpm wire` reads a capture through"
  - "[code://test/wire.test.ts](../../../../test/wire.test.ts) - the tests over `--wire` and its lines"
  - "[code://docs/DAEMON.md#L157](../../../../docs/DAEMON.md#L157) - the `--wire` row"
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/ahpJsonlLogger.ts - the line shape, the field names, 75 MiB and five files, 1 MiB lines and 16 KiB strings
---

## Goal

A capture made with `--wire` is the traffic log VS Code's agent host writes, so the tools that read one read the other.
It is bounded in size and readable only by its owner.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "wire" packages/server/src` - one tap in `run.ts`, one key in `config.ts`, one flag in `commands/options.ts`, and the capture listed in `diagnostics.logs`.
- `rg -n "_ahpLog|dir:" /github/externals/vscode/src/vs/platform/agentHost/common/ahpJsonlLogger.ts` - the meta VS Code writes beside each message.

### Runtime path

```
listen(tap) -> a frame crosses the socket -> tap(from, text, peer)
  -> [changes] { ...message, _ahpLog: { ts, dir, connectionId, transport, byteLength } } appended to the capture
  -> [new] past 75 MiB the file rolls to <file>.1, and five are kept
pnpm wire -- <file> -> framesIn -> the checker, which [changes] ignores _ahpLog
```

### Gaps

- The line is `{ at, from, peer, frame }`, which nothing but ahpd's own tool reads.
- The capture grows without a bound.
- The capture is created with the process umask, and it holds every token `authenticate` was sent.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The traffic log is the daemon's --wire capture, written in the shape VS Code writes](../../../decisions/the-traffic-log-is-the-wire-capture-in-vs-codes-shape.md) | Softov, 2026-09-26, accepted |

| What | Source | Task |
| --- | --- | --- |
| `dir` is `c2s` for a frame from the client and `s2c` for one from the host | VS Code's `AhpLogDirection` | 01 |
| `connectionId` is the tap's `peer`, as a string; `transport` is `websocket` or `stdio` | VS Code's `IAhpLogMeta` | 01 |
| A frame that is not JSON is kept as `{ "_raw": text, "_ahpLog": ... }` | the tap keeps such a frame today, and a line must stay JSON | 01 |
| 75 MiB per file, five files, a line over 1 MiB re-written with strings over 16 KiB elided and `truncated: true` | VS Code's `AhpJsonlLogger` defaults | 02 |
| `diagnostics.logs` lists every file of the capture, rotated ones included | a collected capture that stops at the last roll is missing its start | 02 |
| The capture is created `0600` | it holds the tokens `authenticate` carries | 03 |
| Nothing is redacted, as VS Code redacts nothing | VS Code's `AhpJsonlLogger` | - |
| Lines are still appended synchronously | the tap's comment: a capture that lags the crash it explains is no capture | 01 |

## Proposed architecture

- **Data flow** - the tap builds the line from the frame and the meta, and a small writer in `packages/server` appends it, rolls the file and caps the line.
- **Event flow** - none new.
- **State flow** - the writer holds the current size and file index for the life of the daemon.
- **Layer responsibilities** - `packages/server`: the tap and the writer · `tools/wire.mjs`: reading both shapes · `docs/DAEMON.md`: the flag.
- **Source-of-truth files** - [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A capture line is VS Code's line](task-01-a-capture-line-is-vs-codes-line.md) | todo | - |
| [02 - The capture rolls at 75 MiB, keeps five files, and caps a line](task-02-the-capture-rolls-and-caps.md) | todo | 01 |
| [03 - The capture is readable only by its owner](task-03-the-capture-is-owner-only.md) | todo | - |
| [04 - Docs](task-04-docs.md) | todo | 01, 02, 03 |

## Risks and tradeoffs

- An old capture has the old line - `framesIn` already reads `frame` when it is there, so `pnpm wire` reads both, and a test keeps it so.
- A synchronous append is slower than VS Code's batched write - the capture is a debugging switch, and a whole file at a crash is worth more.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-capture-line-is-vs-codes-line.md](task-01-a-capture-line-is-vs-codes-line.md); task 03 does not depend on it.
- **Open questions:** none.
- **Watch out for:** `_ahpLog` is not a protocol field, so the checker in `tools/wire.mjs` must skip it before it closes the object, or every line is a defect.

## Final verification checklist

- [ ] A capture from `ahpd --wire <file>` has one message per line with `_ahpLog` carrying `ts`, `dir`, `connectionId`, `transport` and `byteLength`.
- [ ] `pnpm wire -- <file>` passes on a new capture and on `test/fixtures/wire.jsonl`.
- [ ] A capture past the cap rolls, and a sixth file is never kept.
- [ ] The capture file is `0600`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/DAEMON.md`, `plans/index.md` updated.
