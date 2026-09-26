---
title: A restored worker whose spawning call was compacted out is listed anyway
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L136-L170](../../packages/agent-claude/src/transcript.ts#L136-L170) - `subagentsOf`, which lists every worker the meta file or the suffix names"
  - "[decisions/subagent-chats-are-restored-from-the-cli-meta-file.md](subagent-chats-are-restored-from-the-cli-meta-file.md) - the restore this refines"
---

## Context

After a compaction, the transcript `getSessionMessages` returns starts after the compaction, so a worker spawned before it has a meta file naming a call that is not in the restored turns.
Its chat's origin then names a call no client can see.

## Decision

Such a worker is listed like any other, with its `tool` origin naming the call from its meta file.
Source: Softov, 2026-09-26, asked "A restored worker whose spawning call was compacted out of the transcript: (a) list it anyway, as built, (b) hide it, or (c) link it to the compaction?": "List it anyway".

## Consequences

The worker's conversation stays readable after a compaction; its link on the call is absent because the call is.

## Options

- **Hide it.** The origin never dangles, and the worker's conversation is lost to a client.
- **Link it to the compaction.** Something to open it from, and a link to a part that is not a tool call.
