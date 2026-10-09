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
| [09 - A plugin update moves all or the named plugins](daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) | high | built 2026-10-08 ([implemented.md](daemon/09-a-plugin-update-moves-every-plugin-together/implemented.md)); every task done and merged (12 e5134da, 01 and 04 f1acaba), 05 and 07 dropped | - | - |

| [10 - `ahpd configure` sets the daemon up, and a first start at a terminal offers it](daemon/10-a-first-run-sets-the-daemon-up/plan.md) | medium | built 2026-10-02 ([implemented.md](daemon/10-a-first-run-sets-the-daemon-up/implemented.md)) | daemon 09 | - |
| [11 - Root config carries the daemon's settings and each plugin's options, and a client edits them](daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md) | high | built 2026-10-02 ([implemented.md](daemon/11-root-config-carries-the-daemon-and-its-plugins/implemented.md)) | - | - |
| [12 - A plugin option is set from the command line, in the file or for one run](daemon/12-a-plugin-option-is-set-from-the-command-line/plan.md) | medium | built 2026-10-04 ([implemented.md](daemon/12-a-plugin-option-is-set-from-the-command-line/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65; by-hand checks not run | - | - |
| [13 - `ahpd restart` restarts the daemon in place, and refuses while a turn runs](daemon/13-ahpd-restart/plan.md) | high | active 2026-09-30; tasks 01-03 done (reviewed, fixed in host 64), 04 todo | - | - |
| [14 - The daemon log rotates at start](daemon/14-the-daemon-log-rotates-at-start/plan.md) | low | built 2026-10-02 ([implemented.md](daemon/14-the-daemon-log-rotates-at-start/implemented.md)) | - | - |
| [15 - A verb declares only the flags it reads](daemon/15-a-verb-declares-only-its-own-flags/plan.md) | medium | built 2026-10-06 ([implemented.md](daemon/15-a-verb-declares-only-its-own-flags/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | - | - |
| [16 - A command says what it does to what, and the daemon serves on the cofold that checks it](daemon/16-a-command-says-what-it-does-to-what/plan.md) | high | built 2026-10-06 ([implemented.md](daemon/16-a-command-says-what-it-does-to-what/implemented.md)) | cofold commands/03, commands/04 | ahpd-web resource screens |

Next free number in `daemon`: `17`.

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

| [30 - A session is listed under its provider's name, whatever a client created it as, so VS Code opens it](host/30-a-session-is-listed-under-its-providers-name/plan.md) | high | active 2026-09-30; tasks 01-04 and 07-10 done (reviewed, fixed in host 64), 05 doing (checks by hand left), 06 done | - | - |
| [31 - A session's config outlives a restart, and a stored value the schema no longer offers falls back to the default](host/31-a-sessions-config-outlives-a-restart/plan.md) | high | built 2026-10-07 ([implemented.md](host/31-a-sessions-config-outlives-a-restart/implemented.md)); tasks 01, 02 reviewed 2026-10-06 | - | claude 10 |
| [32 - The session store is a file per session, and it forgets what no longer exists](host/32-the-session-store-is-a-file-per-session/plan.md) | medium | built 2026-10-02 ([implemented.md](host/32-the-session-store-is-a-file-per-session/implemented.md)) | host 31 | - |
| [33 - A session tool acts as the person it works for, within VS Code's limits, and can be switched off](host/33-a-session-tool-acts-as-the-person-it-works-for/plan.md) | high | planned 2026-09-30; task files to write, tasks 01-03 todo | host 30 | - |

| [34 - A session and an automation say who owns them, and a turn says who sent it](host/34-work-says-who-owns-it/plan.md) | high | built 2026-10-02 ([implemented.md](host/34-work-says-who-owns-it/implemented.md)) | - | usage meters; shares the turn sender with host 33 |

| [35 - A person belongs to teams and projects, and work names which one it is for](host/35-a-person-belongs-to-teams-and-projects/plan.md) | high | built 2026-10-01 ([implemented.md](host/35-a-person-belongs-to-teams-and-projects/implemented.md)) | - | host 34's scope, the proxy listener, policy |
| [36 - Users, teams, projects and roles are resources a client lists and edits](host/36-people-are-resources-a-client-manages/plan.md) | medium | built 2026-10-02 ([implemented.md](host/36-people-are-resources-a-client-manages/implemented.md)) | host 35 | ahpapp people/01, usage 04 |
| [37 - A session two harnesses both list is listed once, under the harness it runs on](host/37-a-session-is-listed-once-under-its-own-harness/plan.md) | high | built 2026-10-02 ([implemented.md](host/37-a-session-is-listed-once-under-its-own-harness/implemented.md)) | claude 12 | - |
| [38 - A client sees who owns a session and who sent each turn](host/38-a-client-sees-who-sent-each-turn/plan.md) | medium | built 2026-10-02 ([implemented.md](host/38-a-client-sees-who-sent-each-turn/implemented.md)) | host 34 | ahpapp chat/02 |
| [39 - The pull request pill and the worktree's files come back in VS Code 1.140](host/39-what-vs-code-1140-stopped-reading/plan.md) | high | built 2026-10-02 ([implemented.md](host/39-what-vs-code-1140-stopped-reading/implemented.md)) | - | ahpc and ahpapp send the include files as a list |
| [40 - A connection is told who it is signed in as](host/40-a-connection-is-told-who-it-is/plan.md) | high | built 2026-10-03 ([implemented.md](host/40-a-connection-is-told-who-it-is/implemented.md)) | host 36 | ahpapp people/01 |
| [41 - A failure belongs to the item that failed, and a start says what it skipped](host/41-a-failure-belongs-to-the-item-that-failed/plan.md) | high | built 2026-10-03 ([implemented.md](host/41-a-failure-belongs-to-the-item-that-failed/implemented.md)) | claude 15 | - |
| [42 - An automation's owner rides in _meta, where the protocol has room for it](host/42-an-automation-owner-rides-in-meta/plan.md) | high | built 2026-10-03 ([implemented.md](host/42-an-automation-owner-rides-in-meta/implemented.md)) | - | host 40 |
| [43 - The wire is the protocol's, and the wire test proves every frame against AHP 1.0.0](host/43-the-wire-is-the-protocols/plan.md) | high | active 2026-10-07; p1 and p2 built, tasks implemented; p3-p4 planned, retargeted to 1.0.0 | host 44 p1 | ahpc run paging; ahpapp and ahpc `_meta` readers |
| [43 p1 - The wire test checks every request, result and notification against the protocol](host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md) | high | built 2026-10-07 ([implemented.md](host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/implemented.md)) | host 43, host 44 p1 | 43 p2, 43 p3, 43 p4 |
| [43 p2 - Results and actions are the protocol's shapes](host/43-the-wire-is-the-protocols-p2-results-and-actions-are-the-protocols/plan.md) | high | built 2026-10-07 ([implemented.md](host/43-the-wire-is-the-protocols-p2-results-and-actions-are-the-protocols/implemented.md)) | host 43 p1, host 44 p1 | ahpc `automationRuns` |
| [43 p3 - The root config schema is one a client can read](host/43-the-wire-is-the-protocols-p3-the-root-config-schema-conforms/plan.md) | high | built 2026-10-07 ([implemented.md](host/43-the-wire-is-the-protocols-p3-the-root-config-schema-conforms/implemented.md)) | host 43 p1, daemon 11, host 44 p1 | - |
| [43 p4 - Every `_meta` key ahpd invents is named `ahpd.<name>`](host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) | high | active 2026-10-08; task 01 done (85b0dc4, [implemented.md](host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/implemented.md)), 02-04 done (995f0ce), 05 todo and waits on ahpapp sending `ahpd.commit` | host 43 p1, host 44 p1 | - |
| [44 - ahpd speaks AHP 1.0.0, and keeps 0.9.0](host/44-ahpd-speaks-ahp-1-0-0/plan.md) | high | planned 2026-10-03; p1-p3 planned | - | ahpapp and ahpc moving to the 1.0.0 package; host 43 |
| [44 p1 - ahpd speaks 1.0.0 and 0.9.0](host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md) | high | built 2026-10-03 ([implemented.md](host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/implemented.md)) | host 44 | 44 p2, 44 p3, host 43, ahpapp on 1.0.0 |
| [44 p2 - An automation disables itself as its definition says, and a kind given twice is refused](host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/plan.md) | medium | planned 2026-10-03; tasks 01-02 todo | host 44 p1 | - |
| [44 p3 - A session's row lists its chats with their status, and a chat is read or archived on its own](host/44-ahpd-speaks-ahp-1-0-0-p3-a-sessions-row-lists-its-chats/plan.md) | high | planned 2026-10-03; tasks 01-02 todo | host 44 p1 | - |
| [45 - The root config declares every value it holds, as VS Code's agent host declares it](host/45-root-config-declares-every-value-it-holds/plan.md) | medium | planned 2026-10-03; tasks 01-04 todo | host 44 p1, host 43 p1, host 43 p3 | - |
| [46 - The host's own surfaces are advertised with their operations, and a role grants an operation](host/46-built-in-surfaces-are-advertised-for-role-control/plan.md) | medium | built 2026-10-04 ([implemented.md](host/46-built-in-surfaces-are-advertised-for-role-control/implemented.md)); tasks implemented, awaiting review | host 44 p1 | ahpapp people/01's role editor |
| [47 - ahpd serves what AHP 1.0.0 added](host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md) | medium | planned 2026-10-03; p1-p6 planned, canvas left out, Softov's three answers in; p1 goes past VS Code | host 44 p1 | - |
| [47 p1 - A chat is reordered in its session, or moved to another session of the same agent and machine](host/47-ahpd-serves-what-ahp-1-0-0-added-p1-moving-a-chat/plan.md) | medium | planned 2026-10-03; task 01 dropped, 04 then 02-03 todo; cross-agent and cross-machine moves deferred | host 47, host 44 p1, host 50 | - |
| [47 p2 - A chat lists the shells and subagents running in its background](host/47-ahpd-serves-what-ahp-1-0-0-added-p2-a-chat-lists-its-background-work/plan.md) | medium | planned 2026-10-03; tasks 01-02 todo | host 47, host 44 p1 | - |
| [47 p3 - A blocking MCP server startup can be sent to the background](host/47-ahpd-serves-what-ahp-1-0-0-added-p3-an-mcp-server-startup-can-be-backgrounded/plan.md) | low | planned 2026-10-03; task 01 todo | host 47, host 44 p1 | - |
| [47 p4 - A file edit is the protocol's type, and a Claude write confirmation previews its edit](host/47-ahpd-serves-what-ahp-1-0-0-added-p4-a-file-edit-is-the-protocols-type/plan.md) | low | planned 2026-10-03; tasks 01-02 todo | host 47, host 44 p1 | - |
| [47 p5 - An automation carries the client plugins its template names](host/47-ahpd-serves-what-ahp-1-0-0-added-p5-an-automation-carries-client-plugins/plan.md) | low | planned 2026-10-03; task 01 todo, 02 waits on host 49 | host 47, host 44 p1, host 49 | - |
| [47 p6 - A changeset being recomputed says so, and keeps its files](host/47-ahpd-serves-what-ahp-1-0-0-added-p6-a-changeset-says-it-is-recomputing/plan.md) | low | planned 2026-10-03; task 01 todo | host 47, host 44 p1 | - |
| [48 - host.ts is split into one file per area, and the URI routing and the grant tables are files of their own](host/48-host-is-split-by-area/plan.md) | high | built 2026-10-07 ([implemented.md](host/48-host-is-split-by-area/implemented.md)); p9-p11 reviewed and merged 2026-10-06, fixes in host 65 | plugin 29 | host 43, host 44 p2, host 44 p3, host 45, host 46, host 47 |
| [48 p1 - The grant tables and the URI names are files of their own](host/48-host-is-split-by-area-p1-the-grant-and-uri-tables/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-host-is-split-by-area-p1-the-grant-and-uri-tables/implemented.md)) | host 48, plugin 29 | 48 p2 |
| [48 p2 - The URI routing, the client relay and the connection gate are files of their own](host/48-host-is-split-by-area-p2-routing/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-host-is-split-by-area-p2-routing/implemented.md)) | host 48 p1 | 48 p3, 48 p4 |
| [48 p3 - Changesets and git and GitHub facts are files of their own, and the repository ports live in repo/](host/48-host-is-split-by-area-p3-changesets-and-facts/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-host-is-split-by-area-p3-changesets-and-facts/implemented.md)) | host 48 p2 | 48 p6 |
| [48 p4 - Telemetry, sign-in requirements, owners and machines are files of their own](host/48-host-is-split-by-area-p4-telemetry-owners-and-machines/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-host-is-split-by-area-p4-telemetry-owners-and-machines/implemented.md)) | host 48 p2 | 48 p5 |
| [48 p5 - Session config and root config are files of their own](host/48-host-is-split-by-area-p5-session-and-root-config/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p5-session-and-root-config/implemented.md)) | host 48 p4 | 48 p6 |
| [48 p6 - The catalogue, past sessions and snapshots are files of their own](host/48-host-is-split-by-area-p6-catalogue-and-transcripts/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p6-catalogue-and-transcripts/implemented.md)) | host 48 p3, host 48 p5 | 48 p7 |
| [48 p7 - Starting, restarting and removing a session are files of their own](host/48-host-is-split-by-area-p7-session-lifecycle/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p7-session-lifecycle/implemented.md)) | host 48 p6 | 48 p8 |
| [48 p8 - Session tools, terminals and automations are files of their own](host/48-host-is-split-by-area-p8-tools-terminals-and-automations/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p8-tools-terminals-and-automations/implemented.md)) | host 48 p7 | 48 p9 |
| [48 p9 - The method table is split by family](host/48-host-is-split-by-area-p9-the-method-table/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p9-the-method-table/implemented.md)) | host 48 p8 | 48 p10 |
| [48 p10 - Action dispatch is split by family](host/48-host-is-split-by-area-p10-action-dispatch/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p10-action-dispatch/implemented.md)) | host 48 p9 | 48 p11 |
| [48 p11 - Open plans cite the new files](host/48-host-is-split-by-area-p11-open-plans-cite-the-new-files/plan.md) | medium | built 2026-10-04 ([implemented.md](host/48-host-is-split-by-area-p11-open-plans-cite-the-new-files/implemented.md)) | host 48 p10 | - |
| [49 - A session loads the plugins a client hands it](host/49-a-session-loads-a-clients-plugins/plan.md) | medium | planned 2026-10-03; tasks 01-04 todo, 30 s disconnect grace per Softov | host 44 p1 | host 47 p5 |
| [50 - A peer chat is its own conversation, and survives a restart](host/50-a-peer-chat-is-its-own-conversation/plan.md) | high | planned 2026-10-03; tasks 01-03 todo | - | host 47 p1 |
| [51 - A user put clears its issuer and roles-from when it says null](host/51-a-user-put-clears-issuer-and-roles-from/plan.md) | medium | built 2026-10-03 ([implemented.md](host/51-a-user-put-clears-issuer-and-roles-from/implemented.md)) | host 36 | - |
| [52 - Deleting a session deletes the backend's copy, and a listed row can be deleted](host/52-deleting-a-session-deletes-the-backends-copy/plan.md) | high | built 2026-10-04 ([implemented.md](host/52-deleting-a-session-deletes-the-backends-copy/implemented.md)); tasks implemented, awaiting review | - | - |
| [53 - ahpd.grants lists every subject a role can name, the schemes included](host/53-ahpd-grants-lists-every-scheme/plan.md) | high | built 2026-10-04 ([implemented.md](host/53-ahpd-grants-lists-every-scheme/implemented.md)); tasks implemented, awaiting review | host 46 | ahpapp people/01's role editor |
| [54 - host.test.ts is split into one test file per area, with its helpers in one module](host/54-host-test-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](host/54-host-test-is-split-by-area/implemented.md)); tasks implemented, awaiting review | - | - |
| [55 - users-gate.test.ts is split into one test file per area, with its shared helpers in one module](host/55-users-gate-test-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](host/55-users-gate-test-is-split-by-area/implemented.md)); tasks implemented, awaiting review | - | - |
| [56 - The catalogue answers at once, and a summary is sent only when it changes](host/56-the-catalogue-answers-at-once-and-a-summary-is-sent-when-it-changes/plan.md) | high | active 2026-10-04; tasks 01-04 done (reviewed, fixed in host 64); 05 by hand | - | - |
| [57 - pi, cofold and ACP find a session by id, and the listing throttle goes](host/57-pi-cofold-and-acp-find-a-session-by-id/plan.md) | high | built 2026-10-06 ([implemented.md](host/57-pi-cofold-and-acp-find-a-session-by-id/implemented.md)) | host 56 | - |
| [58 - Policy and automation files are private, a cursor the host did not issue is refused, and a file URI is decoded](host/58-private-files-refused-cursors-and-decoded-file-uris/plan.md) | high | built 2026-10-06 ([implemented.md](host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | - | host 59, host 60 |
| [59 - People and policy are served by one record-store provider, and the value readers are one sdk module](host/59-one-record-store-provider-and-shared-value-helpers/plan.md) | medium | planned 2026-10-05; tasks 01-07 todo | host 58 | host 61, host 60 task 04 |
| [60 - JSON files are read and written through one helper, and the session store keeps one row per session](host/60-one-json-file-reader-and-writer-and-a-session-is-one-row/plan.md) | medium | planned 2026-10-05; tasks 01-06 todo | host 58 | - |
| [61 - The agents share their status, activity, title and preset reading, and the host checks tool inputs and request params one way](host/61-agents-share-their-session-kit-presets-and-input-checks/plan.md) | medium | planned 2026-10-05; tasks 01-06 todo | host 59 | - |
| [62 - Every backend calls a client's tool, acp, cofold, pi and claude, the way the protocol asks](host/62-every-backend-calls-a-clients-tool/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-every-backend-calls-a-clients-tool/implemented.md)); every child reviewed and merged 2026-10-06 | acp 11 | - |
| [62 p1 - The sdk holds a client call, raises it for the client, and runs one for the tool server](host/62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/implemented.md)); reviewed and merged 2026-10-06 | host 62 | 62 p2, 62 p3, 62 p4 |
| [62 p2 - Claude runs its client calls through the sdk](host/62-every-backend-calls-a-clients-tool-p2-claude-runs-client-calls-through-the-sdk/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-every-backend-calls-a-clients-tool-p2-claude-runs-client-calls-through-the-sdk/implemented.md), [deferred.md](host/62-every-backend-calls-a-clients-tool-p2-claude-runs-client-calls-through-the-sdk/deferred.md)); reviewed and merged 2026-10-06 | host 62 p1 | - |
| [62 p3 - pi and cofold run their client calls through the sdk](host/62-every-backend-calls-a-clients-tool-p3-pi-and-cofold-run-client-calls-through-the-sdk/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-every-backend-calls-a-clients-tool-p3-pi-and-cofold-run-client-calls-through-the-sdk/implemented.md)); reviewed and merged 2026-10-06 | host 62 p1 | - |
| [62 p4 - An ACP agent calls a client's tool](host/62-every-backend-calls-a-clients-tool-p4-an-acp-agent-calls-a-clients-tool/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-every-backend-calls-a-clients-tool-p4-an-acp-agent-calls-a-clients-tool/implemented.md), [deferred.md](host/62-every-backend-calls-a-clients-tool-p4-an-acp-agent-calls-a-clients-tool/deferred.md)); reviewed and merged 2026-10-06 | host 62 p1, acp 11 | - |
| [63 - Worktrees can live under one root](host/63-worktrees-can-live-under-one-root/plan.md) | medium | built 2026-10-06; reviewed and merged 2026-10-06 | - | - |
| [64 - What the review of host/30, host/56, daemon/13 and claude/10 found is fixed](host/64-what-the-review-of-host-30-and-56-found/plan.md) | high | built 2026-10-06 ([implemented.md](host/64-what-the-review-of-host-30-and-56-found/implemented.md)); reviewed and merged 2026-10-06 | host 30, host 56, daemon 13, claude 10 | - |
| [65 - What the review of the nine built plans found is fixed](host/65-what-the-review-of-the-nine-built-plans-found/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found/implemented.md)); p1-p6 reviewed and merged 2026-10-06; the nine reviewed plans' tasks are done; p2's guard is superseded by host 67 | host 48 p9-p11, container 05 p7, container 05 p3, host 58, container 04, container 03, proxy 02, daemon 15, daemon 12 | - |
| [65 p1 - The gate refuses a method it does not know, and the proxy sends a call once](host/65-what-the-review-of-the-nine-built-plans-found-p1-the-gate-and-the-proxy/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found-p1-the-gate-and-the-proxy/implemented.md)); reviewed and merged 2026-10-06 | host 65 | - |
| [65 p2 - A machine cannot change what git on the host runs, or reach another repository](host/65-what-the-review-of-the-nine-built-plans-found-p2-a-machines-git-directory/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found-p2-a-machines-git-directory/implemented.md)); reviewed and merged 2026-10-06; its allowlist is superseded by host 67 | host 65, container 05 p7 | - |
| [65 p3 - A file URI keeps every character of its path, and every temp file is private and swept](host/65-what-the-review-of-the-nine-built-plans-found-p3-file-uris-and-private-files/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found-p3-file-uris-and-private-files/implemented.md)); reviewed and merged 2026-10-06; the four agents' sdk range and the eight package versions at 0.10.0 (Softov's answer) | host 65, host 58 | - |
| [65 p4 - An image holds what its tag says](host/65-what-the-review-of-the-nine-built-plans-found-p4-parts/plan.md) | medium | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found-p4-parts/implemented.md)); reviewed and merged 2026-10-06 ([deferred.md](host/65-what-the-review-of-the-nine-built-plans-found-p4-parts/deferred.md)) | host 65, container 05 p3 | - |
| [65 p5 - A nested host has one process per session, and a dev container is made only where it is allowed](host/65-what-the-review-of-the-nine-built-plans-found-p5-nested-hosts-and-dev-containers/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found-p5-nested-hosts-and-dev-containers/implemented.md)); reviewed and merged 2026-10-06 | host 65, container 04, container 03 | - |
| [65 p6 - Each verb takes only what it reads, and the records name the right things](host/65-what-the-review-of-the-nine-built-plans-found-p6-small-cli-and-record-fixes/plan.md) | medium | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found-p6-small-cli-and-record-fixes/implemented.md)); reviewed and merged 2026-10-06 | host 65, daemon 15, daemon 12 | - |
| [66 - A session honours the folders VS Code trusts](host/66-a-session-honours-the-folders-vscode-trusts/plan.md) | high | built 2026-10-06 ([implemented.md](host/66-a-session-honours-the-folders-vscode-trusts/implemented.md)); ahpc and ahpapp must push the key ([deferred.md](host/66-a-session-honours-the-folders-vscode-trusts/deferred.md)) | - | host 45 task 01, which no longer declares `workspaceTrust` |
| [66 p1 - The host declares workspaceTrust, keeps it per connection, and asks before a session moves](host/66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/plan.md) | high | built 2026-10-06 ([implemented.md](host/66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/implemented.md)) | host 66 | 66 p2, 66 p3 |
| [66 p2 - Claude and pi load a project's files only when it is trusted](host/66-a-session-honours-the-folders-vscode-trusts-p2-claude-and-pi-load-project-files-only-when-trusted/plan.md) | high | built 2026-10-06 ([implemented.md](host/66-a-session-honours-the-folders-vscode-trusts-p2-claude-and-pi-load-project-files-only-when-trusted/implemented.md)) | host 66 p1 | - |
| [66 p3 - An ACP agent in a folder nobody trusted](host/66-a-session-honours-the-folders-vscode-trusts-p3-an-acp-agent-in-an-untrusted-folder/plan.md) | medium | built 2026-10-06 ([implemented.md](host/66-a-session-honours-the-folders-vscode-trusts-p3-an-acp-agent-in-an-untrusted-folder/implemented.md)) | host 66 p1 | - |
| [67 - A machine commits in a repository of its own, and ahpd fetches the work back](host/67-a-machine-commits-in-its-own-repository/plan.md) | high | built 2026-10-07, `sessionTree` shared or copy; supersedes host/65 p2's git allowlist | host 65 p2 (no `deferred.md` there to close), container 05 p7 | - |
| [68 - An attachment's bytes are a file the host wrote, and every backend reads attachments through one helper with one set of limits](host/68-an-attachments-bytes-are-a-file-the-host-wrote/plan.md) | medium | built 2026-10-07 ([implemented.md](host/68-an-attachments-bytes-are-a-file-the-host-wrote/implemented.md)) | - | claude 20, acp 14, pi 15, plugin 36 |
| [69 - Streamed deltas are merged for a short window in the host's dispatch, for every backend](host/69-a-streamed-delta-is-merged-before-it-goes-out/plan.md) | medium | built 2026-10-07 ([implemented.md](host/69-a-streamed-delta-is-merged-before-it-goes-out/implemented.md)); reviewed and merged | - | - |
| [70 - What the 0.10.0 release review found is fixed](host/70-what-the-release-review-found-is-fixed/plan.md) | high | built 2026-10-07 ([implemented.md](host/70-what-the-release-review-found-is-fixed/implemented.md)); reviewed and merged | - | release 0.10.0 |
| [71 - An automation wakes on what a session does](host/71-an-automation-wakes-on-what-a-session-does/plan.md) | medium | built 2026-10-07 ([implemented.md](host/71-an-automation-wakes-on-what-a-session-does/implemented.md), [deferred.md](host/71-an-automation-wakes-on-what-a-session-does/deferred.md), [diagrams](host/71-an-automation-wakes-on-what-a-session-does/diagrams.md)) | - | the bot study, step 3 |
| [72 - A plugin is told when the host closes, and the computer plugin stops its work there](host/72-a-plugin-is-told-when-the-host-closes/plan.md) | high | built 2026-10-07 ([implemented.md](host/72-a-plugin-is-told-when-the-host-closes/implemented.md)); reviewed and merged | - | release 0.10.0 |
| [73 - A role editor offers trust and proxy, the two subjects the gate asks for and does not advertise](host/73-a-role-editor-offers-trust-and-proxy/plan.md) | medium | built 2026-10-08 | - | - |
| [74 - The sdk's tools live in one folder](host/74-the-sdks-tools-live-in-one-folder/plan.md) | medium | built 2026-10-09 ([implemented.md](host/74-the-sdks-tools-live-in-one-folder/implemented.md)); 79a3541 | - | - |

Next free number in `host`: `75`.

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

| [08 - A Claude tool call's toolInput is its whole input, and invocationMessage stays the short line](claude/08-tool-input-is-the-whole-input/plan.md) | high | built 2026-10-03 ([implemented.md](claude/08-tool-input-is-the-whole-input/implemented.md)) | - | - |

| [09 - A message runs on the custom agent it picked](claude/09-a-message-runs-on-the-agent-it-picked/plan.md) | high | built 2026-10-04 ([implemented.md](claude/09-a-message-runs-on-the-agent-it-picked/implemented.md)) | - | - |
| [10 - A Claude session runs on a preset, and the ahpd-only chips move into it](claude/10-a-claude-session-runs-on-a-preset/plan.md) | high | active 2026-10-02; tasks 01-04 done (03 reviewed, fixed in host 64); the ahpapp chip check is by hand | host 31 | - |
| [11 - An answered AskUserQuestion call carries its answers, live and after a restart](claude/11-an-answered-question-carries-its-answers/plan.md) | medium | built 2026-10-04 ([implemented.md](claude/11-an-answered-question-carries-its-answers/implemented.md)) | claude 08 | ahpapp chat/01 |
| [12 - A second Claude harness runs on another endpoint, named on its own and keyed from the daemon's environment](claude/12-a-second-claude-runs-on-another-endpoint/plan.md) | medium | built 2026-10-02 ([implemented.md](claude/12-a-second-claude-runs-on-another-endpoint/implemented.md)) | claude 10 | - |
| [13 - A Claude harness offers the models it is told, written or fetched from an endpoint](claude/13-a-claude-harness-offers-the-models-it-is-told/plan.md) | medium | built 2026-10-02 ([implemented.md](claude/13-a-claude-harness-offers-the-models-it-is-told/implemented.md)) | claude 12 | - |
| [14 - A model the CLI rejects fails the turn that asked for it](claude/14-a-rejected-model-fails-the-turn/plan.md) | high | built 2026-10-02 ([implemented.md](claude/14-a-rejected-model-fails-the-turn/implemented.md)) | claude 13 | - |
| [15 - A Claude plugin is loaded once, and each preset is a variant with its own name and models](claude/15-one-load-and-each-preset-is-a-variant/plan.md) | high | built 2026-10-02 ([implemented.md](claude/15-one-load-and-each-preset-is-a-variant/implemented.md)) | claude 10, 12, 13 | the ACP presets plan |
| [16 - A Claude preset that cannot be resolved skips only itself](claude/16-a-preset-that-fails-skips-only-itself/plan.md) | high | built 2026-10-03 ([implemented.md](claude/16-a-preset-that-fails-skips-only-itself/implemented.md)) | claude 15 | - |
| [17 - A Claude subagent chat opens with its task's description as title and its prompt as the first message](claude/17-a-subagent-chat-opens-with-its-task/plan.md) | high | built 2026-10-04 ([implemented.md](claude/17-a-subagent-chat-opens-with-its-task/implemented.md)); tasks implemented, awaiting review | - | - |
| [18 - session.ts is split into one file per area, and session.ts only composes them](claude/18-session-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](claude/18-session-is-split-by-area/implemented.md)); tasks implemented, awaiting review | - | - |
| [19 - An AskUserQuestion shows each question's header, and an answer shows on every client at once with its typed text reaching the tool](claude/19-a-question-shows-its-headers-and-its-answer-at-once/plan.md) | high | planned | claude 11 | - |
| [20 - A Claude turn reads its message's attachments, queued and steered ones included](claude/20-a-claude-turn-reads-its-attachments/plan.md) | medium | built 2026-10-07 ([implemented.md](claude/20-a-claude-turn-reads-its-attachments/implemented.md), [deferred.md](claude/20-a-claude-turn-reads-its-attachments/deferred.md)) | host 68 | ahpapp `chat/03` for Claude sessions |

Next free number in `claude`: `21`.

## documentation

Reference: [00-documentation.md](documentation/00-documentation.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The stale prose matches the code again](documentation/01-correct-the-stale-prose/plan.md) | low | built 2026-09-20 ([implemented.md](documentation/01-correct-the-stale-prose/implemented.md)) | - | - |
| [02 - Captures are taken and read with ahpc, and ahpd keeps no proxy or capture check](documentation/02-captures-are-taken-and-read-with-ahpc/plan.md) | medium | planned 2026-10-04; task 01 todo | host 43 p1; ahpc cli/02 | - |
| [03 - Each area of the host has one doc](documentation/03-each-area-of-the-host-has-one-doc/plan.md) | medium | built 2026-10-08 ([implemented.md](documentation/03-each-area-of-the-host-has-one-doc/implemented.md)); reviewed and merged 2026-10-08 (210143a) | - | - |
| [04 - Each package's README says how to use it, how to configure it and what each option does](documentation/04-each-package-readme-says-how-to-use-it/plan.md) | medium | built 2026-10-09 ([implemented.md](documentation/04-each-package-readme-says-how-to-use-it/implemented.md)); 7356624 | - | - |

Next free number in `documentation`: `05`.

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
| [15 - An agent says what a machine needs, and the machine is made with it](plugin/15-an-agent-says-what-a-machine-needs/plan.md) | high | built 2026-10-03 ([implemented.md](plugin/15-an-agent-says-what-a-machine-needs/implemented.md)) | plugin 11 | plugin 16, container 03, container 04 |
| [16 - A disposable machine is made for a session and goes after it](plugin/16-a-disposable-machine/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/16-a-disposable-machine/implemented.md)) | plugin 15 | - |
| [17 - A plugin hears when a session needs a person](plugin/17-a-plugin-hears-a-session-needs-a-person/plan.md) | high | built 2026-10-01 ([implemented.md](plugin/17-a-plugin-hears-a-session-needs-a-person/implemented.md)) | plugin 02 | the notify plugin, which reads the two events |
| [18 - The ACP bridge resumes, forks and asks](plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md) | medium | planned 2026-09-26, after plugin 21; ACP v2 in [deferred.md](plugin/18-the-acp-bridge-resumes-forks-and-asks/deferred.md) | plugin 07, host 19 (task 02 after host 19 task 01) | - |
| [19 - A docker machine may run under gVisor](plugin/19-a-docker-machine-may-run-under-gvisor/plan.md) | low | planned 2026-09-26, after plugin 18 | plugin 10 | - |
| [20 - A plugin is a client of its own host, as a principal of its own](plugin/20-a-plugin-is-a-client-of-its-own-host/plan.md) | high | planned 2026-09-26, after plugin 17 | plugin 01, host 11 | plugin 21, and every gateway, trigger and facade plugin |
| [21 - A plugin serves an HTTP route on the daemon's listener](plugin/21-a-plugin-serves-an-http-route/plan.md) | medium | built 2026-10-04 ([implemented.md](plugin/21-a-plugin-serves-an-http-route/implemented.md)) before plugin 20; tasks implemented, awaiting review | daemon 05, plugin 20 | webhook, callback and facade plugins |
| [22 - A cofold write lands on the file its check allowed, and not on one that changed since it was read](plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) | medium | active; 01-03 done (02-03 in cofold d39935f), 04 waits on the cofold release | plugin 14 | - |
| [23 - A cofold session reopens on the model its turns ran on](plugin/23-a-cofold-session-keeps-its-model/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/23-a-cofold-session-keeps-its-model/implemented.md)) | plugin 14 | - |
| [24 - The log says when each plugin starts loading and how long it took](plugin/24-the-log-times-each-plugin/plan.md) | medium | built 2026-09-28 ([implemented.md](plugin/24-the-log-times-each-plugin/implemented.md)) | plugin 01 | - |
| [25 - A plugin's agent sees every path the daemon serves](plugin/25-a-plugin-agent-sees-every-served-path/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/25-a-plugin-agent-sees-every-served-path/implemented.md)) | plugin 01 | - |
| [26 - A plugin declares a schema for its options, and the loader checks it](plugin/26-a-plugin-declares-its-options-schema/plan.md) | medium | built 2026-09-28 ([implemented.md](plugin/26-a-plugin-declares-its-options-schema/implemented.md)) | daemon 08 | - |

| [27 - An answer given the moment a cofold request opens reaches the run](plugin/27-an-early-answer-reaches-the-paused-run/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/27-an-early-answer-reaches-the-paused-run/implemented.md)) | plugin 03 | - |

| [28 - A test that ends a session waits for its cleanup to finish before removing its folder](plugin/28-a-closed-session-test-waits-for-its-run/plan.md) | high | built 2026-09-29 ([implemented.md](plugin/28-a-closed-session-test-waits-for-its-run/implemented.md)) | plugin 27 | - |

| [29 - A tool call says when it started and how long it ran, live and in history](plugin/29-a-tool-call-says-when-it-ran/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-a-tool-call-says-when-it-ran/implemented.md)) | - | - |

| [30 - Two more tests wait for what their session is still doing](plugin/30-two-more-tests-wait-for-their-session/plan.md) | high | built 2026-09-30 ([implemented.md](plugin/30-two-more-tests-wait-for-their-session/implemented.md)) | plugin 28 | - |
| [31 - A plugin file takes the nearest manifest only when it is a plugin's](plugin/31-a-plugin-file-takes-only-a-plugin-manifest/plan.md) | low | built 2026-10-07 ([implemented.md](plugin/31-a-plugin-file-takes-only-a-plugin-manifest/implemented.md)); task 01 reviewed 2026-10-06 | - | - |

| [32 - A turn's usage is every model call it made, sent as it runs, with the harness's cost](plugin/32-a-turns-usage-is-every-call-it-made/plan.md) | high | built 2026-10-01; p1-p4 | - | the agent meter |

| [33 - A phone hears when a session needs a person](plugin/33-a-phone-hears-a-session-needs-a-person/plan.md) | high | planned 2026-10-02 | plugin 17 | - |
| [34 - The cofold session is split into one file per area, and session.ts composes them](plugin/34-cofold-session-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](plugin/34-cofold-session-is-split-by-area/implemented.md)); tasks implemented, awaiting review | - | - |
| [35 - A cofold session uses what published cofold already ships - listed models with their price, compaction, and a question for the person](plugin/35-cofold-uses-what-cofold-ships/plan.md) | high | built 2026-10-06 ([implemented.md](plugin/35-cofold-uses-what-cofold-ships/implemented.md)); reviewed and merged 2026-10-06 | plugin 05, plugin 32 p3 | - |
| [36 - A cofold turn reads its message's attachments, and sends an image only to a model that takes images](plugin/36-a-cofold-turn-reads-its-attachments/plan.md) | medium | planned 2026-10-06 | host 68 | - |
| [37 - A bot is a record a person makes, with a session to talk to it in](plugin/37-a-bot-is-a-record-with-a-session/plan.md) | high | built 2026-10-08 ([implemented.md](plugin/37-a-bot-is-a-record-with-a-session/implemented.md)); 01 and 03 (1a3ee7a), 02, 04 and 05 (6fb1289) | plugin 09 as the pattern | the bot harness, a bot as a principal, the ahpc and ahpapp bot screens |
| [38 - A plugin cannot change what the host gave it](plugin/38-a-plugin-cannot-change-what-the-host-gave-it/plan.md) | high | built 2026-10-09 ([implemented.md](plugin/38-a-plugin-cannot-change-what-the-host-gave-it/implemented.md)); 01-06 (9f3798c) | plugin 37 (built on it) | plugins out of process |
| [39 - Each optionsSchema declares every field the code reads](plugin/39-each-options-schema-declares-every-field-the-code-reads/plan.md) | medium | built 2026-10-09 ([implemented.md](plugin/39-each-options-schema-declares-every-field-the-code-reads/implemented.md)); 23710ef | documentation 04 | - |

Next free number in `plugin`: `40`.

## container

Reference: [00-container.md](container/00-container.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A session in a dev container, with its whole host inside it](container/01-a-session-in-a-dev-container/plan.md) | high | built 2026-09-24, except its `ahpapp` half ([implemented.md](container/01-a-session-in-a-dev-container/implemented.md)) | plugin 11, plugin 12 | an ahpapp plan, which drives the same four methods |
| [02 - VS Code offers a dev container on a folder served by ahpd](container/02-vscode-offers-our-dev-container/plan.md) | high | planned 2026-10-02; tasks 01-04 todo | container 01; task 04 also container 03, plugin 16 | - |
| [03 - A dev container is a computer, listed and reachable without the connection that made it](container/03-a-dev-container-is-a-computer/plan.md) | medium | built 2026-10-05 ([implemented.md](container/03-a-dev-container-is-a-computer/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | container 01, plugin 15 | - |
| [04 - A cofold session in a computer runs in an ahpd started inside it](container/04-a-cofold-session-in-a-computer/plan.md) | medium | built 2026-10-06 ([implemented.md](container/04-a-cofold-session-in-a-computer/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | plugin 14, plugin 15 | - |
| [05 - An agent in a machine is built once, started fast, and reached from anywhere](container/05-an-agent-in-a-machine/plan.md) | high | planned 2026-10-03, a parent of twelve child plans | plugin 15, plugin 16, container 04, container 03, claude 15 | the next agent and plugin plans |
| [05 p1 - A secret reaches a machine in its environment, never in its argv](container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md) | high | built 2026-10-05 ([implemented.md](container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/implemented.md)); tasks implemented, awaiting review | container 05, container 03 | 05 p2 |
| [05 p2 - An ACP preset says what its machine needs](container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md) | high | built 2026-10-05 ([implemented.md](container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/implemented.md)); tasks 01, 04, 05 implemented, awaiting review; 02, 03 dropped | container 05 p1, acp 05 | 05 p5 |
| [05 p3 - Parts are built from one versions file, and the joined image from the same file](container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md) | high | built 2026-10-04 ([implemented.md](container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | container 05 | 05 p4 |
| [05 p4 - A part is mounted into a machine, from its image or from a volume](container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md) | high | built 2026-10-05 ([implemented.md](container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/implemented.md)); tasks implemented, awaiting review | container 05 p3, plugin 15, container 03 | 05 p5 |
| [05 p5 - Agents run from their parts and keep their own state, and the host's binary and home become opt-ins](container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md) | high | built 2026-10-06 ([implemented.md](container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/implemented.md)); reviewed and merged 2026-10-06 | container 05 p2, container 05 p3, container 05 p4, container 05 p6, container 04, claude 15, plugin 15, acp 05 | 05 p8, 05 p9 |
| [05 p6 - An agent's configuration lives in a volume per profile, seeded from the host once](container/05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/plan.md) | high | built 2026-10-06 ([implemented.md](container/05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/implemented.md)); tasks implemented, awaiting review | container 05 | 05 p5 |
| [05 p7 - A worktree reaches its machine with the repository it belongs to](container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md) | high | built 2026-10-06 ([implemented.md](container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | plugin 16, container 03 | 05 p8 |
| [05 p8 - A profile's machines may live on another Docker](container/05-an-agent-in-a-machine-p8-a-profile-on-another-docker/plan.md) | medium | planned 2026-10-03; tasks 01-07 todo | container 05 p5, container 05 p7, container 05 p9, container 05 p12 | - |
| [05 p9 - An ssh machine runs a nested host](container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md) | medium | planned 2026-10-03; tasks 01-07 todo | container 04 (tasks 11, 14, 15, 17) | 05 p10 |
| [05 p10 - A host joins another, which lists it as a computer and relays its sessions](container/05-an-agent-in-a-machine-p10-a-host-joins-a-hub/plan.md) | medium | planned 2026-10-03; tasks 01-06 todo | container 05 p9, container 05 p12, daemon 13 | - |
| [05 p11 - A virtual machine is made for a computer, by libvirt and then by Proxmox](container/05-an-agent-in-a-machine-p11-a-vm-is-made-for-a-machine/plan.md) | medium | planned 2026-10-03; tasks 01-07 todo | container 05 p9, container 05 p12, container 05 p8, container 05 p3, container 05 p5 | - |
| [05 p12 - A machine off this host reaches its models through this host's proxy](container/05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/plan.md) | high | planned 2026-10-03; tasks 01, 02 blocked on proxy 02 (planned 2026-10-06, its task 02 names the `whose` hook); 03, 04 todo | container 05 p9, proxy 01, claude 16, proxy 02 | - |

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
| [14 - agent-pi.test.ts is split into one test file per area](pi/14-pi-test-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](pi/14-pi-test-is-split-by-area/implemented.md)); tasks implemented, awaiting review | - | - |
| [15 - A pi turn reads its message's attachments, queued and steered ones included](pi/15-a-pi-turn-reads-its-attachments/plan.md) | medium | built 2026-10-07 ([implemented.md](pi/15-a-pi-turn-reads-its-attachments/implemented.md)) | host 68 | - |

Next free number in `pi`: `16`.

## acp

Reference: [00-acp.md](acp/00-acp.md)

Worked in this order: 01, 02, plugin 18, 03, 04, 05. Then 06, 08, 09 and 10 in any order, then 12. 07 is dropped into host 24. 11 is planned after daemon 11.

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The bridge survives its agent: a bad command, a dying server and a close](acp/01-the-bridge-survives-its-agent/plan.md) | high | built 2026-10-02 ([implemented.md](acp/01-the-bridge-survives-its-agent/implemented.md)) | - | acp 12 |
| [02 - Replay lands in the session's history, never in its next turn](acp/02-replay-lands-in-history/plan.md) | high | built 2026-10-02 ([implemented.md](acp/02-replay-lands-in-history/implemented.md)) | - | plugin 18, acp 01 task 03 |
| [03 - A turn ends as the agent ended it](acp/03-a-turn-ends-as-the-agent-ended-it/plan.md) | high | built 2026-10-02 ([implemented.md](acp/03-a-turn-ends-as-the-agent-ended-it/implemented.md)) | - | - |
| [04 - The bridge signs in, and says when an agent needs it](acp/04-the-bridge-signs-in/plan.md) | high | built 2026-10-02 ([implemented.md](acp/04-the-bridge-signs-in/implemented.md)) | - | acp 05 |
| [05 - One ACP load, and each preset is an agent of its own](acp/05-presets/plan.md) | medium | built 2026-10-04 ([implemented.md](acp/05-presets/implemented.md)) | acp 04, claude 15 | container 05 p2, p5; daemon 10 |
| [06 - Tool calls say what happened, and an agent's edits reach review](acp/06-tool-calls-say-what-happened/plan.md) | medium | built 2026-10-02 ([implemented.md](acp/06-tool-calls-say-what-happened/implemented.md)) | - | - |
| [07 - A person answers with the agent's own permission options](acp/07-the-agents-own-permission-options/plan.md) | medium | dropped 2026-09-28, built in host 24 | - | - |
| [08 - Usage, title, plan and mode changes reach the client](acp/08-session-updates-reach-the-client/plan.md) | medium | built 2026-10-02 ([implemented.md](acp/08-session-updates-reach-the-client/implemented.md)) | - | acp 09 |
| [09 - Every option an agent offers is a control](acp/09-every-config-option-is-a-control/plan.md) | medium | built 2026-10-02 ([implemented.md](acp/09-every-config-option-is-a-control/implemented.md)) | acp 08 | - |
| [10 - A prompt carries what the agent accepts, and only what it accepts](acp/10-a-prompt-carries-what-the-agent-accepts/plan.md) | medium | built 2026-10-02 ([implemented.md](acp/10-a-prompt-carries-what-the-agent-accepts/implemented.md)) | - | - |
| [11 - The agent gets the host's MCP servers](acp/11-the-agent-gets-mcp-servers/plan.md) | medium | built 2026-10-02 ([implemented.md](acp/11-the-agent-gets-mcp-servers/implemented.md)) | daemon 11 | - |
| [12 - The bridge is on the current SDK entry, and lists sessions properly](acp/12-the-bridge-is-on-the-current-sdk/plan.md) | low | built 2026-10-02 ([implemented.md](acp/12-the-bridge-is-on-the-current-sdk/implemented.md)) | acp 01 | - |
| [13 - session.ts is split into one file per area](acp/13-session-is-split-by-area/plan.md) | high | built 2026-10-07 ([implemented.md](acp/13-session-is-split-by-area/implemented.md)) | host 52 | - |
| [14 - An ACP prompt reads a referenced file only within the limits, and a queued message keeps its attachments](acp/14-a-referenced-file-is-read-within-the-limits/plan.md) | high | built 2026-10-07 ([implemented.md](acp/14-a-referenced-file-is-read-within-the-limits/implemented.md)) | host 68 | - |

Next free number in `acp`: `15`.

## usage

Reference: [00-usage.md](usage/00-usage.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Usage is kept behind one port, model use and computer time, with live totals](usage/01-usage-is-kept-behind-one-port/plan.md) | high | built 2026-10-01 ([implemented.md](usage/01-usage-is-kept-behind-one-port/implemented.md)) | - | the meters and the policy plans |
| [02 - A turn writes what it used to the usage store, charged to its owner, team and project](usage/02-a-turn-writes-what-it-used/plan.md) | high | built 2026-10-02 ([implemented.md](usage/02-a-turn-writes-what-it-used/implemented.md)) | usage 01, host 34, host 35 | policy |
| [03 - A machine records who created it and writes the time it was up, charged to its owner](usage/03-a-machine-writes-its-up-time/plan.md) | high | built 2026-10-02 ([implemented.md](usage/03-a-machine-writes-its-up-time/implemented.md)) | usage 01, host 34 | - |
| [04 - A client reads what a pool spent, and the records behind it, through a usage scheme](usage/04-usage-is-read-through-a-scheme/plan.md) | high | built 2026-10-02 ([implemented.md](usage/04-usage-is-read-through-a-scheme/implemented.md)) | usage 02, usage 03, host 36 | ahpapp usage/01, policy |
| [05 - A usage total says the tokens sent and the tokens received, beside the sum](usage/05-a-total-says-tokens-sent-and-received/plan.md) | high | built 2026-10-07 ([implemented.md](usage/05-a-total-says-tokens-sent-and-received/implemented.md)) | - | ahpapp usage 02 |
| [06 - A usage record keeps the provider's cost beside the cost it charges, each split into sent and received](usage/06-a-record-keeps-the-providers-cost-beside-ours/plan.md) | high | active 2026-10-07; 01-02 done (2b5a656), 03 waits on Softov's captures | usage 05 | usage 07 |
| [07 - An agent's reported cost is kept as the provider's, and a record says nothing it was not told](usage/07-an-agents-reported-cost-is-the-providers/plan.md) | high | active 2026-10-08; 01-03 and 05 done ([implemented.md](usage/07-an-agents-reported-cost-is-the-providers/implemented.md)); 04 blocked on a live `claude-openrouter` capture | usage 06 | - |
| [08 - A usage list shows the charged pools a reader may read, names them, and sums any range by user, team and project](usage/08-a-usage-list-shows-what-a-reader-may-read-by-range-and-group/plan.md) | high | built 2026-10-09 (9e38af1) | - | ahpapp `usage/04` |

Next free number in `usage`: `09`.

## policy

Reference: [00-policy.md](policy/00-policy.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A policy says who may use which agent, model and computer](policy/01-a-policy-says-who-may-use-what/plan.md) | high | built 2026-10-02 ([implemented.md](policy/01-a-policy-says-who-may-use-what/implemented.md)) | host 36 | policy 02, proxy 02 |
| [04 - The policy form reads its choices from the manifest](policy/04-the-policy-form-reads-its-choices-from-the-manifest/plan.md) | medium | built 2026-10-06 ([implemented.md](policy/04-the-policy-form-reads-its-choices-from-the-manifest/implemented.md)); reviewed and merged 2026-10-06 | policy 01 | ahpapp policy/01 |

Next free number in `policy`: `05` (`02` and `03` are held for limit enforcement).

## proxy

Reference: [00-proxy.md](proxy/00-proxy.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The proxy knows its providers and model names](proxy/01-the-proxy-knows-its-providers-and-models/plan.md) | high | built 2026-10-01 ([implemented.md](proxy/01-the-proxy-knows-its-providers-and-models/implemented.md)) | - | proxy 02 |
| [02 - The proxy serves a person's chat completions and messages, streamed back unchanged](proxy/02-the-proxy-serves-a-persons-model-calls/plan.md) | high | built 2026-10-06 ([implemented.md](proxy/02-the-proxy-serves-a-persons-model-calls/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | proxy 01, policy 01, usage 01, host 35 | container 05 p12 |

Next free number in `proxy`: `03`.

## vault

Reference: [00-vault.md](vault/00-vault.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Secrets live in a vault, and a plugin option or a machine need names one](vault/01-secrets-live-in-a-vault/plan.md) | high | built 2026-10-03 ([implemented.md](vault/01-secrets-live-in-a-vault/implemented.md)) | - | - |
| [01 p1 - The vault port and the daemon's plain file](vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/plan.md) | high | built 2026-10-03 ([implemented.md](vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/implemented.md)) | - | 01 p2 |
| [01 p2 - A machine need names a secret, read when the machine is made](vault/01-secrets-live-in-a-vault-p2-a-machine-need-names-a-secret/plan.md) | high | built 2026-10-03 ([implemented.md](vault/01-secrets-live-in-a-vault-p2-a-machine-need-names-a-secret/implemented.md)) | vault 01 p1 | - |

Next free number in `vault`: `02`.

## Domains without a plan

None. `host`, `claude`, `documentation`, `plugin`, `container`, `pi`, `acp`, `usage`, `policy`, `proxy` and `vault` each have a plan above.
Ideas, one file each:

- [agents as extensions](../ideas/agents-as-extensions.md)
- [an SSH command that attaches to the daemon](../ideas/an-ssh-command-that-attaches-to-the-daemon.md)
- [a plugin reloads without a restart](../ideas/a-plugin-reloads-without-a-restart.md)
- [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md)
- [deliberate duplication](../ideas/deliberate-duplication.md)
- [terminal commands approved by rule](../ideas/terminal-commands-approved-by-rule.md)
- [turn and model-call diagnostics](../ideas/turn-and-model-call-diagnostics.md)
- [verify a JWT locally](../ideas/verify-a-jwt-locally.md)
- [failures have a JSON shape](../ideas/failures-have-a-json-shape.md)
- [more computer runtimes](../ideas/more-computer-runtimes.md)
- [plugins, beyond agents](../ideas/plugins.md)
- [repositories are resources](../ideas/repositories-are-resources.md)
- [issues follow the repository](../ideas/issues-follow-the-repository.md)
- [a sqlite store](../ideas/a-sqlite-store.md)
- [a postgresql store](../ideas/a-postgresql-store.md)
- [initiators start sessions](../ideas/initiators-start-sessions.md)
- [agents report their plan](../ideas/agents-report-their-plan.md)
- [cofold speaks ACP through papo](../ideas/cofold-speaks-acp-through-papo.md)
