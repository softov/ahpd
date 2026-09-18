---
title: Plans index
---

# Plans index

One row per plan; a plan is a folder with `plan.md` and one file per task.
Status: `draft` · `planned` · `active` · `built` · `dropped` (a task: `todo` · `doing` · `done` · `blocked` · `dropped`).
Format and rules: the `do-spec` skill in `.agents/skills/do-spec/`.
What is not planned yet is one file each under [`ideas/`](../ideas/), and a plan starts from one of them.

## daemon

Reference: [00-daemon.md](daemon/00-daemon.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Telling somebody the version is old](daemon/01-update-check/plan.md) | medium | planned; next: task 01 | - | the same plan in ahpc, which copies its comparison |

Next free number in `daemon`: `02`.

## Later domains (no plans yet)

`host` (`packages/sdk`) · `claude` (`packages/agent-claude`) · `documentation`.
Ideas: [agents as extensions](../ideas/agents-as-extensions.md), [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md), [deliberate duplication](../ideas/deliberate-duplication.md).
