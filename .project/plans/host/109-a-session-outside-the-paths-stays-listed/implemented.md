---
title: A session outside the paths stays listed - implemented
date: 2026-11-04
refs:
  - git://5bf8a8f2
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/sdk/src/sessions/sessions.ts](../../../../packages/sdk/src/sessions/sessions.ts)"
---

A session whose folder is outside every backend's `paths`, such as the Ember bot's in `~/.bots/ember`, stays listed after a restart, before anyone opens it.

## What was built

- [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts) - the file store lists every recorded session id with its folder.
- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - a listing asks the backends' `find` about each recorded session in a folder that no backend read.

## Verified

- Six tests cover a restart, two refreshes and a git worktree folder. The gates and the sdk suite passed.
- Softov ran `host-109-ember-checks.md` on 2026-11-04, and it passed.

## Departures from the plan

- None.
