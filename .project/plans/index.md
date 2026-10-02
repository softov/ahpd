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
| [04 - ahpd's commands are declared once, and the CLI is rendered from them](daemon/04-commands-declared-once/plan.md) | medium | built 2026-09-28 ([implemented.md](daemon/04-commands-declared-once/implemented.md)) | daemon 03 | daemon 05 |
| [05 - An HTTP API for the daemon, from the same commands, under the same grants](daemon/05-an-http-api/plan.md) | medium | built 2026-09-28 ([implemented.md](daemon/05-an-http-api/implemented.md)) | daemon 04 | - |
| [06 - The wire capture is the traffic log VS Code writes](daemon/06-the-wire-capture-is-the-traffic-log-vs-code-writes/plan.md) | medium | built 2026-10-02 ([implemented.md](daemon/06-the-wire-capture-is-the-traffic-log-vs-code-writes/implemented.md)) | - | - |
| [07 - A daemon with no backend names the command that installs one, and an upgrade from 0.6 is told why](daemon/07-an-upgrade-without-a-backend-is-told-the-command/plan.md) | high | built 2026-09-28 ([implemented.md](daemon/07-an-upgrade-without-a-backend-is-told-the-command/implemented.md)) | daemon 03 | - |
| [08 - The configuration is read through cofold and checked against one schema](daemon/08-the-config-file-is-checked-in-one-place/plan.md) | high | built 2026-09-28 ([implemented.md](daemon/08-the-config-file-is-checked-in-one-place/implemented.md)) | cofold commands/02 | plugin 26 |

| [09 - A plugin update moves all or the named plugins](daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) | high | active 2026-09-29; tasks 01, 02, 04, 06, 08, 09, 10, 11 implemented, 05 and 07 dropped; 03 waits on cofold | - | - |

| [10 - `ahpd configure` sets the daemon up, and a first start at a terminal offers it](daemon/10-a-first-run-sets-the-daemon-up/plan.md) | medium | built 2026-10-02 ([implemented.md](daemon/10-a-first-run-sets-the-daemon-up/implemented.md)) | daemon 09 | - |
| [11 - Root config carries the daemon's settings and each plugin's options, and a client edits them](daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md) | high | built 2026-10-02 ([implemented.md](daemon/11-root-config-carries-the-daemon-and-its-plugins/implemented.md)) | - | - |
| [12 - A plugin option is set from the command line, in the file or for one run](daemon/12-a-plugin-option-is-set-from-the-command-line/plan.md) | medium | active 2026-09-30; tasks 01, 02, 03 implemented | - | - |
| [13 - `ahpd restart` restarts the daemon in place, and refuses while a turn runs](daemon/13-ahpd-restart/plan.md) | high | active 2026-09-30; tasks 01, 02, 03 implemented | - | - |
| [14 - The daemon log rotates at start](daemon/14-the-daemon-log-rotates-at-start/plan.md) | low | built 2026-10-02 ([implemented.md](daemon/14-the-daemon-log-rotates-at-start/implemented.md)) | - | - |

Next free number in `daemon`: `15`.

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
| [19 - A fork copies the conversation through the chosen turn](host/19-a-fork-copies-through-the-turn/plan.md) | medium | built 2026-10-02 ([implemented.md](host/19-a-fork-copies-through-the-turn/implemented.md)) | - | pi 05, and the ACP fork in plugin 18, which must cut at the turn's end |
| [20 - A changes URI opens in a client that normalises it](host/20-a-changes-uri-survives-a-client/plan.md) | high | built 2026-09-28 ([implemented.md](host/20-a-changes-uri-survives-a-client/implemented.md)) | host 21 | - |
| [21 - The commit operation asks first, and commits what is staged when anything is](host/21-commit-asks-and-takes-what-is-staged/plan.md) | high | built 2026-09-28 ([implemented.md](host/21-commit-asks-and-takes-what-is-staged/implemented.md)) | - | host 20 |
| [22 - A file or a folder is staged and unstaged from the session's changeset](host/22-a-file-or-folder-is-staged-from-the-session/plan.md) | high | built 2026-09-28 ([implemented.md](host/22-a-file-or-folder-is-staged-from-the-session/implemented.md)) | host 21 | - |
| [23 - A session outside the configured paths has its git facts and its changes without waiting for a turn](host/23-a-session-outside-the-paths-has-its-facts/plan.md) | high | built 2026-09-28 ([implemented.md](host/23-a-session-outside-the-paths-has-its-facts/implemented.md)) | - | - |
| [24 - An approval offers the agent's own options, and the one picked reaches the agent](host/24-an-approval-offers-the-agents-own-options/plan.md) | high | built 2026-09-28 ([implemented.md](host/24-an-approval-offers-the-agents-own-options/implemented.md)) | - | - |
| [25 - A forked chat says which chat and turn it came from](host/25-a-forked-chat-says-where-it-came-from/plan.md) | medium | built 2026-09-28 ([implemented.md](host/25-a-forked-chat-says-where-it-came-from/implemented.md)) | - | - |
| [26 - The session's changes read git's status right, from any folder](host/26-the-changeset-reads-git-status-right/plan.md) | high | built 2026-09-29 ([implemented.md](host/26-the-changeset-reads-git-status-right/implemented.md)) | - | - |
| [27 - A session reads as running while any of its chats runs, a worker chat included](host/27-a-session-reads-running-while-any-chat-runs/plan.md) | high | built 2026-09-28 ([implemented.md](host/27-a-session-reads-running-while-any-chat-runs/implemented.md)) | - | - |

| [28 - A changeset watch says when it is armed, and nothing between the first read and the watch is missed](host/28-a-changeset-watch-says-when-it-is-armed/plan.md) | high | built 2026-09-28 ([implemented.md](host/28-a-changeset-watch-says-when-it-is-armed/implemented.md)) | - | - |

| [29 - A session that is not running shows its own folder, and its changes follow git](host/29-a-session-not-running-follows-its-own-folder/plan.md) | high | built 2026-09-29 ([implemented.md](host/29-a-session-not-running-follows-its-own-folder/implemented.md)) | - | - |

| [30 - A session is listed under its provider's name, whatever a client created it as, so VS Code opens it](host/30-a-session-is-listed-under-its-providers-name/plan.md) | high | active 2026-09-30; tasks 01-04 and 07-10 implemented, 05 doing (checks by hand left), 06 todo | - | - |
| [31 - A session's config outlives a restart, and a stored value the schema no longer offers falls back to the default](host/31-a-sessions-config-outlives-a-restart/plan.md) | high | active 2026-09-30; tasks 01, 02 implemented | - | claude 10 |
| [32 - The session store is a file per session, and it forgets what no longer exists](host/32-the-session-store-is-a-file-per-session/plan.md) | medium | built 2026-10-02 ([implemented.md](host/32-the-session-store-is-a-file-per-session/implemented.md)) | host 31 | - |
| [33 - A session tool acts as the person it works for, within VS Code's limits, and can be switched off](host/33-a-session-tool-acts-as-the-person-it-works-for/plan.md) | high | planned 2026-09-30; task files to write, tasks 01-03 todo | host 30 | - |

| [34 - A session and an automation say who owns them, and a turn says who sent it](host/34-work-says-who-owns-it/plan.md) | high | built 2026-10-02 ([implemented.md](host/34-work-says-who-owns-it/implemented.md)) | - | usage meters; shares the turn sender with host 33 |

| [35 - A person belongs to teams and projects, and work names which one it is for](host/35-a-person-belongs-to-teams-and-projects/plan.md) | high | built 2026-10-01 ([implemented.md](host/35-a-person-belongs-to-teams-and-projects/implemented.md)) | - | host 34's scope, the proxy listener, policy |
| [36 - Users, teams, projects and roles are resources a client lists and edits](host/36-people-are-resources-a-client-manages/plan.md) | medium | built 2026-10-02 ([implemented.md](host/36-people-are-resources-a-client-manages/implemented.md)) | host 35 | ahpapp people/01, usage 04 |
| [37 - A session two harnesses both list is listed once, under the harness it runs on](host/37-a-session-is-listed-once-under-its-own-harness/plan.md) | high | built 2026-10-02 ([implemented.md](host/37-a-session-is-listed-once-under-its-own-harness/implemented.md)) | claude 12 | - |
| [38 - A client sees who owns a session and who sent each turn](host/38-a-client-sees-who-sent-each-turn/plan.md) | medium | built 2026-10-02 ([implemented.md](host/38-a-client-sees-who-sent-each-turn/implemented.md)) | host 34 | ahpapp chat/02 |
| [39 - The pull request pill and the worktree's files come back in VS Code 1.140](host/39-what-vs-code-1140-stopped-reading/plan.md) | high | built 2026-10-02 ([implemented.md](host/39-what-vs-code-1140-stopped-reading/implemented.md)) | - | ahpc and ahpapp send the include files as a list |

Next free number in `host`: `40`.

## claude

Reference: [00-claude.md](claude/00-claude.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Host tools load when the instruction says so, and a customization keeps its source](claude/01-host-tools-and-customizations/plan.md) | high | built 2026-09-20 ([implemented.md](claude/01-host-tools-and-customizations/implemented.md)) | research/claude-customization-attribution.md | - |
| [02 - A response round that ends empty is announced, or the gap is recorded](claude/02-round-ended/plan.md) | medium | built 2026-09-20 ([implemented.md](claude/02-round-ended/implemented.md)) | research/response-round-ended-signal.md | ahpc screen/02, which reads the notification; the gap is in [deferred.md](claude/02-round-ended/deferred.md) |
| [03 - A model round that ends empty is announced](claude/03-an-empty-round-is-announced/plan.md) | medium | built 2026-09-26 ([implemented.md](claude/03-an-empty-round-is-announced/implemented.md)) | claude 02 | - |
| [04 - A subagent has its own chat, linked from the call that started it](claude/04-a-subagent-has-its-own-chat/plan.md) | medium | built 2026-09-28 ([implemented.md](claude/04-a-subagent-has-its-own-chat/implemented.md)) | claude 03 | - |
| [05 - A replayed Claude exchange is one turn, as it was live](claude/05-a-replayed-exchange-is-one-turn/plan.md) | high | built 2026-09-28 ([implemented.md](claude/05-a-replayed-exchange-is-one-turn/implemented.md)) | - | - |
| [06 - A stop in a worker chat stops that worker, unless configured to stop the session](claude/06-a-stop-in-a-worker-chat-stops-that-worker/plan.md) | medium | built 2026-09-28 ([implemented.md](claude/06-a-stop-in-a-worker-chat-stops-that-worker/implemented.md)) | claude 04 | - |
| [07 - A Claude turn ends with no tool call left running or waiting](claude/07-a-turn-ends-with-no-call-left-open/plan.md) | high | built 2026-09-28 ([implemented.md](claude/07-a-turn-ends-with-no-call-left-open/implemented.md)) | - | - |

| [08 - A Claude tool call's toolInput is its whole input, and invocationMessage stays the short line](claude/08-tool-input-is-the-whole-input/plan.md) | high | active 2026-09-30; tasks 01-04 implemented, awaiting review | - | - |

| [09 - A message runs on the custom agent it picked](claude/09-a-message-runs-on-the-agent-it-picked/plan.md) | high | planned 2026-09-29; tasks 01-04 todo | - | - |
| [10 - A Claude session runs on a preset, and the ahpd-only chips move into it](claude/10-a-claude-session-runs-on-a-preset/plan.md) | high | active 2026-10-02; tasks 01, 02, 04 done, 03 awaits the ahpapp check | host 31 | - |
| [11 - An answered AskUserQuestion call carries its answers, live and after a restart](claude/11-an-answered-question-carries-its-answers/plan.md) | medium | planned 2026-09-30; tasks 01-03 todo | claude 08 | ahpapp chat/01 |
| [12 - A second Claude harness runs on another endpoint, named on its own and keyed from the daemon's environment](claude/12-a-second-claude-runs-on-another-endpoint/plan.md) | medium | built 2026-10-02 ([implemented.md](claude/12-a-second-claude-runs-on-another-endpoint/implemented.md)) | claude 10 | - |
| [13 - A Claude harness offers the models it is told, written or fetched from an endpoint](claude/13-a-claude-harness-offers-the-models-it-is-told/plan.md) | medium | built 2026-10-02 ([implemented.md](claude/13-a-claude-harness-offers-the-models-it-is-told/implemented.md)) | claude 12 | - |
| [14 - A model the CLI rejects fails the turn that asked for it](claude/14-a-rejected-model-fails-the-turn/plan.md) | high | built 2026-10-02 ([implemented.md](claude/14-a-rejected-model-fails-the-turn/implemented.md)) | claude 13 | - |

Next free number in `claude`: `14`.

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
| [14 - A cofold session has files, shell, web and memory, run by cofold itself](plugin/14-cofold-runs-its-own-tools/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/14-cofold-runs-its-own-tools/implemented.md), [deferred.md](plugin/14-cofold-runs-its-own-tools/deferred.md)) | plugin 03 | container 04 |
| [15 - An agent says what a machine needs, and the machine is made with it](plugin/15-an-agent-says-what-a-machine-needs/plan.md) | high | active 2026-09-26, reviewed; task 06 reopened, fix tasks 08-12 todo | plugin 11 | plugin 16, container 03, container 04 |
| [16 - A disposable machine is made for a session and goes after it](plugin/16-a-disposable-machine/plan.md) | medium | active 2026-09-26, reviewed; fix tasks 05-11 todo | plugin 15 | - |
| [17 - A plugin hears when a session needs a person](plugin/17-a-plugin-hears-a-session-needs-a-person/plan.md) | high | built 2026-10-01 ([implemented.md](plugin/17-a-plugin-hears-a-session-needs-a-person/implemented.md)) | plugin 02 | the notify plugin, which reads the two events |
| [18 - The ACP bridge resumes, forks and asks](plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md) | medium | planned 2026-09-26, after plugin 21; ACP v2 in [deferred.md](plugin/18-the-acp-bridge-resumes-forks-and-asks/deferred.md) | plugin 07, host 19 (task 02 after host 19 task 01) | - |
| [19 - A docker machine may run under gVisor](plugin/19-a-docker-machine-may-run-under-gvisor/plan.md) | low | planned 2026-09-26, after plugin 18 | plugin 10 | - |
| [20 - A plugin is a client of its own host, as a principal of its own](plugin/20-a-plugin-is-a-client-of-its-own-host/plan.md) | high | planned 2026-09-26, after plugin 17 | plugin 01, host 11 | plugin 21, and every gateway, trigger and facade plugin |
| [21 - A plugin serves an HTTP route on the daemon's listener](plugin/21-a-plugin-serves-an-http-route/plan.md) | medium | planned 2026-09-26, after plugin 20; task 02 after daemon 05 tasks 15 and 16 | daemon 05, plugin 20 | webhook, callback and facade plugins |
| [22 - A cofold write lands on the file its check allowed, and not on one that changed since it was read](plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) | medium | planned 2026-09-30; task 01 done, 02-04 todo (02 and 03 in cofold) | plugin 14 | - |
| [23 - A cofold session reopens on the model its turns ran on](plugin/23-a-cofold-session-keeps-its-model/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/23-a-cofold-session-keeps-its-model/implemented.md)) | plugin 14 | - |
| [24 - The log says when each plugin starts loading and how long it took](plugin/24-the-log-times-each-plugin/plan.md) | medium | built 2026-09-28 ([implemented.md](plugin/24-the-log-times-each-plugin/implemented.md)) | plugin 01 | - |
| [25 - A plugin's agent sees every path the daemon serves](plugin/25-a-plugin-agent-sees-every-served-path/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/25-a-plugin-agent-sees-every-served-path/implemented.md)) | plugin 01 | - |
| [26 - A plugin declares a schema for its options, and the loader checks it](plugin/26-a-plugin-declares-its-options-schema/plan.md) | medium | built 2026-09-28 ([implemented.md](plugin/26-a-plugin-declares-its-options-schema/implemented.md)) | daemon 08 | - |

| [27 - An answer given the moment a cofold request opens reaches the run](plugin/27-an-early-answer-reaches-the-paused-run/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/27-an-early-answer-reaches-the-paused-run/implemented.md)) | plugin 03 | - |

| [28 - A test that ends a session waits for its cleanup to finish before removing its folder](plugin/28-a-closed-session-test-waits-for-its-run/plan.md) | high | built 2026-09-29 ([implemented.md](plugin/28-a-closed-session-test-waits-for-its-run/implemented.md)) | plugin 27 | - |

| [29 - A tool call says when it started and how long it ran, live and in history](plugin/29-a-tool-call-says-when-it-ran/plan.md) | medium | planned 2026-09-29; p1-p5 todo | - | - |

| [30 - Two more tests wait for what their session is still doing](plugin/30-two-more-tests-wait-for-their-session/plan.md) | high | built 2026-09-30 ([implemented.md](plugin/30-two-more-tests-wait-for-their-session/implemented.md)) | plugin 28 | - |
| [31 - A plugin file takes the nearest manifest only when it is a plugin's](plugin/31-a-plugin-file-takes-only-a-plugin-manifest/plan.md) | low | active 2026-09-30; task 01 implemented | - | - |

| [32 - A turn's usage is every model call it made, sent as it runs, with the harness's cost](plugin/32-a-turns-usage-is-every-call-it-made/plan.md) | high | built 2026-10-01; p1-p4 | - | the agent meter |

| [33 - A phone hears when a session needs a person](plugin/33-a-phone-hears-a-session-needs-a-person/plan.md) | high | planned 2026-10-02 | plugin 17 | - |

Next free number in `plugin`: `34`.

## container

Reference: [00-container.md](container/00-container.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A session in a dev container, with its whole host inside it](container/01-a-session-in-a-dev-container/plan.md) | high | built 2026-09-24, except its `ahpapp` half ([implemented.md](container/01-a-session-in-a-dev-container/implemented.md)) | plugin 11, plugin 12 | an ahpapp plan, which drives the same four methods |
| [02 - VS Code offers a dev container on a folder served by ahpd](container/02-vscode-offers-our-dev-container/plan.md) | high | planned 2026-09-26, task 01 blocked: the tunnel is not listed in VS Code | container 01 | - |
| [03 - A dev container is a computer, listed and reachable without the connection that made it](container/03-a-dev-container-is-a-computer/plan.md) | medium | active 2026-09-26, reviewed; task 03 unblocked by a flat source choice, task 06 reopened, fix tasks 07-16 todo | container 01, plugin 15 | - |
| [04 - A cofold session in a computer runs in an ahpd started inside it](container/04-a-cofold-session-in-a-computer/plan.md) | medium | active 2026-09-26, reviewed; fix tasks 07-17 todo | plugin 14, plugin 15 | - |
| [05 - An agent in a machine is built once, started fast, and reached from anywhere](container/05-an-agent-in-a-machine/plan.md) | high | planned 2026-09-26, a parent of ten child plans; before more agents and plugins ([deferred.md](container/05-an-agent-in-a-machine/deferred.md)) | plugin 15, plugin 16, container 04 | the next agent and plugin plans |
| [05 p1 - A secret reaches a machine by name](container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md) | high | planned 2026-09-26, tasks 01-03 todo | - | 05 p2 |
| [05 p2 - An ACP spec says what its machine needs](container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md) | high | planned 2026-09-26, tasks 01 and 04 todo; 02 and 03 dropped, moved to acp 04 and acp 05 | 05 p1 | 05 p5 |
| [05 p3 - Parts are built from one versions file](container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md) | high | planned 2026-09-26, tasks 01-06 todo | - | 05 p4 |
| [05 p4 - A part is mounted into a machine](container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md) | high | planned 2026-09-26, tasks 01-06 todo | 05 p3 | 05 p5 |
| [05 p5 - Agents run from their parts and keep their own state](container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md) | high | planned 2026-09-26, tasks 01-08 todo; pi joins cofold's nested route | 05 p2, 05 p4, 05 p6, acp 05 | 05 p8, 05 p9 |
| [05 p6 - An agent's configuration lives in a volume per profile](container/05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/plan.md) | high | planned 2026-09-26, tasks 01-04 todo | - | 05 p5 |
| [05 p7 - A worktree reaches its machine with its repository](container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md) | high | planned 2026-09-26, tasks 01-04 todo | plugin 16 | 05 p8 |
| [05 p8 - A profile's machines may live on another Docker](container/05-an-agent-in-a-machine-p8-a-profile-on-another-docker/plan.md) | medium | draft 2026-09-26 | 05 p5, 05 p7 | - |
| [05 p9 - An ssh machine runs a nested host](container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md) | medium | draft 2026-09-26 | 05 p5 | 05 p10 |
| [05 p10 - A host joins another, which relays its sessions](container/05-an-agent-in-a-machine-p10-a-host-joins-a-hub/plan.md) | medium | draft 2026-09-26 | 05 p9 | - |

Next free number in `container`: `06`.

## pi

Reference: [00-pi.md](pi/00-pi.md)

Worked in this order: 01, 02, 09, 10, then 03, 04, host 19, 05, 06, 07.

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A pi turn can be truncated, one that failed at the provider says so, and the configured model is used](pi/01-a-turn-ends-as-it-ended/plan.md) | high | built 2026-09-28 ([implemented.md](pi/01-a-turn-ends-as-it-ended/implemented.md)) | - | pi 04, pi 05 |
| [02 - Host and client tools reach pi](pi/02-host-and-client-tools-reach-pi/plan.md) | high | built 2026-09-28 ([implemented.md](pi/02-host-and-client-tools-reach-pi/implemented.md)) | - | pi 03, pi 09 |
| [03 - The host's instructions reach pi's system prompt](pi/03-the-host-instructions-reach-pi/plan.md) | medium | built 2026-09-28 ([implemented.md](pi/03-the-host-instructions-reach-pi/implemented.md)) | pi 02 | - |
| [04 - A pi turn reports what it used](pi/04-a-turn-reports-its-usage/plan.md) | medium | built 2026-09-28 ([implemented.md](pi/04-a-turn-reports-its-usage/implemented.md)) | pi 01 | - |
| [05 - A pi chat forks from a turn](pi/05-a-chat-forks-from-a-turn/plan.md) | medium | built 2026-10-02 ([implemented.md](pi/05-a-chat-forks-from-a-turn/implemented.md)) | pi 01, host 19 | - |
| [06 - pi's edits reach the host's changesets](pi/06-pi-edits-reach-the-changesets/plan.md) | medium | built 2026-09-28 ([implemented.md](pi/06-pi-edits-reach-the-changesets/implemented.md)) | - | - |
| [07 - Input from a client is tagged as not the terminal's](pi/07-remote-input-is-tagged/plan.md) | low | built 2026-09-28 ([implemented.md](pi/07-remote-input-is-tagged/implemented.md)) | - | - |
| [08 - A pi session store can move between hosts](pi/08-a-session-store-can-move/plan.md) | low | dropped 2026-09-26 | - | - |
| [09 - pi asks a person before a tool runs](pi/09-pi-asks-before-a-tool-runs/plan.md) | high | built 2026-09-28 ([implemented.md](pi/09-pi-asks-before-a-tool-runs/implemented.md)) | pi 02 | - |
| [10 - pi's models and history outlive the process, and pi loads without holding the daemon](pi/10-pi-outlives-the-process/plan.md) | high | built 2026-09-28 ([implemented.md](pi/10-pi-outlives-the-process/implemented.md)) | pi 01 | - |
| [11 - A turn's parts come in the order the model wrote them, one part per block](pi/11-a-turns-parts-come-in-the-order-they-were-written/plan.md) | high | built 2026-09-28 ([implemented.md](pi/11-a-turns-parts-come-in-the-order-they-were-written/implemented.md)) | pi 10 | - |
| [12 - A tool call says what it runs on, on pi, cofold and Claude live](pi/12-a-tool-call-says-what-it-runs-on/plan.md) | medium | built 2026-09-28 ([implemented.md](pi/12-a-tool-call-says-what-it-runs-on/implemented.md)) | - | - |
| [13 - A model pi cannot find fails the turn that asked for it](pi/13-a-model-pi-cannot-find-fails-the-turn/plan.md) | high | built 2026-10-02 ([implemented.md](pi/13-a-model-pi-cannot-find-fails-the-turn/implemented.md)) | - | - |

Next free number in `pi`: `13`.

## acp

Reference: [00-acp.md](acp/00-acp.md)

Worked in this order: 01, 02, plugin 18, 03, 04, 05, then 06, 08, 09 and 10 in any order, 12; 07 is dropped into host 24; 11 is planned after daemon 11.

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The bridge survives its agent: a bad command, a dying server and a close](acp/01-the-bridge-survives-its-agent/plan.md) | high | built 2026-10-02 ([implemented.md](acp/01-the-bridge-survives-its-agent/implemented.md)) | - | acp 12 |
| [02 - Replay lands in the session's history, never in its next turn](acp/02-replay-lands-in-history/plan.md) | high | built 2026-10-02 ([implemented.md](acp/02-replay-lands-in-history/implemented.md)) | - | plugin 18, acp 01 task 03 |
| [03 - A turn ends as the agent ended it](acp/03-a-turn-ends-as-the-agent-ended-it/plan.md) | high | built 2026-10-02 ([implemented.md](acp/03-a-turn-ends-as-the-agent-ended-it/implemented.md)) | - | - |
| [04 - The bridge signs in, and says when an agent needs it](acp/04-the-bridge-signs-in/plan.md) | high | planned 2026-09-26, tasks 01-03 todo | - | acp 05 |
| [05 - A spec can name a preset for a known ACP agent](acp/05-presets/plan.md) | medium | planned 2026-09-26, tasks 01-02 todo | acp 04 | container 05 p5 |
| [06 - Tool calls say what happened, and an agent's edits reach review](acp/06-tool-calls-say-what-happened/plan.md) | medium | planned 2026-09-26, tasks 01-04 todo | - | - |
| [07 - A person answers with the agent's own permission options](acp/07-the-agents-own-permission-options/plan.md) | medium | dropped 2026-09-28, built in host 24 | - | - |
| [08 - Usage, title, plan and mode changes reach the client](acp/08-session-updates-reach-the-client/plan.md) | medium | planned 2026-09-26, tasks 01-04 todo | - | acp 09 |
| [09 - Every option an agent offers is a control](acp/09-every-config-option-is-a-control/plan.md) | medium | planned 2026-09-26, tasks 01-02 todo | acp 08 | - |
| [10 - A prompt carries what the agent accepts, and only what it accepts](acp/10-a-prompt-carries-what-the-agent-accepts/plan.md) | medium | planned 2026-09-26, tasks 01-02 todo | - | - |
| [11 - The agent gets the host's MCP servers](acp/11-the-agent-gets-mcp-servers/plan.md) | medium | planned 2026-09-30; tasks 01-05 todo | daemon 11 | - |
| [12 - The bridge is on the current SDK entry, and lists sessions properly](acp/12-the-bridge-is-on-the-current-sdk/plan.md) | low | planned 2026-09-26, tasks 01-02 todo | acp 01 | - |

Next free number in `acp`: `13`.

## usage

Reference: [00-usage.md](usage/00-usage.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Usage is kept behind one port, model use and computer time, with live totals](usage/01-usage-is-kept-behind-one-port/plan.md) | high | built 2026-10-01 ([implemented.md](usage/01-usage-is-kept-behind-one-port/implemented.md)) | - | the meters and the policy plans |
| [02 - A turn writes what it used to the usage store, charged to its owner, team and project](usage/02-a-turn-writes-what-it-used/plan.md) | high | built 2026-10-02 ([implemented.md](usage/02-a-turn-writes-what-it-used/implemented.md)) | usage 01, host 34, host 35 | policy |
| [03 - A machine records who created it and writes the time it was up, charged to its owner](usage/03-a-machine-writes-its-up-time/plan.md) | high | built 2026-10-02 ([implemented.md](usage/03-a-machine-writes-its-up-time/implemented.md)) | usage 01, host 34 | - |
| [04 - A client reads what a pool spent, and the records behind it, through a usage scheme](usage/04-usage-is-read-through-a-scheme/plan.md) | high | built 2026-10-02 ([implemented.md](usage/04-usage-is-read-through-a-scheme/implemented.md)) | usage 02, usage 03, host 36 | ahpapp usage/01, policy |

Next free number in `usage`: `05`.

## policy

Reference: [00-policy.md](policy/00-policy.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A policy says who may use which agent, model and computer](policy/01-a-policy-says-who-may-use-what/plan.md) | high | built 2026-10-02 ([implemented.md](policy/01-a-policy-says-who-may-use-what/implemented.md)) | host 36 | policy 02, proxy 02 |

Next free number in `policy`: `02`.

## proxy

Reference: [00-proxy.md](proxy/00-proxy.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The proxy knows its providers and model names](proxy/01-the-proxy-knows-its-providers-and-models/plan.md) | high | built 2026-10-01 ([implemented.md](proxy/01-the-proxy-knows-its-providers-and-models/implemented.md)) | - | the proxy listener |

Next free number in `proxy`: `02`.

## Domains without a plan

None. `host`, `claude`, `documentation`, `plugin`, `container`, `pi`, `acp`, `usage` and `proxy` each have a plan above.
Ideas: [agents as extensions](../ideas/agents-as-extensions.md), [an SSH command that attaches to the daemon](../ideas/an-ssh-command-that-attaches-to-the-daemon.md), [a plugin reloads without a restart](../ideas/a-plugin-reloads-without-a-restart.md), [a secret store](../ideas/a-secret-store.md), [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md), [deliberate duplication](../ideas/deliberate-duplication.md), [terminal commands approved by rule](../ideas/terminal-commands-approved-by-rule.md), [turn and model-call diagnostics](../ideas/turn-and-model-call-diagnostics.md), [verify a JWT locally](../ideas/verify-a-jwt-locally.md), [failures have a JSON shape](../ideas/failures-have-a-json-shape.md), [more computer runtimes](../ideas/more-computer-runtimes.md), [plugins, beyond agents](../ideas/plugins.md), [presets are harnesses](../ideas/presets-are-harnesses.md), [repositories are resources](../ideas/repositories-are-resources.md), [issues follow the repository](../ideas/issues-follow-the-repository.md), [a sqlite store](../ideas/a-sqlite-store.md), [a postgresql store](../ideas/a-postgresql-store.md), [initiators start sessions](../ideas/initiators-start-sessions.md), [agents report their plan](../ideas/agents-report-their-plan.md), [cofold speaks ACP through papo](../ideas/cofold-speaks-acp-through-papo.md).
