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
| [01 - Telling somebody the version is old](daemon/01-update-check/plan.md) | medium | built 2026-09-18 ([implemented.md](daemon/01-update-check/implemented.md)) | - | the same plan in ahpc, which copies its comparison |
| [02 - The ready connect URL lives in the daemon record and never on stdout](daemon/02-connect-url-in-record/plan.md) | medium | planned 2026-09-19 | - | - |

Next free number in `daemon`: `03`.

## host

Reference: [00-host.md](host/00-host.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Artifact tools promote in place and record a pull request](host/01-artifact-tools/plan.md) | high | planned 2026-09-19 | - | host 03, whose promotion runs inside its new recording step |
| [02 - The root config grows two keys, and a chat keeps its title](host/02-session-config-and-titles/plan.md) | medium | planned 2026-09-19 | - | - |
| [03 - The session pull request baseline is sent](host/03-pull-request-baseline/plan.md) | medium | planned 2026-09-19 | host 01 | ahpc screen/04, whose filter reads the two keys |

Next free number in `host`: `04`.

## claude

Reference: [00-claude.md](claude/00-claude.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Host tools load when the instruction says so, and a customization keeps its source](claude/01-host-tools-and-customizations/plan.md) | high | planned 2026-09-19 | research/claude-customization-attribution.md | - |
| [02 - A response round that ends empty is announced, or the gap is recorded](claude/02-round-ended/plan.md) | medium | planned 2026-09-19 | research/response-round-ended-signal.md | ahpc screen/02, which reads the notification |

Next free number in `claude`: `03`.

## documentation

Reference: [00-documentation.md](documentation/00-documentation.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The stale prose matches the code again](documentation/01-correct-the-stale-prose/plan.md) | low | planned 2026-09-19 | - | - |

Next free number in `documentation`: `02`.

## Domains without a plan

None. `host`, `claude` and `documentation` were the domains listed here, and each has a plan above now.
Ideas: [agents as extensions](../ideas/agents-as-extensions.md), [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md), [deliberate duplication](../ideas/deliberate-duplication.md), [Dev Container sessions](../ideas/dev-container-sessions.md).
