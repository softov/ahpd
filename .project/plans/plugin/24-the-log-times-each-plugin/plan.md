---
title: The log says when each plugin starts loading and how long it took
domain: plugin
status: active
priority: medium
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/plugin/01-plugins-load-from-configuration/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/server/src/plugins.ts#L339-L445](../../../../packages/server/src/plugins.ts#L339-L445) - `loadOne`, which logs one line only after `apply` has returned"
  - "[code://packages/server/src/plugins.ts#L491-L535](../../../../packages/server/src/plugins.ts#L491-L535) - `loadPlugins`, which loads the specs one after another"
---

## Goal

The daemon's log shows each plugin's start before its import, and its end with the time it took, so a slow plugin is visible in the log and not only as a gap between two lines.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Softov's log of 2026-09-28 showed `plugin @ahpd/agent-cofold from ...` at 02:41:37.364 and `plugin @ahpd/agent-pi from ...` at 02:41:42.395, with nothing between; the 5 s was agent-pi importing pi, which plan pi/10 moves out of the load.

### Runtime path

```
loadPlugins -> for each spec: [new] "plugin <name> loading" -> resolve, manifest, import, apply -> "plugin <name> from <path>" [new: "in <n> ms"]
```

### Gaps

- Nothing is logged before a plugin's import, and the time a plugin took is not logged at all.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The log gets a line before each plugin loads and the load time after it; plugins still load one after another. | Softov, 2026-09-28, asked what should change in plugin loading: "Logs + agent-pi imports pi lazily". | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin's load is logged with its time](task-01-a-plugins-load-is-logged-with-its-time.md) | implemented | - |

## Risks and tradeoffs

- A test that matches the whole `plugin <name> from <path>` line changes with it; the new text keeps that prefix.

## Resume state

- **Done so far:** task 01 is implemented and awaits review.
- **Next action:** review [task-01-a-plugins-load-is-logged-with-its-time.md](task-01-a-plugins-load-is-logged-with-its-time.md).
- **Open questions:** none.
- **Watch out for:** a plugin that fails still logs its problem line; it also says how long it took before failing.

## Final verification checklist

- [ ] A daemon start logs a start and a timed end for every plugin.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.
- [ ] `plans/index.md` updated.
