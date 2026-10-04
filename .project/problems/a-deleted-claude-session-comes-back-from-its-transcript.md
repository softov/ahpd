---
title: A deleted Claude session comes back from its transcript, under another provider, and cannot be deleted again
status: open
date: 2026-10-04
severity: major
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L95-L98](../../packages/sdk/src/host/lifecycle.ts#L95-L98) - `removeSession` refuses a session the daemon is not holding with -32001"
  - "[code://packages/sdk/src/host/lifecycle.ts#L226](../../packages/sdk/src/host/lifecycle.ts#L226) - the stored row, and with it the provider that ran the session, is forgotten"
  - "[code://packages/sdk/src/host.ts#L2693](../../packages/sdk/src/host.ts#L2693) - `disposeSession`, which removes only what the daemon holds"
  - "[code://packages/agent-claude/src/catalog.ts#L20](../../packages/agent-claude/src/catalog.ts#L20) - the Claude catalogue is the SDK's `listSessions` over the configured paths"
  - "[code://packages/sdk/src/host/catalogue.ts#L280-L330](../../packages/sdk/src/host/catalogue.ts#L280-L330) - a listed row is given to the first agent that reads its directory when no owner is recorded"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - exports `deleteSession(sessionId)`
---

## Symptom

A Claude session deleted from a client (ahpapp's row menu, `ahpc session rm`) is listed again on the next listing when its directory is one of the Claude backend's `paths`.
It returns under the first Claude agent that reads that directory, not the one that ran it, and deleting it again fails with `RPC error -32001: No agent for session`.

Shown again on 2026-10-04 with `/github/ahpd` in `paths`:

1. `ahpc session new --agent claude-openrouter --cwd /github/ahpd --set isolation=folder`, one turn.
2. `ahpc session rm claude-openrouter:/<id>` answers `Disposed`.
3. `ahpc session list` still has the row, now as `claude:/<id>`.
4. `ahpc session rm` on it answers `-32001 No agent for session claude:/<id>`.

A session in a worktree stays gone, because no listing reads the worktree's directory.

## Cause

`disposeSession` tears down what the daemon holds and forgets the stored row, but leaves the transcript under `~/.claude/projects/`.
The Claude catalogue lists every transcript in its `paths`, so the next listing finds it again; with the stored owner forgotten, the row goes to the first agent reading that directory.
`removeSession` works only on a session held in memory, so a row that is only listed cannot be deleted.

## Impact

Deleting a Claude session from ahpapp does not stick for any session in a listed directory, and the row that returns cannot be removed from any client.
A session run by a variant (`claude-openrouter`, a preset) reopens on the built-in `claude` agent, another account and endpoint.

## Workaround

none

## Fix

Undecided. Candidates:

- Delete the transcript with the SDK's `deleteSession(sessionId)` on dispose, which the SDK documents as the way to remove a session from its store.
- Keep a record of deleted ids in the host store and filter them out of every listing, leaving the transcript on disk.
- Let `disposeSession` accept a listed row by asking its agent to delete it, whichever of the two above is chosen.
