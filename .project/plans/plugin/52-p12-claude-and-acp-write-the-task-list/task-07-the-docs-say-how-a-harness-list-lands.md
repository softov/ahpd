---
title: The docs say how a harness list lands
status: done
depends: [task-05-claudes-own-task-calls-write-the-plan.md, task-06-the-acp-plan-update-writes-the-plan.md]
layer: "docs"
refs:
  - "[code://docs/plugins/agent-claude.md](../../../../docs/plugins/agent-claude.md) - the Claude plugin's page"
  - "[code://docs/plugins/agent-acp.md](../../../../docs/plugins/agent-acp.md) - the ACP plugin's page"
---

## Objective

The docs say that Claude uses the host task tools by default, and how to keep its own tools.
They also say how a harness list becomes the session's plan.

## Files

- `UPDATE: docs/plugins/TASK-LIST.md` - the session's plan, the text match, a dropped step, and `source`.
- `UPDATE: packages/agent-claude/README.md` - the two settings and their defaults.
- `UPDATE: packages/agent-acp/README.md` - the plan update writes the session's plan.

## Steps

1. Say that a Claude session uses the host task tools by default.
2. Show the setting that keeps Claude's own tools, and the setting for `CLAUDE_CODE_ENABLE_TASKS`.
3. Say that a whole list matches by text, and that a missing step reads `dropped`.
4. Say that a `codex-acp` session fills the session's plan through the ACP plan update.

## Validation

- The docs match the code of tasks 02 to 06.

## Resume

- **Done so far:** every step. `TASK-LIST.md` has a `session` scope in the plan table, and a section called "A harness's own list". That section says how a whole list matches by text and how a missing step reads `dropped`. It also says how the four statuses and the priority map, and what a single change does. The Claude README's preset table has `hostTasks` and `enableTasks`. Its "Tasks" section says the default is the host's tools and that their calls write the session's plan. It also says that keeping Claude's own starts the CLI with `CLAUDE_CODE_ENABLE_TASKS=1`. The ACP README says a `plan` update writes the session's plan, which is how `codex-acp` fills it, beside the turn's one Plan call.
- **Files:** `docs/plugins/TASK-LIST.md`, `packages/agent-claude/README.md`, `packages/agent-acp/README.md`.
- **Next action:** none. The plan's final verification checklist is what is left.
- **Open questions:** none.
- **Watch out for:** `docs/plugins/agent-claude.md` and `docs/plugins/agent-acp.md` include the two READMEs, so they follow without an edit of their own. The two settings are preset options, so they sit under `presets.<id>` rather than at the top of the options. `hostTasks: false` is not the only road to Claude's own tools: a host with no tasks plugin keeps them too, and the README says so.
