---
title: A session reads its list again
status: done
depends:
  - task-01-the-claude-folders-are-watched.md
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/servers.ts#L263-L272](../../../../packages/agent-claude/src/session/servers.ts#L263-L272) - the plugin switch's reload, to copy"
  - "[code://packages/agent-claude/src/session/servers.ts#L284-L327](../../../../packages/agent-claude/src/session/servers.ts#L284-L327) - `describe`, which fills `reported` once"
  - "[code://packages/agent-claude/src/session/servers.ts#L86-L95](../../../../packages/agent-claude/src/session/servers.ts#L86-L95) - `laid`"
  - "[code://packages/agent-claude/src/session.ts#L283-L323](../../../../packages/agent-claude/src/session.ts#L283-L323) - `close`"
---

## Objective

A change in a session's Claude folders makes the session ask the CLI for its agents, commands and skills again.
The session then sends `session/customizationsChanged` with the new list.

## Files

- `UPDATE: packages/agent-claude/src/session/servers.ts:284-327` - add `reread`, and start the watcher after `describe`.
- `UPDATE: packages/agent-claude/src/session.ts:283-323` - close the watcher when the session closes.
- `UPDATE: packages/agent-claude/test/customizations.test.ts` - add the cases of this task, with a fake handle.

## Steps

1. Add `reread` to `servers.ts`, which calls `reloadPlugins()` and `reloadSkills()` together.
2. In `reread`, put the answered `agents` and `commands` into `reported.init`, in place of the first ones.
3. In `reread`, put the answered `skills` into `reported.skills`, and call `laid` with the answered `plugins`.
4. Keep the old lists when a reload throws, and send nothing.
5. Run one `reread` at a time, and run one more after it when a change came during it.
6. At the end of `describe`, call `watchFolders` with the session's config folder and `ctx.options.cwd`.
7. Start no watcher when `ctx.options.spawn` has a value.
8. Start no watcher when the session closed before `describe` ended.
9. In `close`, call the watcher's `close`.
10. Add a test where a change calls `reread`, and `laid` sends an agent that `initializationResult()` did not answer.
11. Add a test for steps 4, 5 and 7, and a test that a closed session reads nothing again.

## Validation

- `packages/agent-claude/test/customizations.test.ts` passes, with the new cases.
- `pnpm typecheck` is clean, and `pnpm vitest run packages/agent-claude/test` passes.
- By hand, with a test ahpd under XDG directories: a new agent from VS Code shows in that session.
- By hand: a running turn calls the new agent through its Task tool.

## Resume

