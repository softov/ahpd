---
title: A session that has not started takes a fixed key by restarting
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/host.ts#L7477-L7560](../../packages/sdk/src/host.ts#L7477-L7560) - the live `session/configChanged`, which restarts for `HOSTS_OWN` keys and refuses any other fixed key"
  - "[code://packages/sdk/src/host.ts#L3402-L3480](../../packages/sdk/src/host.ts#L3402-L3480) - `restart`, which re-spawns with `held.config`"
  - "[code://packages/computer/src/plugin.ts#L297-L301](../../packages/computer/src/plugin.ts#L297-L301) - the `computer` key, which says where a session runs"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1935-L1947 - the first send pushes the whole picker config \"so its provisional record materializes with those values\"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L4025-L4037 - before the first send the picker reads the new-session config, not the session's
---

## Context

VS Code's Agents window creates the backend session as soon as somebody opens New, with the picker's values at that moment.
A picker change after that stays in the window until the first send, which dispatches the whole config as one `session/configChanged` and then the first turn.
This host restarts the session for its own keys (`isolation`, `branch`) in that window, and for any other key marked `sessionMutable: false` it refuses.
The `computer` key declares nothing, so it is treated as mutable, handed to a backend that reads it only at spawn, and dropped.
Softov picked a different computer in New, sent, and the session ran on the one the picker showed when New opened.

## Decision

Before a session's first turn, a change to any key that is fixed once the session runs restarts the session with the new value, the way `isolation` already does.
After the first turn the change is refused with "is fixed once the session has started".
A turn or other action that reaches the session while that restart runs waits for it.

## Consequences

The value a person picked in New is the value the session runs with, for every backend and every contributed key.
A key a backend or plugin wants treated this way declares `sessionMutable: false`, and `computer` now does.
The first send can cost one extra backend start when a fixed key moved, and the host has to hold a session's actions while it restarts.

## Options

- **Refuse, as now.** Correct for a running session, but the refusal lands on the first send, which VS Code does not surface, so the pick is silently lost.
- **Start no backend until the first turn.** Closest to the reference host's provisional record, but it changes when every backend spawns and what a created session can answer before anything is said, which is a larger change than the bug.
