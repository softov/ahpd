---
title: A backend says which transcript id a turn was written under
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/agent.ts](../../packages/sdk/src/types/agent.ts) - the options a host hands a backend, where `onFileEdit` is the same kind of optional callback"
  - "[code://packages/agent-claude/src/session.ts](../../packages/agent-claude/src/session.ts) - `cuts`, the prompt's own uuid recorded on a turn's first `user` echo"
  - "[code://packages/agent-claude/src/transcript.ts](../../packages/agent-claude/src/transcript.ts) - a turn read back is named by the frame's `uuid`, not the client's turn id"
---

## Context

host/38 keeps who sent each turn under the turn id a client named.
A session read back from Claude's transcript names each turn by the CLI's own uuid, so after a restart no sender is found for a Claude turn, while pi and cofold keep the client's id and are unaffected.

## Decision

A backend may call an optional `onTurnRecorded(turnId, transcriptId)` the host passes it, saying that the turn it ran as `turnId` is written in its transcript as `transcriptId`.
The host then keeps the turn's sender under that id as well, so a history read from the transcript finds it.
Source: Softov, 2026-10-02, asked "How should Claude's turns keep their sender after a restart?": "Claude tells us its id".

## Consequences

Any backend whose transcript names turns its own way can keep host records attached to them, without the host learning that backend's format.
A backend that never calls it, or a turn the backend wrote before this, has no sender after a restart.

## Options

- **The prompt carries the client's turn id** (SDKUserMessage `uuid`): rejected, it ties the fix to one SDK and fails for a turn id that is not a UUID.
- **Accept the loss for Claude**: rejected.
