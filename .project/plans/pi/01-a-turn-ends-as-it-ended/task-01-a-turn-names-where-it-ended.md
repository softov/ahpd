---
title: A turn names where it ended
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L28-L62](../../../../packages/agent-pi/src/backend.ts#L28-L62) - `PiBackend`, which gains `leaf()`"
  - "[code://packages/agent-pi/src/session.ts#L151-L179](../../../../packages/agent-pi/src/session.ts#L151-L179) - `finish`, where a turn ends"
  - "[code://packages/agent-pi/src/session.ts#L268-L269](../../../../packages/agent-pi/src/session.ts#L268-L269) - the rewind on open, whose answer is dropped"
  - "[code://packages/agent-claude/src/session.ts#L2022-L2031](../../../../packages/agent-claude/src/session.ts#L2022-L2031) - the `ends` map to copy"
  - "[code://test/agent-cofold-fork.test.ts#L262-L275](../../../../test/agent-cofold-fork.test.ts#L262-L275) - a truncation through the host"
---

## Objective

`piSession` answers `endPoint(turnId)` for every turn this process watched end, so the host accepts `chat/truncated` and the existing `rewindAt` path runs.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:28-62` - `PiBackend` gains `leaf(): string | undefined`; `wrap` answers it from `session.sessionManager.getLeafId()`, `null` as `undefined`.
- `UPDATE: packages/agent-pi/src/session.ts` - an `ends` map by turn id, filled on `agent_settled` before `finish`; `endPoint` on the returned `Session`; the answer of `backend.rewind` checked.
- `UPDATE: test/agent-pi.test.ts` - `fakePi` gains `leaf()`; new cases below.

## Steps

1. Add `leaf()` to `PiBackend` and to `wrap`.
2. In `session.ts`, keep `const ends = new Map<string, string>()`, commented the way the sibling's is.
3. In `heard`, on `agent_settled`, read `live?.leaf()` and set it for the active turn's id before calling `finish`, so a truncation asked for the moment the turn appears has a point.
4. Return `endPoint: (turnId) => ends.get(turnId)` beside `agentId`.
5. In `opened`, when `backend.rewind(start.rewindAt)` answers `false`, fail the first turn with `finish('error', ...)` saying the rewind was refused by pi, rather than running the turn on the untruncated leaf.
6. Leave `README.md:49` as it is; it is true once this lands.

## Validation

- `test/agent-pi.test.ts`: after a turn settles, `endPoint('t1')` is the fake's leaf; a turn still running and a seeded turn answer `undefined`.
- A host-level case, shaped like `test/agent-cofold-fork.test.ts:262-275`: a pi session with the fake backend, one turn, `chat/truncated` at it is accepted, and the restarted session asks the backend to rewind to that leaf.
- A rewind the fake answers `false` fails the first turn with a `chat/error`.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume
