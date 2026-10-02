---
title: A session and an automation say who owns them, and a turn says who sent it - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts)"
---

A session records its owner across restarts (`user:<id>`, or `root:<host>` for a root connection on a host with people), a turn knows who sent it, and an automation records who created it and its runs carry that owner.

## What was built

- `SessionStore.owner` / `setOwner`, kept in the session file; `HostOptions.hostName`, set by the daemon from the machine's hostname.
- In `host.ts`: the owner written when a session opens, a session a tool opens keeps its parent's owner, the sender held per turn (a queued message's sender follows it to the turn it becomes), and a scope change resolved against the session's owner.
- `Automation.owner`, `AutomationRun.owner` and `StartSession.owner`, kept by both automation stores; an automation's first turn is sent by its owner.
- `turn_start` and `turn_end` carry `sender` when the host knows it; `docs/PLUGINS.md` says so.

## Verified

- `sessions.test.ts`, `session-scope.test.ts`, `automations.test.ts`, `scheduled.test.ts`, `plugin-events-fire.test.ts`.
- Rebased on `602aff5`: `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm test` 136 files, 2052 tests passed.

## Departures from the plan

- The turn's sender reaches plugins on `turn_start` and `turn_end`, a public change to the event union, so it can be observed.
- `Automation.owner` is typed `Owner`, not `string`.
- Review fix: the principal behind an owner is remembered when the person signs in, not only when they create a session. A scope change on a session whose user owner has not signed in since the daemon started is refused until they do; that path is reached only by a session a tool opens after a restart, and has no host test.

## Left for later

- A queued message whose session is disposed before it runs leaves its sender entry until the process ends.
- The usage records that read the owner and sender: the agent meter.
