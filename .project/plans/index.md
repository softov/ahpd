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
| [03 - ahpd plugin install and remove](daemon/03-ahpd-plugin-install/plan.md) | high | built 2026-09-26 ([implemented.md](daemon/03-ahpd-plugin-install/implemented.md)) | plugin 01 | - |
| [04 - ahpd's commands are declared once, and the CLI is rendered from them](daemon/04-commands-declared-once/plan.md) | medium | active 2026-09-26, reviewed twice; fix tasks 20, 22 and 23 implemented and awaiting review; 17 waits for the cofold release, then 06 | daemon 03 | daemon 05 |
| [05 - An HTTP API for the daemon, from the same commands, under the same grants](daemon/05-an-http-api/plan.md) | medium | active 2026-09-26, reviewed twice; fix tasks 23-27 implemented and awaiting review; 15 in the cofold repository, 16 waits for `@cofold/remote` 0.4.0 | daemon 04 | - |
| [06 - The wire capture is the traffic log VS Code writes](daemon/06-the-wire-capture-is-the-traffic-log-vs-code-writes/plan.md) | medium | planned 2026-09-26 | - | - |

Next free number in `daemon`: `07`.

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
| [08 - An issuer vouches for a person, and the directory still decides what they may do](host/08-an-issuer-behind-the-users-port/plan.md) | high | built 2026-09-23 ([implemented.md](host/08-an-issuer-behind-the-users-port/implemented.md)) | host 07 | - |
| [09 - The door token is the host, and a person's own token is that person](host/09-the-door-token-is-the-host/plan.md) | high | built 2026-09-23 ([implemented.md](host/09-the-door-token-is-the-host/implemented.md)); the personal-token half superseded by host 13 | host 07 | - |
| [10 - A role is read on every command](host/10-revocation-on-the-next-command/plan.md) | high | built 2026-09-23 ([implemented.md](host/10-revocation-on-the-next-command/implemented.md)) | host 06 | - |
| [11 - A grant is a subject and a verb](host/11-a-grant-is-a-subject-and-a-verb/plan.md) | high | built 2026-09-23 ([implemented.md](host/11-a-grant-is-a-subject-and-a-verb/implemented.md)) | host 06 | - |
| [12 - An issuer may be plain http on loopback](host/12-an-issuer-on-loopback/plan.md) | medium | built 2026-09-23 ([implemented.md](host/12-an-issuer-on-loopback/implemented.md)) | host 08 | - |
| [13 - The door is a door, and trusting the token is the opt-out](host/13-the-door-is-a-door/plan.md) | high | built 2026-09-23 ([implemented.md](host/13-the-door-is-a-door/implemented.md)) | host 09 | - |
| [14 - A record may name its own issuer](host/14-a-record-may-name-its-own-issuer/plan.md) | medium | built 2026-09-23 ([implemented.md](host/14-a-record-may-name-its-own-issuer/implemented.md)) | host 08, host 12 | - |
| [15 - What the issuer left, a provider from the CLI and roles from a claim](host/15-what-the-issuer-left/plan.md) | medium | built 2026-09-23 ([implemented.md](host/15-what-the-issuer-left/implemented.md)) | host 14 | - |
| [16 - A connection that is already authorized is not asked to sign in](host/16-an-authorized-connection-is-not-asked-to-sign-in/plan.md) | high | built 2026-09-26 ([implemented.md](host/16-an-authorized-connection-is-not-asked-to-sign-in/implemented.md)) | host 13 | - |
| [17 - Host configuration has its own grant](host/17-host-configuration-has-its-own-grant/plan.md) | medium | built 2026-09-25 ([implemented.md](host/17-host-configuration-has-its-own-grant/implemented.md)) | host 11 | - |
| [18 - A session takes any key until its first turn, and shows the fixed ones after](host/18-a-provisional-session-takes-any-key/plan.md) | high | built 2026-09-26 ([implemented.md](host/18-a-provisional-session-takes-any-key/implemented.md)) | host 02 | - |
| [19 - A fork copies the conversation through the chosen turn](host/19-a-fork-copies-through-the-turn/plan.md) | medium | planned 2026-09-26, tasks 01-03 todo | - | pi 05, and the ACP fork in plugin 18, which must cut at the turn's end |

Next free number in `host`: `20`.

## claude

Reference: [00-claude.md](claude/00-claude.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Host tools load when the instruction says so, and a customization keeps its source](claude/01-host-tools-and-customizations/plan.md) | high | built 2026-09-20 ([implemented.md](claude/01-host-tools-and-customizations/implemented.md)) | research/claude-customization-attribution.md | - |
| [02 - A response round that ends empty is announced, or the gap is recorded](claude/02-round-ended/plan.md) | medium | built 2026-09-20 ([implemented.md](claude/02-round-ended/implemented.md)) | research/response-round-ended-signal.md | ahpc screen/02, which reads the notification; the gap is in [deferred.md](claude/02-round-ended/deferred.md) |
| [03 - A model round that ends empty is announced](claude/03-an-empty-round-is-announced/plan.md) | medium | built 2026-09-26 ([implemented.md](claude/03-an-empty-round-is-announced/implemented.md)) | claude 02 | - |
| [04 - A subagent has its own chat, linked from the call that started it](claude/04-a-subagent-has-its-own-chat/plan.md) | medium | active 2026-09-26, reviewed; fix tasks 08-16 todo | claude 03 | - |

Next free number in `claude`: `05`.

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
| [10 - A computer is an object a person manages](plugin/10-a-computer-a-person-manages/plan.md) | high | built 2026-09-23 ([implemented.md](plugin/10-a-computer-a-person-manages/implemented.md)) | plugin 08, plugin 09 | plugin 11, which runs a session in one |
| [11 - A session runs inside a computer](plugin/11-a-session-inside-a-computer/plan.md) | high | built 2026-09-23 ([implemented.md](plugin/11-a-session-inside-a-computer/implemented.md)) | plugin 10, plugin 07 | - |
| [12 - A client can tell what a scheme does before it asks one](plugin/12-a-client-can-tell-what-a-scheme-does/plan.md) | high | built 2026-09-23 ([implemented.md](plugin/12-a-client-can-tell-what-a-scheme-does/implemented.md)) | plugin 08, plugin 10 | the ahpapp Computers screen, which reads the advertisement |
| [13 - Only the images an operator named](plugin/13-only-the-images-an-operator-named/plan.md) | medium | built 2026-09-24 ([implemented.md](plugin/13-only-the-images-an-operator-named/implemented.md)) | plugin 10 | - |
| [14 - A cofold session has files, shell, web and memory, run by cofold itself](plugin/14-cofold-runs-its-own-tools/plan.md) | high | active 2026-09-26, reviewed twice; fix tasks 18 and 19 implemented and awaiting review, 17 waits for the `@cofold/tools` release ([implemented.md](plugin/14-cofold-runs-its-own-tools/implemented.md), [deferred.md](plugin/14-cofold-runs-its-own-tools/deferred.md)) | plugin 03 | container 04 |
| [15 - An agent says what a machine needs, and the machine is made with it](plugin/15-an-agent-says-what-a-machine-needs/plan.md) | high | active 2026-09-26, reviewed; task 06 reopened, fix tasks 08-12 todo | plugin 11 | plugin 16, container 03, container 04 |
| [16 - A disposable machine is made for a session and goes after it](plugin/16-a-disposable-machine/plan.md) | medium | active 2026-09-26, reviewed; fix tasks 05-11 todo | plugin 15 | - |
| [17 - A plugin hears when a session needs a person](plugin/17-a-plugin-hears-a-session-needs-a-person/plan.md) | high | planned 2026-09-26 | plugin 02 | the notify plugin, which reads the two events |
| [18 - The ACP bridge resumes, forks and asks](plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md) | medium | planned 2026-09-26, after plugin 21; ACP v2 in [deferred.md](plugin/18-the-acp-bridge-resumes-forks-and-asks/deferred.md) | plugin 07, host 19 (task 02 after host 19 task 01) | - |
| [19 - A docker machine may run under gVisor](plugin/19-a-docker-machine-may-run-under-gvisor/plan.md) | low | planned 2026-09-26, after plugin 18 | plugin 10 | - |
| [20 - A plugin is a client of its own host, as a principal of its own](plugin/20-a-plugin-is-a-client-of-its-own-host/plan.md) | high | planned 2026-09-26, after plugin 17 | plugin 01, host 11 | plugin 21, and every gateway, trigger and facade plugin |
| [21 - A plugin serves an HTTP route on the daemon's listener](plugin/21-a-plugin-serves-an-http-route/plan.md) | medium | planned 2026-09-26, after plugin 20; task 02 after daemon 05 tasks 15 and 16 | daemon 05, plugin 20 | webhook, callback and facade plugins |

Next free number in `plugin`: `22`.

## container

Reference: [00-container.md](container/00-container.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A session in a dev container, with its whole host inside it](container/01-a-session-in-a-dev-container/plan.md) | high | built 2026-09-24, except its `ahpapp` half ([implemented.md](container/01-a-session-in-a-dev-container/implemented.md)) | plugin 11, plugin 12 | an ahpapp plan, which drives the same four methods |
| [02 - VS Code offers a dev container on a folder served by ahpd](container/02-vscode-offers-our-dev-container/plan.md) | high | planned 2026-09-26, task 01 blocked: the tunnel is not listed in VS Code | container 01 | - |
| [03 - A dev container is a computer, listed and reachable without the connection that made it](container/03-a-dev-container-is-a-computer/plan.md) | medium | active 2026-09-26, reviewed; task 03 unblocked by a flat source choice, task 06 reopened, fix tasks 07-16 todo | container 01, plugin 15 | - |
| [04 - A cofold session in a computer runs in an ahpd started inside it](container/04-a-cofold-session-in-a-computer/plan.md) | medium | active 2026-09-26, reviewed; fix tasks 07-17 todo | plugin 14, plugin 15 | - |

Next free number in `container`: `05`.

## pi

Reference: [00-pi.md](pi/00-pi.md)

Worked in this order: 01, 02, 09, then problem [a pi transcript opens empty](../problems/a-pi-transcript-opens-empty-for-a-session-this-process-did-not-watch.md), then 03, 04, host 19, 05, 06, 07.

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A pi turn can be truncated, one that failed at the provider says so, and the configured model is used](pi/01-a-turn-ends-as-it-ended/plan.md) | high | planned 2026-09-26, tasks 01-03 todo | - | pi 04, pi 05 |
| [02 - Host and client tools reach pi](pi/02-host-and-client-tools-reach-pi/plan.md) | high | planned 2026-09-26, tasks 01-04 todo | - | pi 03, pi 09 |
| [03 - The host's instructions reach pi's system prompt](pi/03-the-host-instructions-reach-pi/plan.md) | medium | planned 2026-09-26, task 01 todo | pi 02 | - |
| [04 - A pi turn reports what it used](pi/04-a-turn-reports-its-usage/plan.md) | medium | planned 2026-09-26, tasks 01-02 todo | pi 01 | - |
| [05 - A pi chat forks from a turn](pi/05-a-chat-forks-from-a-turn/plan.md) | medium | planned 2026-09-26, tasks 01-02 todo | pi 01, host 19 | - |
| [06 - pi's edits reach the host's changesets](pi/06-pi-edits-reach-the-changesets/plan.md) | medium | planned 2026-09-26, task 01 todo | - | - |
| [07 - Input from a client is tagged as not the terminal's](pi/07-remote-input-is-tagged/plan.md) | low | planned 2026-09-26, task 01 todo | - | - |
| [08 - A pi session store can move between hosts](pi/08-a-session-store-can-move/plan.md) | low | dropped 2026-09-26 | - | - |
| [09 - pi asks a person before a tool runs](pi/09-pi-asks-before-a-tool-runs/plan.md) | high | planned 2026-09-26, tasks 01-03 todo | pi 02 | - |

Next free number in `pi`: `10`.

## Domains without a plan

None. `host`, `claude`, `documentation`, `plugin` and `container` were the domains listed here, and each has a plan above now.
Ideas: [agents as extensions](../ideas/agents-as-extensions.md), [an agent says what a machine needs](../ideas/an-agent-says-what-a-machine-needs.md), [an SSH command that attaches to the daemon](../ideas/an-ssh-command-that-attaches-to-the-daemon.md), [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md), [deliberate duplication](../ideas/deliberate-duplication.md), [Dev Container sessions](../ideas/dev-container-sessions.md), [terminal commands approved by rule](../ideas/terminal-commands-approved-by-rule.md), [turn and model-call diagnostics](../ideas/turn-and-model-call-diagnostics.md), [verify a JWT locally](../ideas/verify-a-jwt-locally.md).
