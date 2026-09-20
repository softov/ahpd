---
title: The stale documentation is corrected in one task, not left to the next pass
status: accepted
date: 2026-09-19
refs:
  - code://packages/server/src/main.ts - USAGE still describes a fence `24bb04c` removed
  - code://docs/AGENT.md#L122 - four setters listed where only `setConfig` exists
  - code://docs/DAEMON.md - the options table, missing three flags
  - code://packages/agent-claude/src/claude.ts#L130 - the enum that advertises five permission modes
  - code://packages/agent-claude/src/session.ts#L2198 - the six modes the backend accepts
---

## Context

Reading the reference for the pass at `.project/review/2026-09-19-upstream-pass-4.md` turned up six places where this repository's own prose contradicts its code: the `--path` fence in `USAGE`, four `Session` setters in `docs/AGENT.md`, three missing flags in the daemon options table, a `resource*` comment that calls the write half unserved, a `source` comment that calls `fork` and `sideChat` unserved, and the Claude backend's permission modes, where five are advertised and six accepted.
Each was checked against the code it describes and each is real, and none of them is caused by anything upstream changed, which is why they are recorded here rather than as part of an upstream item.

Asked on 2026-09-19 what to do with them, the answer was: "Fix them all as one small documentation task."

## Decision

All six are corrected in a single documentation task over `packages/server/src/main.ts`, `docs/AGENT.md`, `docs/DAEMON.md`, `packages/sdk/src/host.ts` and `packages/agent-claude/src/session.ts`.
The permission-mode mismatch is corrected by making the advertised list and the accepted list agree, whichever direction the code says is right, and not by documenting the difference away.

## Consequences

The docs stop promising a fence, listing setters that do not exist and hiding flags that do, which matters most for the `--path` row because a user reads it to learn what the daemon will refuse.
One task carries six unrelated edits, so it is a documentation task with six steps rather than six tasks, and it should not grow a seventh finding silently.
The permission-mode fix is the only one that is a code change rather than a prose change: the SDK's `PermissionMode` has six members, so the advertised enum gains `dontAsk` and the two tests that assert its shape move with it.
A seventh drift, the detached-worktrees comment at `packages/sdk/src/host.ts:4095-4104` that still calls detached worktrees the Dev Container flow, is recorded in the review's Left open and left to the next pass rather than folded into this task silently.

## Options

Correcting only the detached-worktrees comment was rejected: it is one comment, and it leaves five contradictions that were verified in the same reading.
Correcting the prose and leaving the permission-mode lists disagreeing was rejected: a mismatch between what a backend advertises and what it accepts is the kind a client discovers by being refused, and it is cheaper to fix beside the rest.
Leaving all six was rejected: they are cheap to fix together and each one misleads somebody who reads the file instead of the code.
