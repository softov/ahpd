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
| [02 - The ready connect URL lives in the daemon record and never on stdout](daemon/02-connect-url-in-record/plan.md) | medium | built 2026-09-20 ([implemented.md](daemon/02-connect-url-in-record/implemented.md)) | - | - |

Next free number in `daemon`: `03`.

## host

Reference: [00-host.md](host/00-host.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Artifact tools promote in place and record a pull request](host/01-artifact-tools/plan.md) | high | built 2026-09-20 ([implemented.md](host/01-artifact-tools/implemented.md)) | - | host 03, whose promotion runs inside its new recording step |
| [02 - The root config grows two keys, and a chat keeps its title](host/02-session-config-and-titles/plan.md) | medium | built 2026-09-20 ([implemented.md](host/02-session-config-and-titles/implemented.md)) | - | - |
| [03 - The session pull request baseline is sent](host/03-pull-request-baseline/plan.md) | medium | built 2026-09-20 ([implemented.md](host/03-pull-request-baseline/implemented.md)) | host 01 | ahpc screen/04, whose filter reads the two keys |
| [04 - A client may write a file it may read](host/04-client-writes/plan.md) | high | built 2026-09-22 ([implemented.md](host/04-client-writes/implemented.md)) | - | - |
| [05 - A transcript that answered nothing is read again](host/05-transcript-reads/plan.md) | high | built 2026-09-22 ([implemented.md](host/05-transcript-reads/implemented.md)) | - | - |
| [06 - A person signs in to the host, and a role decides what they may do](host/06-users-and-permissions/plan.md) | medium | built 2026-09-23 ([implemented.md](host/06-users-and-permissions/implemented.md)) | - | ahpc and ahpapp, which cannot sign in yet |
| [07 - A person reaches the host as themselves, and the host advertises only what is true](host/07-identity-and-the-record/plan.md) | high | built 2026-09-23 ([implemented.md](host/07-identity-and-the-record/implemented.md)) | - | the issuer option behind the `Users` port, which gives `authorization_servers` a real value |

Next free number in `host`: `08`.

## claude

Reference: [00-claude.md](claude/00-claude.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Host tools load when the instruction says so, and a customization keeps its source](claude/01-host-tools-and-customizations/plan.md) | high | built 2026-09-20 ([implemented.md](claude/01-host-tools-and-customizations/implemented.md)) | research/claude-customization-attribution.md | - |
| [02 - A response round that ends empty is announced, or the gap is recorded](claude/02-round-ended/plan.md) | medium | built 2026-09-20 ([implemented.md](claude/02-round-ended/implemented.md)) | research/response-round-ended-signal.md | ahpc screen/02, which reads the notification; the gap is in [deferred.md](claude/02-round-ended/deferred.md) |

Next free number in `claude`: `03`.

## documentation

Reference: [00-documentation.md](documentation/00-documentation.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The stale prose matches the code again](documentation/01-correct-the-stale-prose/plan.md) | low | built 2026-09-20 ([implemented.md](documentation/01-correct-the-stale-prose/implemented.md)) | - | - |

Next free number in `documentation`: `02`.

## plugin

Reference: [00-plugin.md](plugin/00-plugin.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Plugins load from configuration](plugin/01-plugins-load-from-configuration/plan.md) | high | built 2026-09-20 ([implemented.md](plugin/01-plugins-load-from-configuration/implemented.md)) | - | the agent plugins, which arrive through it |
| [02 - Plugins subscribe to the host's own events](plugin/02-plugins-subscribe-to-host-events/plan.md) | high | built 2026-09-20 ([implemented.md](plugin/02-plugins-subscribe-to-host-events/implemented.md)) | plugin 01 | - |
| [03 - An agent backend over cofold](plugin/03-agent-cofold/plan.md) | high | built 2026-09-20 ([implemented.md](plugin/03-agent-cofold/implemented.md)) | - | every model-backed provider, and the ACP plan after it |
| [04 - The cofold extras](plugin/04-agent-cofold-extras/plan.md) | medium | built 2026-09-20 ([implemented.md](plugin/04-agent-cofold-extras/implemented.md)) | plugin 03 | - |
| [05 - The endpoint's models](plugin/05-endpoint-models/plan.md) | medium | built 2026-09-20 ([implemented.md](plugin/05-endpoint-models/implemented.md)) | plugin 04 | - |
| [06 - A mode and an effort control](plugin/06-permission-modes/plan.md) | medium | built 2026-09-20 ([implemented.md](plugin/06-permission-modes/implemented.md)) | plugin 05 | - |
| [07 - The ACP bridge](plugin/07-agent-acp/plan.md) | high | built 2026-09-22 ([implemented.md](plugin/07-agent-acp/implemented.md)) | - | the second runtime the `agent-*` contract is proved against |
| [08 - A plugin serves a host-owned URI scheme](plugin/08-resource-providers/plan.md) | medium | built 2026-09-22 ([implemented.md](plugin/08-resource-providers/implemented.md)) | - | - |
| [09 - A computer: provider that makes machines](plugin/09-computer-provider/plan.md) | medium | built 2026-09-22 ([implemented.md](plugin/09-computer-provider/implemented.md)) | plugin 08 | - |

Next free number in `plugin`: `10`.

## Domains without a plan

None. `host`, `claude`, `documentation` and `plugin` were the domains listed here, and each has a plan above now.
Ideas: [agents as extensions](../ideas/agents-as-extensions.md), [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md), [deliberate duplication](../ideas/deliberate-duplication.md), [Dev Container sessions](../ideas/dev-container-sessions.md).
