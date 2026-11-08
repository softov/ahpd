---
title: A transcript read back puts a steering message in the turn it steered
status: done
depends: [task-02-a-late-answer-opens-its-own-turn.md]
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/host/localturns.ts](../../../../packages/sdk/src/host/localturns.ts) - `turnRecordedAs`, the record, and `transcriptOf`, the read that applies it"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - the backend's `emit` and `onTurnRecorded`, where the record is written"
  - "[code://packages/agent-claude/src/transcript.ts#L286-L574](../../../../packages/agent-claude/src/transcript.ts#L286-L574) - `buildTurns`, which builds the turns of a transcript"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts) - `ends`, the point a cut takes for each turn a session holds"
---

## Objective

A client sees the same turns before and after a restart.
A steering message the CLI answered late reads back inside the turn it steered, as it was answered live.
A message the CLI took in at a tool call reads back inside its turn.
The CLI's interrupt marker reads back as the end of a cancelled turn, not as a turn.
A cut at a turn read back with another inside it keeps that other one.

## Files

- `UPDATE: packages/sdk/src/host/localturns.ts` - the record of the turns a chat began, the read that applies it, and the record through a truncation, a fork, a removal and a move.
- `UPDATE: packages/sdk/src/host/spawn.ts` - a turn's start and `onTurnRecorded` write the record.
- `UPDATE: packages/sdk/test/localturns.test.ts` - the record and the read, alone.
- `UPDATE: packages/sdk/test/host-local-turns.test.ts` - a host started again on the same store, with the echo backend and with the Claude backend fed real captures.
- `UPDATE: packages/agent-claude/src/transcript.ts` - a queued command and the interrupt marker.
- `UPDATE: packages/agent-claude/src/session/query.ts` - a turn read back with others inside it ends where the last of them ends.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - the read-back cases, beside the live cases of the same captures.
- `UPDATE: packages/agent-claude/test/agent-claude-read-ends.test.ts` - the end of a turn read back with another inside it.
- `UPDATE: packages/agent-claude/test/fixtures/claude-late-steer.jsonl` - the late capture again, from the session the transcript fixtures read.
- `UPDATE: packages/agent-claude/test/fixtures/claude-folded-steer.jsonl` - the folded capture again, from that session.
- `UPDATE: packages/agent-claude/test/fixtures/claude-cancelled-steer.jsonl` - a stop with a steering message queued, its answer, then a new prompt's.
- `CREATE: packages/agent-claude/test/fixtures/claude-steered-transcript.jsonl` - what the SDK's reader returns for the session of the late and the folded captures.
- `CREATE: packages/agent-claude/test/fixtures/claude-cancelled-steer-transcript.jsonl` - what the reader returns for the session of the stop capture.
- `CREATE: packages/agent-claude/test/fixtures/claude-folded-stop-transcript.jsonl` - what the reader returns for a stop with a steering message queued, then a stop after one was folded in.
- `CREATE: packages/agent-claude/test/fixtures/claude-tool-stop-transcript.jsonl` - what the reader returns for a stop while a tool call ran, with a steering message queued.
- `UPDATE: docs/sdk/AGENT.md`, `docs/sdk/CHATS.md` - the record, and a steering message read back after a restart.
- `UPDATE: .project/specs/sessions-and-chats.md`, `.project/specs/agent-backends.md` - the record, and the read-back.

## Steps

1. Record a turn's own id as it starts, and what `onTurnRecorded` says.
   Each transcript id is one file in the chat's folder.
2. After the backend's read, find each turn the record holds no beginning for.
   Read it back inside the turn before it.
   Do the same with a turn recorded as the same turn as the one before.
3. Leave the turns before the first one the record holds, and every local turn, as they are.
4. Join two turns as one: the first one's id and message, both answers, the later one's end, both usages added.
5. Put a local turn anchored to a joined turn after the turn it joined.
6. Forget, copy and move the record as the chat's local turns go.
7. In `buildTurns`, fold a message marked `isQueuedCommand` into the open turn.
   Read the interrupt marker as the end of the open turn, which is then cancelled.
8. End a seeded turn where the read's last turn before the next seeded one ends.
   Stop at the rewind point.
9. Add the cases, the fixtures, the docs and the specs.

## Validation

- `host-local-turns.test.ts` runs the late and the folded capture through a host.
  Another host on the same store reads the chat back as the client saw it live.
  With the record's read switched off, it reads back three turns where the client saw two.
- `agent-claude-late-steer.test.ts` reads each captured transcript back as the backend gives it.
- `localturns.test.ts`, `host-local-turns.test.ts`, `agent-claude-late-steer.test.ts`, `agent-claude-read-ends.test.ts` and `agent-claude-transcript.test.ts` pass at one worker.

## Resume

Done 2026-10-28.
Before the record, seven of the nine cases in `localturns.test.ts` that read it failed.
The two that guard a chat with no record and a local turn passed before and after.
The echo and the synthetic Claude cases of a host started again failed: a turn the chat never began read back as its own.
On task 02's read code the four read-back cases of `agent-claude-late-steer.test.ts` failed: the folded message and each stop text were turns of their own.
The two end cases of `agent-claude-read-ends.test.ts` failed before the seeded ends: a turn ended before the message inside it.

Undone in part 2026-11-06, by the audit's rows AJ-0085 and P2AJ-0051.
VS Code's replay starts a turn at every prompt a transcript holds.
So a turn the record holds no beginning for reads back as its own.
A steering message the CLI ran late reads back as a turn of its own, as the replay reads it.
A turn recorded as the same turn as the one before still joins it, as VS Code's host keeps a resumed turn.
Step 4 follows VS Code's resumed turn: the durations add, and the usage takes the later turn's counts and model and adds both costs.
The seeded ends of step 8 stay, for a turn read back with its later run inside it.
