---
title: The Claude folder watches are shared through a registry in watch.ts
status: accepted
date: 2026-11-09
refs:
  - "[code://packages/agent-claude/src/session/watch.ts#L81-L187](../../packages/agent-claude/src/session/watch.ts#L81-L187) - `createClaudeCustomizationWatcher`, which opens its own `fs.watch` for every folder it watches"
  - "[code://packages/agent-claude/src/claude.ts#L619](../../packages/agent-claude/src/claude.ts#L619) - `probeChanged`, one watcher of the personal folder per provider"
  - "[code://packages/agent-claude/src/session/servers.ts#L554](../../packages/agent-claude/src/session/servers.ts#L554) - one watcher per session, of the personal folder, the project's `.claude` and the working directory"
  - "[code://packages/sdk/src/host.ts#L1750](../../packages/sdk/src/host.ts#L1750) - the host asks `probeChanged` once per provider, so each preset variant opens its own"
---

## Context

Each call of `createClaudeCustomizationWatcher` opens its own `fs.watch` for every folder it watches.
A scope that exists costs up to six handles: the folder, and `agents`, `skills`, `commands`, `rules` and `plugins` with their subfolders.
A session watches the personal scope, the project scope and the working directory, up to thirteen handles.
The host asks `probeChanged` once per provider, and each preset variant is a provider, so each variant watches the personal scope too.
With K variants and N sessions on one personal folder, that folder is watched K + N times, and N sessions in one project watch it N times.
On Linux, Node's recursive watch adds an inotify watch per subfolder, so each repeat costs the whole tree again.

## Decision

`watch.ts` keeps one module-level registry of open handles, keyed by the folder's path and whether it is watched with its subfolders.
A folder has one `fs.watch` however many watchers want it; each watcher's listener is added to it, and the handle closes when the last watcher lets go.
The callers of `createClaudeCustomizationWatcher` do not change.
Source: Softov, 2026-11-09, asked where the shared OS handles should live: "Registry in watch.ts".

## Consequences

The variants' probes and the sessions share the handles with no change at their call sites, and two config folders stay apart because the key is the path.
The registry is state that outlives a single watcher, so a test that counts handles reads it across watchers, and a handle that fails is gone for every watcher that held it.

## Options

- A hub made by `claude()` and handed to its probe and, through the session options, to each session: explicit and per agent, but the variants come from separate `claude()` calls and would not share, and every call site and the session context would change.
