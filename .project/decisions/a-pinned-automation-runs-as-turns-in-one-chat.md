---
title: A pinned automation runs each time as the next turn in one chat
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/automations.ts#L127-L206](../../packages/sdk/src/host/automations.ts#L127-L206) - `beginAutomation`, which makes a new session on every run today"
---

## Context

Each automation run makes a new session today.
A task that repeats, like a ChatGPT or Codex scheduled task, reads better as one thread where each run sees the earlier ones.

## Decision

An automation is `new` or `pinned`. A pinned one keeps one session with one chat, and each run is the next turn in that chat.
When the pinned session is gone, the next run makes a new one and keeps it.

Source: Softov, 2026-10-07, asked "A pinned automation: what does each run add to its session?" and chose "A turn in the same chat".

## Consequences

- A pinned run sees every earlier run, so its context grows until the backend compacts it.
- The session's folder, worktree and machine stay between runs.

## Options

- A new chat in the same session for each run: same place, clean context.
- A setting that picks turn or chat for each automation.
