---
title: A skill names its own file - implemented
date: 2026-10-31
refs:
  - git://36d7eaac
  - "[code://packages/agent-claude/src/session/disk.ts](../../../../packages/agent-claude/src/session/disk.ts)"
  - "[code://packages/agent-claude/src/session/customizations.ts](../../../../packages/agent-claude/src/session/customizations.ts)"
---

Each skill, command, agent and rule of a Claude session now names the file the CLI read it from.
An entry with no file goes in a read-only `builtin` directory with a `claude-internal:` URI.

## What was built

- [`code://packages/agent-claude/src/session/disk.ts`](../../../../packages/agent-claude/src/session/disk.ts) - `filesOf` reads the managed, user, synced and project scopes. `diskOf` adds the roots to what `filesOf` found. `frontmatterOf` reads the first 64 KB of a regular file. `configDirOf` and `managedDirOf` give the roots.
- [`code://packages/agent-claude/src/session/customizations.ts`](../../../../packages/agent-claude/src/session/customizations.ts) - `customizationsOf` takes a `Disk` as its last argument. It matches each reported name with a file, in the order managed, user, project. It sends the `directory:<scope>:<folder>` containers and the rules.
- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - `laid` reads the disk with the session's `CLAUDE_CONFIG_DIR` and working directory, and reads nothing for a session with `spawn`.
- [`code://packages/agent-claude/src/probe.ts`](../../../../packages/agent-claude/src/probe.ts) - the probe reads the personal and managed scopes.
- [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md) - the section *Where a customization comes from*.

## Verified

- `disk.test.ts` has one case per scope, and one case for steps 6, 8, 13, 14 and 15 of task 01, and for `managedDirOf`.
- `customizations.test.ts` has ten new cases for task 02 and task 03, and three changed cases.
- Seven sdk tests changed, because each session now opens with its writable directories.
- `pnpm typecheck` is clean, and the whole suite passes with 7921 tests.
- Softov passed the checks in VS Code on 2026-11-03. `advisor`, `do-spec` and a synced skill open their `SKILL.md`. The synced folder offers no add, `code-review` is built in, and `CLAUDE.md` opens.

## Departures from the plan

- A command and an agent with no file also go in `builtin` directories, `directory:builtin:commands` and `directory:builtin:agents`, because `contents` names one kind.
- The probe also reads the managed scope, because a managed skill wins over a personal one.
- `customizationsOf` takes the roots with the files, as a `Disk`, because a writable directory needs its path when it has no children.
- `agentNameOf` reads the first 64 KB of a large agent file, and no longer skips it. The test in `agent-claude-agent-pick.test.ts` now expects the frontmatter name.
- A plugin skill whose `SKILL.md` is not there gets `claude-internal:/skill/<name>`, not a path under the plugin.
- No test checks the list of a session with `spawn`. The tests that set `spawn` do not read the list, and a new one needs a session in a machine. The README says what such a session lists.
- A session in the home folder has no project scope, because its `.claude` is the personal folder. The memory files of the home folder go in the personal scope.
- The test setup sets `CLAUDE_CONFIG_DIR` to an empty folder of the run, so no test reads the person's own `~/.claude`.
