---
title: A session loads the plugins a client hands it - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/clientplugins.ts](../../../../packages/sdk/src/clientplugins.ts)"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
---

A client that announces plugins in a session sees them in the session's customizations, loading and then loaded or failed.
The session's agent runs with them: Claude loads each copy as a plugin, and every backend gets their MCP servers over the host's.

## What was built

- [`code://packages/sdk/src/clientplugins.ts`](../../../../packages/sdk/src/clientplugins.ts) - the port that copies a client's plugin through `resourceRead` and `resourceList`, by URI key and nonce, keeping 64 revisions and 8 per plugin.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - a session reports a client's plugins with their `load`, answers a toggle on one, and drops them when the client leaves.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - a chat gets the enabled copies at each spawn, and restarts at the next send when the set moves.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - Claude gets the copies as local plugins, with their `.mcp.json` servers declared by the host.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a client whose connection closes is kept, with its tools and plugins, for 30 seconds.

## Verified

- The gates pass in the review worktree, with the nonce fix below.
- `client-plugins-session.test.ts` and `clientplugins.test.ts` cover the copy, the load states, a toggle, a client that leaves, and the 30 second grace.

## Departures from the plan

- The review found that an empty nonce made a folder named by the empty string. An empty nonce is now filed as a missing one is, with a test.

## Left for later

- `childEnablement` is carried but not applied, and a plugin lists no `children`. [host/77](../77-a-client-plugin-lists-its-parts/plan.md) takes both.
