---
title: A written agent shows at once - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-claude/src/session/watch.ts](../../../../packages/agent-claude/src/session/watch.ts)"
  - "[code://packages/agent-claude/src/session/servers.ts](../../../../packages/agent-claude/src/session/servers.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
---

A skill, command, agent or rule written into a Claude folder now shows in the open sessions without a restart.
The list on the root channel shows a change in the personal folder too.

## What was built

- [`code://packages/agent-claude/src/session/watch.ts`](../../../../packages/agent-claude/src/session/watch.ts) - `watchFolders` watches the personal folder, the project's `.claude` and the memory files of the working directory. It calls once, 300 ms after the last change of a burst. A folder that is not there yet is watched for from its parent.
- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - `reread` asks `reloadPlugins()` and `reloadSkills()` again and lays the list out again. `describe` starts the watch, and `unwatch` stops it.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `close` stops the watch.
- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - the optional `probeChanged(onChange)`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `probeAgent` asks `probeChanged` after the first answer, probes again on each call, and keeps the last answer. The host stops the calls when it closes and when a fold removes the backend.
- [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) - `probeChanged` watches the personal folder.
- [`code://docs/sdk/AGENT.md`](../../../../docs/sdk/AGENT.md) and [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md) - the `probeChanged` row, and a sentence on the watch.

## Verified

- `watch.test.ts` has seven cases on real folders: steps 4, 6, 7, 8 and 11 of task 01, the home folder, and folders it cannot watch.
- `agent-claude-reread.test.ts` has five cases for steps 10 and 11 of task 02.
- `host-snapshots.test.ts` has two new cases: a second probe, and a fold that removes the backend.
- `pnpm typecheck` is clean, and the whole suite passes.
- Softov passed the checks by hand on 2026-11-03. An agent and a skill show once their frontmatter is valid. A rename and a delete reach the list. A new session shows the agent, and a turn runs it.

## Departures from the plan

- Only `agents`, `skills`, `commands` and `rules` are watched with their subfolders. The scope folder and `plugins` are watched without them, because a recursive watch of `projects` and `plugins` costs about 1,600 handles on this machine.
- A session in the home folder watches its `.claude` once, as the personal folder, because the skills plan reads it as one scope.
- The host keeps the watch of a backend by provider. A fold that gives a provider a new object keeps the watch, and the watch probes the new object.
- The host test uses a skill and an agent in the root's customizations, not commands, because the root channel sends the customizations of a backend.
