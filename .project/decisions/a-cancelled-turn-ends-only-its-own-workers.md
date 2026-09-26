---
title: A cancelled turn ends only the workers it spawned
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-claude/src/session.ts#L3196-L3206](../../packages/agent-claude/src/session.ts#L3196-L3206) - `cancel`, which ends every worker the session has open"
  - "[code://packages/agent-claude/src/session.ts#L872-L878](../../packages/agent-claude/src/session.ts#L872-L878) - `Spawning`, which records the scope a call is in but not the turn"
---

## Context

A background worker outlives the turn that spawned it: its frames arrive after that turn's `result`, and a later turn can be cancelled while it is still running.
`cancel` ends every open worker as `cancelled`, so a background worker from an earlier turn is drawn as cancelled while the CLI may still be running it, and its later frames land on a closed turn.

## Decision

Cancelling a turn ends only the workers spawned in that turn, foreground or background; a background worker spawned in an earlier turn keeps running and ends on its own `task_notification`.
Source: Softov, 2026-09-26, asked "On cancel: (a) end only workers spawned in the cancelled turn, leaving background ones running, or (b) end all of them, as the code does now?": "End only the workers spawned in the cancelled turn; background workers from earlier turns keep running."

## Consequences

Each spawning call records the lead turn it was made in.
A background worker the CLI stops on interrupt still ends, through its `task_notification` with `stopped`.

## Options

- **End every open worker.** Simple, and wrong for a background worker the CLI keeps running.
