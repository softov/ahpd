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
| [06 - The wire capture is the traffic log VS Code writes](daemon/06-wire-capture-is-the-vscode-traffic-log/plan.md) | medium | built 2026-10-02 ([implemented.md](daemon/06-wire-capture-is-the-vscode-traffic-log/implemented.md)) | - | - |
| [07 - A daemon with no backend names the command that installs one, and an upgrade from 0.6 is told why](daemon/07-no-backend-names-the-install-command/plan.md) | high | built 2026-09-28 ([implemented.md](daemon/07-no-backend-names-the-install-command/implemented.md)) | daemon 03 | - |
| [08 - The configuration is read through cofold and checked against one schema](daemon/08-the-config-file-is-checked-in-one-place/plan.md) | high | built 2026-09-28 ([implemented.md](daemon/08-the-config-file-is-checked-in-one-place/implemented.md)) | cofold commands/02 | plugin 26 |
| [09 - A plugin update moves all or the named plugins](daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) | high | built 2026-10-08 ([implemented.md](daemon/09-a-plugin-update-moves-every-plugin-together/implemented.md)); every task done and merged (12 e5134da, 01 and 04 f1acaba), 05 and 07 dropped | - | - |

| [10 - `ahpd configure` sets the daemon up, and a first start at a terminal offers it](daemon/10-a-first-run-sets-the-daemon-up/plan.md) | medium | built 2026-10-02 ([implemented.md](daemon/10-a-first-run-sets-the-daemon-up/implemented.md)) | daemon 09 | - |
| [11 - Root config carries the daemon's settings and each plugin's options, and a client edits them](daemon/11-root-config-holds-daemon-and-plugin-options/plan.md) | high | built 2026-10-02 ([implemented.md](daemon/11-root-config-holds-daemon-and-plugin-options/implemented.md)) | - | - |
| [12 - A plugin option is set from the command line, in the file or for one run](daemon/12-a-plugin-option-is-set-from-the-command-line/plan.md) | medium | built 2026-10-04 ([implemented.md](daemon/12-a-plugin-option-is-set-from-the-command-line/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65; by-hand checks not run | - | - |
| [13 - `ahpd restart` restarts the daemon in place, and refuses while a turn runs](daemon/13-ahpd-restart/plan.md) | high | built 2026-10-15 | - | - |
| [14 - The daemon log rotates at start](daemon/14-the-daemon-log-rotates-at-start/plan.md) | low | built 2026-10-02 ([implemented.md](daemon/14-the-daemon-log-rotates-at-start/implemented.md)) | - | - |
| [15 - A verb declares only the flags it reads](daemon/15-a-verb-declares-only-its-own-flags/plan.md) | medium | built 2026-10-06 ([implemented.md](daemon/15-a-verb-declares-only-its-own-flags/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | - | - |
| [16 - A command says what it does to what, and the daemon serves on the cofold that checks it](daemon/16-a-command-says-what-it-does-to-what/plan.md) | high | built 2026-10-06 ([implemented.md](daemon/16-a-command-says-what-it-does-to-what/implemented.md)) | cofold commands/03, commands/04 | ahpd-web resource screens |
| [17 - A plugin installs at the newest version whose sdk range admits the daemon](daemon/17-plugin-installs-newest-version-fitting-sdk/plan.md) | high | built 2026-10-09 ([implemented.md](daemon/17-plugin-installs-newest-version-fitting-sdk/implemented.md)) | daemon 09 | - |
| [18 - The API answers to the origins a deployment names](daemon/18-api-answers-origins-a-deployment-names/plan.md) | high | built 2026-10-10 ([implemented.md](daemon/18-api-answers-origins-a-deployment-names/implemented.md)) | daemon 05 | - |
| [19 - A plugin is known by its id, not by the spec that loads it](daemon/19-a-plugin-is-known-by-its-id/plan.md) | high | built 2026-10-10 ([implemented.md](daemon/19-a-plugin-is-known-by-its-id/implemented.md)); checked 2026-10-13 | daemon 11 | - |
| [20 - `ahpd stop` and `ahpd restart` reach a daemon on Windows](daemon/20-stop-and-restart-reach-a-daemon-on-windows/plan.md) | high | built 2026-10-15 ([implemented.md](daemon/20-stop-and-restart-reach-a-daemon-on-windows/implemented.md)); checked on Windows 2026-10-15 | daemon 13 | - |
| [21 - The shutdown method stops the daemon gracefully](daemon/21-shutdown-method-stops-daemon-gracefully/plan.md) | high | built 2026-10-15 ([implemented.md](daemon/21-shutdown-method-stops-daemon-gracefully/implemented.md)); checked on Linux and Windows 2026-10-15 | daemon 20 | - |
| [22 - A plugin's late problem is logged](daemon/22-a-plugins-late-problem-is-logged/plan.md) | medium | built 2026-10-15 | - | - |
| [23 - npm installs a plugin on Windows](daemon/23-npm-installs-a-plugin-on-windows/plan.md) | high | built 2026-10-16 ([implemented.md](daemon/23-npm-installs-a-plugin-on-windows/implemented.md)); passed on Windows 2026-10-13; the remove check passed on Windows 2026-10-16 | - | - |
| [24 - A first Windows run starts and stops cleanly](daemon/24-a-first-windows-run-starts-and-stops-cleanly/plan.md) | high | built 2026-10-13 ([implemented.md](daemon/24-a-first-windows-run-starts-and-stops-cleanly/implemented.md)); passed on Windows 2026-10-13 | - | - |
| [25 - A token file in a new folder is written](daemon/25-a-token-file-in-a-new-folder-is-written/plan.md) | high | built 2026-10-19; checked on Windows 2026-10-14; [implemented.md](daemon/25-a-token-file-in-a-new-folder-is-written/implemented.md) | - | - |
| [26 - ahpd paths sets the served folders](daemon/26-ahpd-paths-sets-the-served-folders/plan.md) | high | built 2026-10-15 | - | - |
| [27 - ahpd installs with one line](daemon/27-ahpd-installs-with-one-line/plan.md) | medium | active 2026-10-19; tasks 01 to 04 implemented; task 03's site changes are in the ahpd/27-install-scripts worktree of ahpio-site, and its checks are in [pending/daemon-27-install-site-checks.md](../pending/daemon-27-install-site-checks.md) | - | - |
| [28 - Setup finds the runtimes and agents](daemon/28-setup-finds-the-runtimes-and-agents/plan.md) | medium | active; tasks 01 to 03 implemented 2026-10-19 | 27 | 29 |
| [29 - ahpd doctor says what is wrong](daemon/29-ahpd-doctor-says-what-is-wrong/plan.md) | medium | draft 2026-10-15 | 28 | - |
| [30 - npm says what it installs before it runs](daemon/30-npm-says-what-it-installs/plan.md) | medium | built 2026-10-19; passed on Windows 2026-10-16; [implemented.md](daemon/30-npm-says-what-it-installs/implemented.md) | - | - |
| [31 - The service manager starts the daemon](daemon/31-the-service-manager-starts-the-daemon/plan.md) | medium | active 2026-10-16; tasks 01 to 05 implemented; Debian checks pass; macOS checks in [pending/daemon-31-service-checks.md](../pending/daemon-31-service-checks.md) | - | daemon 27 task 04 |
| [32 - A failure has a JSON shape under --json](daemon/32-a-failure-has-a-json-shape/plan.md) | medium | built 2026-10-19; in 20edee91 on main; [implemented.md](daemon/32-a-failure-has-a-json-shape/implemented.md) | cofold commands 06 | - |
| [33 - ahpd's checks pass on Windows](daemon/33-ahpds-checks-pass-on-windows/plan.md) | medium | built 2026-10-20; parent of p1 to p8; [implemented.md](daemon/33-ahpds-checks-pass-on-windows/implemented.md) | - | - |
| [33 p1 - A Windows job runs the checks](daemon/33-p1-a-windows-job-runs-the-checks/plan.md) | medium | built 2026-10-19; check-windows green on PR #30; [implemented.md](daemon/33-p1-a-windows-job-runs-the-checks/implemented.md) | 33 | 33 p4 |
| [33 p2 - Tests build paths the system's way](daemon/33-p2-tests-build-paths-the-systems-way/plan.md) | medium | built 2026-10-19; check-windows green on PR #30; [implemented.md](daemon/33-p2-tests-build-paths-the-systems-way/implemented.md) | 33 | 33 p4 |
| [33 p3 - POSIX-only tests say why they skip](daemon/33-p3-posix-only-tests-say-why-they-skip/plan.md) | medium | built 2026-10-20; [implemented.md](daemon/33-p3-posix-only-tests-say-why-they-skip/implemented.md) | 33 | 33 p4 |
| [33 p4 - The Windows job is required](daemon/33-p4-the-windows-job-is-required/plan.md) | medium | built 2026-10-20; ruleset "main checks" requires check-windows; [implemented.md](daemon/33-p4-the-windows-job-is-required/implemented.md) | 33 p1, p2, p3, p5, p6 | - |
| [33 p5 - Terminals run on Windows](daemon/33-p5-terminals-run-on-windows/plan.md) | medium | built 2026-10-19; check-windows green on PR #30; [implemented.md](daemon/33-p5-terminals-run-on-windows/implemented.md) | 33 | 33 p4 |
| [33 p6 - The Windows run finishes clean](daemon/33-p6-the-windows-run-finishes-clean/plan.md) | medium | built 2026-10-20; [implemented.md](daemon/33-p6-the-windows-run-finishes-clean/implemented.md) | 33 | 33 p4 |
| [33 p7 - A Windows folder has a path in the machine](daemon/33-p7-a-windows-folder-has-a-path-in-the-machine/plan.md) | medium | built 2026-10-20; checked with Docker Desktop on a Windows VM; [implemented.md](daemon/33-p7-a-windows-folder-has-a-path-in-the-machine/implemented.md), [deferred.md](daemon/33-p7-a-windows-folder-has-a-path-in-the-machine/deferred.md) | 33 p6 | acp 19 |
| [33 p8 - The process tests pass on Windows](daemon/33-p8-the-process-tests-pass-on-windows/plan.md) | medium | built 2026-10-20; checked on a Windows VM; [implemented.md](daemon/33-p8-the-process-tests-pass-on-windows/implemented.md), [deferred.md](daemon/33-p8-the-process-tests-pass-on-windows/deferred.md) | 33 p6 | - |
| [34 - The API and proxy keys get their own names](daemon/34-the-api-and-proxy-keys-get-their-own-names/plan.md) | medium | built 2026-10-19; merged in PR #22; [implemented.md](daemon/34-the-api-and-proxy-keys-get-their-own-names/implemented.md) | - | - |
| [35 - The daemon updates itself](daemon/35-the-daemon-updates-itself/plan.md) | medium | active 2026-10-19; tasks 01 to 06 implemented, 0 done; checks in [pending/update-checks.md](../pending/update-checks.md) | daemon 09, daemon 13 | - |
| [36 - The install script updates the ahpd it finds](daemon/36-the-install-script-updates-the-ahpd-it-finds/plan.md) | high | built 2026-10-21 (implemented.md); merged in #55 | daemon 27 | - |
| [37 - configure sets up one pi](daemon/37-configure-sets-up-one-pi/plan.md) | medium | active 2026-10-21; task 01 implemented | - | - |
| [38 - configure offers the web UI](daemon/38-configure-offers-the-web-ui/plan.md) | medium | active 2026-10-21; task 01 implemented | - | - |
| [39 - The update check encodes a scoped name](daemon/39-the-update-check-encodes-a-scoped-name/plan.md) | high | built 2026-10-21 (implemented.md); merged in #58 | - | - |

Next free number in `daemon`: `40`.

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
| [16 - A connection that is already authorized is not asked to sign in](host/16-an-authorized-connection-skips-sign-in/plan.md) | high | built 2026-09-26 ([implemented.md](host/16-an-authorized-connection-skips-sign-in/implemented.md)) | host 13 | - |
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

| [30 - A session is listed under its provider's name, whatever a client created it as, so VS Code opens it](host/30-a-session-is-listed-under-its-providers-name/plan.md) | high | built 2026-10-09 ([implemented.md](host/30-a-session-is-listed-under-its-providers-name/implemented.md)) | - | - |
| [31 - A session's config outlives a restart, and a stored value the schema no longer offers falls back to the default](host/31-a-sessions-config-outlives-a-restart/plan.md) | high | built 2026-10-07 ([implemented.md](host/31-a-sessions-config-outlives-a-restart/implemented.md)); tasks 01, 02 reviewed 2026-10-06 | - | claude 10 |
| [32 - The session store is a file per session, and it forgets what no longer exists](host/32-the-session-store-is-a-file-per-session/plan.md) | medium | built 2026-10-02 ([implemented.md](host/32-the-session-store-is-a-file-per-session/implemented.md)) | host 31 | - |
| [33 - A session tool acts as the person it works for, within VS Code's limits, and can be switched off](host/33-a-session-tool-acts-as-its-person/plan.md) | high | active 2026-10-13; tasks 01-02 done, 03-04 implemented - the switch is read from `config.json`, and a live change reaches a running claude session by declaring the set without `ahp` and then with the new one | host 30 | - |

| [34 - A session and an automation say who owns them, and a turn says who sent it](host/34-work-says-who-owns-it/plan.md) | high | built 2026-10-02 ([implemented.md](host/34-work-says-who-owns-it/implemented.md)) | - | usage meters; shares the turn sender with host 33 |

| [35 - A person belongs to teams and projects, and work names which one it is for](host/35-a-person-belongs-to-teams-and-projects/plan.md) | high | built 2026-10-01 ([implemented.md](host/35-a-person-belongs-to-teams-and-projects/implemented.md)) | - | host 34's scope, the proxy listener, policy |
| [36 - Users, teams, projects and roles are resources a client lists and edits](host/36-people-are-resources-a-client-manages/plan.md) | medium | built 2026-10-02 ([implemented.md](host/36-people-are-resources-a-client-manages/implemented.md)) | host 35 | ahpapp people/01, usage 04 |
| [37 - A session two harnesses both list is listed once, under the harness it runs on](host/37-a-session-is-listed-once-under-its-harness/plan.md) | high | built 2026-10-02 ([implemented.md](host/37-a-session-is-listed-once-under-its-harness/implemented.md)) | claude 12 | - |
| [38 - A client sees who owns a session and who sent each turn](host/38-a-client-sees-who-sent-each-turn/plan.md) | medium | built 2026-10-02 ([implemented.md](host/38-a-client-sees-who-sent-each-turn/implemented.md)) | host 34 | ahpapp chat/02 |
| [39 - The pull request pill and the worktree's files come back in VS Code 1.140](host/39-what-vs-code-1140-stopped-reading/plan.md) | high | built 2026-10-02 ([implemented.md](host/39-what-vs-code-1140-stopped-reading/implemented.md)) | - | ahpc and ahpapp send the include files as a list |
| [40 - A connection is told who it is signed in as](host/40-a-connection-is-told-who-it-is/plan.md) | high | built 2026-10-03 ([implemented.md](host/40-a-connection-is-told-who-it-is/implemented.md)) | host 36 | ahpapp people/01 |
| [41 - A failure belongs to the item that failed, and a start says what it skipped](host/41-a-failure-belongs-to-the-item-that-failed/plan.md) | high | built 2026-10-03 ([implemented.md](host/41-a-failure-belongs-to-the-item-that-failed/implemented.md)) | claude 15 | - |
| [42 - An automation's owner rides in _meta, where the protocol has room for it](host/42-an-automation-owner-rides-in-meta/plan.md) | high | built 2026-10-03 ([implemented.md](host/42-an-automation-owner-rides-in-meta/implemented.md)) | - | host 40 |
| [43 - The wire is the protocol's, and the wire test proves every frame against AHP 1.0.0](host/43-the-wire-is-the-protocols/plan.md) | high | built 2026-10-09 ([implemented.md](host/43-the-wire-is-the-protocols/implemented.md)) | host 44 p1 | ahpc run paging; ahpapp and ahpc `_meta` readers |
| [43 p1 - The wire test checks every request, result and notification against the protocol](host/43-p1-the-wire-test-checks-every-frame/plan.md) | high | built 2026-10-07 ([implemented.md](host/43-p1-the-wire-test-checks-every-frame/implemented.md)) | host 43, host 44 p1 | 43 p2, 43 p3, 43 p4 |
| [43 p2 - Results and actions are the protocol's shapes](host/43-p2-results-and-actions-are-protocol-shapes/plan.md) | high | built 2026-10-07 ([implemented.md](host/43-p2-results-and-actions-are-protocol-shapes/implemented.md)) | host 43 p1, host 44 p1 | ahpc `automationRuns` |
| [43 p3 - The root config schema is one a client can read](host/43-p3-the-root-config-schema-conforms/plan.md) | high | built 2026-10-07 ([implemented.md](host/43-p3-the-root-config-schema-conforms/implemented.md)) | host 43 p1, daemon 11, host 44 p1 | - |
| [43 p4 - Every `_meta` key ahpd invents is named `ahpd.<name>`](host/43-p4-ahpds-own-meta-keys-say-ahpd/plan.md) | high | built 2026-10-09 ([implemented.md](host/43-p4-ahpds-own-meta-keys-say-ahpd/implemented.md)) | host 43 p1, host 44 p1 | - |
| [44 - ahpd speaks AHP 1.0.0, and keeps 0.9.0](host/44-ahpd-speaks-ahp-1-0-0/plan.md) | high | built 2026-10-09 ([implemented.md](host/44-ahpd-speaks-ahp-1-0-0/implemented.md)) | - | ahpapp and ahpc moving to the 1.0.0 package; host 43 |
| [44 p1 - ahpd speaks 1.0.0 and 0.9.0](host/44-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md) | high | built 2026-10-03 ([implemented.md](host/44-p1-ahpd-speaks-1-0-0-and-0-9-0/implemented.md)) | host 44 | 44 p2, 44 p3, host 43, ahpapp on 1.0.0 |
| [44 p2 - An automation disables itself as its definition says, and a kind given twice is refused](host/44-p2-an-automation-disables-itself/plan.md) | medium | built 2026-10-09 ([implemented.md](host/44-p2-an-automation-disables-itself/implemented.md)) | host 44 p1 | - |
| [44 p3 - A session's row lists its chats with their status, and a chat is read or archived on its own](host/44-p3-a-sessions-row-lists-its-chats/plan.md) | high | built 2026-10-09 ([implemented.md](host/44-p3-a-sessions-row-lists-its-chats/implemented.md)) | host 44 p1 | - |
| [45 - The root config declares every value it holds, as VS Code's agent host declares it](host/45-root-config-declares-every-value-it-holds/plan.md) | medium | built 2026-10-09 ([implemented.md](host/45-root-config-declares-every-value-it-holds/implemented.md)) | host 44 p1, host 43 p1, host 43 p3 | - |
| [46 - The host's own surfaces are advertised with their operations, and a role grants an operation](host/46-built-in-surfaces-advertised-for-roles/plan.md) | medium | built 2026-10-04 ([implemented.md](host/46-built-in-surfaces-advertised-for-roles/implemented.md)); tasks 01-04 done; task 05 todo, `session:write` holds `chat:write` | host 44 p1 | ahpapp people/01's role editor |
| [47 - ahpd serves what AHP 1.0.0 added](host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md) | medium | built 2026-10-09 ([implemented.md](host/47-ahpd-serves-what-ahp-1-0-0-added/implemented.md)) | host 44 p1 | - |
| [47 p1 - A chat is reordered in its session, or moved to another session of the same agent and machine](host/47-p1-moving-a-chat/plan.md) | medium | built 2026-10-09 ([implemented.md](host/47-p1-moving-a-chat/implemented.md)); task 01 dropped, 02-04 done; cross-agent and cross-machine moves deferred | host 47, host 44 p1, host 50 | - |
| [47 p2 - A chat lists the shells and subagents running in its background](host/47-p2-a-chat-lists-its-background-work/plan.md) | medium | built 2026-10-09 ([implemented.md](host/47-p2-a-chat-lists-its-background-work/implemented.md)) | host 47, host 44 p1 | - |
| [47 p3 - A blocking MCP server startup can be sent to the background](host/47-p3-mcp-server-startup-can-be-backgrounded/plan.md) | low | built 2026-10-09 ([implemented.md](host/47-p3-mcp-server-startup-can-be-backgrounded/implemented.md)) | host 47, host 44 p1 | - |
| [47 p4 - A file edit is the protocol's type, and a Claude write confirmation previews its edit](host/47-p4-a-file-edit-is-the-protocols-type/plan.md) | low | built 2026-10-09 ([implemented.md](host/47-p4-a-file-edit-is-the-protocols-type/implemented.md)) | host 47, host 44 p1 | - |
| [47 p5 - An automation carries the client plugins its template names](host/47-p5-an-automation-carries-client-plugins/plan.md) | low | built 2026-10-09 ([implemented.md](host/47-p5-an-automation-carries-client-plugins/implemented.md)) | host 47, host 44 p1, host 49 | - |
| [47 p6 - A changeset being recomputed says so, and keeps its files](host/47-p6-a-changeset-says-it-is-recomputing/plan.md) | low | built 2026-10-09 ([implemented.md](host/47-p6-a-changeset-says-it-is-recomputing/implemented.md)) | host 47, host 44 p1 | - |
| [48 - host.ts is split into one file per area, and the URI routing and the grant tables are files of their own](host/48-host-is-split-by-area/plan.md) | high | built 2026-10-07 ([implemented.md](host/48-host-is-split-by-area/implemented.md)); p9-p11 reviewed and merged 2026-10-06, fixes in host 65 | plugin 29 | host 43, host 44 p2, host 44 p3, host 45, host 46, host 47 |
| [48 p1 - The grant tables and the URI names are files of their own](host/48-p1-the-grant-and-uri-tables/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-p1-the-grant-and-uri-tables/implemented.md)) | host 48, plugin 29 | 48 p2 |
| [48 p2 - The URI routing, the client relay and the connection gate are files of their own](host/48-p2-routing/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-p2-routing/implemented.md)) | host 48 p1 | 48 p3, 48 p4 |
| [48 p3 - Changesets and git and GitHub facts are files of their own, and the repository ports live in repo/](host/48-p3-changesets-and-facts/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-p3-changesets-and-facts/implemented.md)) | host 48 p2 | 48 p6 |
| [48 p4 - Telemetry, sign-in requirements, owners and machines are files of their own](host/48-p4-telemetry-owners-and-machines/plan.md) | high | built 2026-10-03 ([implemented.md](host/48-p4-telemetry-owners-and-machines/implemented.md)) | host 48 p2 | 48 p5 |
| [48 p5 - Session config and root config are files of their own](host/48-p5-session-and-root-config/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-p5-session-and-root-config/implemented.md)) | host 48 p4 | 48 p6 |
| [48 p6 - The catalogue, past sessions and snapshots are files of their own](host/48-p6-catalogue-and-transcripts/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-p6-catalogue-and-transcripts/implemented.md)) | host 48 p3, host 48 p5 | 48 p7 |
| [48 p7 - Starting, restarting and removing a session are files of their own](host/48-p7-session-lifecycle/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-p7-session-lifecycle/implemented.md)) | host 48 p6 | 48 p8 |
| [48 p8 - Session tools, terminals and automations are files of their own](host/48-p8-tools-terminals-and-automations/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-p8-tools-terminals-and-automations/implemented.md)) | host 48 p7 | 48 p9 |
| [48 p9 - The method table is split by family](host/48-p9-the-method-table/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-p9-the-method-table/implemented.md)) | host 48 p8 | 48 p10 |
| [48 p10 - Action dispatch is split by family](host/48-p10-action-dispatch/plan.md) | high | built 2026-10-04 ([implemented.md](host/48-p10-action-dispatch/implemented.md)) | host 48 p9 | 48 p11 |
| [48 p11 - Open plans cite the new files](host/48-p11-open-plans-cite-the-new-files/plan.md) | medium | built 2026-10-04 ([implemented.md](host/48-p11-open-plans-cite-the-new-files/implemented.md)) | host 48 p10 | - |
| [49 - A session loads the plugins a client hands it](host/49-a-session-loads-a-clients-plugins/plan.md) | medium | built 2026-10-09 ([implemented.md](host/49-a-session-loads-a-clients-plugins/implemented.md)) | host 44 p1 | host 47 p5 |
| [50 - A peer chat is its own conversation, and survives a restart](host/50-a-peer-chat-is-its-own-conversation/plan.md) | high | built 2026-10-09 ([implemented.md](host/50-a-peer-chat-is-its-own-conversation/implemented.md)) | - | host 47 p1 |
| [51 - A user put clears its issuer and roles-from when it says null](host/51-a-user-put-clears-issuer-and-roles-from/plan.md) | medium | built 2026-10-03 ([implemented.md](host/51-a-user-put-clears-issuer-and-roles-from/implemented.md)) | host 36 | - |
| [52 - Deleting a session deletes the backend's copy, and a listed row can be deleted](host/52-deleting-a-session-deletes-the-backends-copy/plan.md) | high | built 2026-10-04 ([implemented.md](host/52-deleting-a-session-deletes-the-backends-copy/implemented.md)); all tasks done; task 05 checked live 2026-10-13 | - | - |
| [53 - ahpd.grants lists every subject a role can name, the schemes included](host/53-ahpd-grants-lists-every-scheme/plan.md) | high | built 2026-10-04 ([implemented.md](host/53-ahpd-grants-lists-every-scheme/implemented.md)); every task done, reviewed 2026-10-10 | host 46 | ahpapp people/01's role editor |
| [54 - host.test.ts is split into one test file per area, with its helpers in one module](host/54-host-test-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](host/54-host-test-is-split-by-area/implemented.md)); every task done, reviewed 2026-10-10 | - | - |
| [55 - users-gate.test.ts is split into one test file per area, with its shared helpers in one module](host/55-users-gate-test-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](host/55-users-gate-test-is-split-by-area/implemented.md)); every task done, reviewed 2026-10-10 | - | - |
| [56 - The catalogue answers at once, and a summary is sent only when it changes](host/56-catalogue-answers-at-once-summary-on-change/plan.md) | high | built 2026-10-13 ([implemented.md](host/56-catalogue-answers-at-once-summary-on-change/implemented.md)); measured here and on dev-01 | - | - |
| [57 - pi, cofold and ACP find a session by id, and the listing throttle goes](host/57-pi-cofold-and-acp-find-a-session-by-id/plan.md) | high | built 2026-10-06 ([implemented.md](host/57-pi-cofold-and-acp-find-a-session-by-id/implemented.md)) | host 56 | - |
| [58 - Policy and automation files are private, a cursor the host did not issue is refused, and a file URI is decoded](host/58-private-files-foreign-cursors-decoded-uris/plan.md) | high | built 2026-10-06 ([implemented.md](host/58-private-files-foreign-cursors-decoded-uris/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | - | host 59, host 60 |
| [59 - People and policy are served by one record-store provider, and the value readers are one sdk module](host/59-one-record-store-and-shared-value-readers/plan.md) | medium | built 2026-10-10 ([implemented.md](host/59-one-record-store-and-shared-value-readers/implemented.md)) | host 58 | host 61, host 60 task 04 |
| [60 - JSON files are read and written through one helper, and the session store keeps one row per session](host/60-one-json-file-helper-and-one-session-row/plan.md) | medium | built 2026-10-09 | host 58 | - |
| [61 - The agents share their status, activity, title and preset reading, and the host checks tool inputs and request params one way](host/61-agents-share-session-kit-and-input-checks/plan.md) | medium | built 2026-10-10 ([implemented.md](host/61-agents-share-session-kit-and-input-checks/implemented.md)) | host 59 | - |
| [62 - Every backend calls a client's tool, acp, cofold, pi and claude, the way the protocol asks](host/62-every-backend-calls-a-clients-tool/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-every-backend-calls-a-clients-tool/implemented.md)); every child reviewed and merged 2026-10-06 | acp 11 | - |
| [62 p1 - The sdk holds a client call, raises it for the client, and runs one for the tool server](host/62-p1-the-sdk-holds-a-client-call/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-p1-the-sdk-holds-a-client-call/implemented.md)); reviewed and merged 2026-10-06 | host 62 | 62 p2, 62 p3, 62 p4 |
| [62 p2 - Claude runs its client calls through the sdk](host/62-p2-claude-runs-client-calls-through-the-sdk/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-p2-claude-runs-client-calls-through-the-sdk/implemented.md), [deferred.md](host/62-p2-claude-runs-client-calls-through-the-sdk/deferred.md)); reviewed and merged 2026-10-06 | host 62 p1 | - |
| [62 p3 - pi and cofold run their client calls through the sdk](host/62-p3-pi-and-cofold-run-client-calls-via-sdk/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-p3-pi-and-cofold-run-client-calls-via-sdk/implemented.md)); reviewed and merged 2026-10-06 | host 62 p1 | - |
| [62 p4 - An ACP agent calls a client's tool](host/62-p4-an-acp-agent-calls-a-clients-tool/plan.md) | high | built 2026-10-06 ([implemented.md](host/62-p4-an-acp-agent-calls-a-clients-tool/implemented.md), [deferred.md](host/62-p4-an-acp-agent-calls-a-clients-tool/deferred.md)); reviewed and merged 2026-10-06 | host 62 p1, acp 11 | - |
| [63 - Worktrees can live under one root](host/63-worktrees-can-live-under-one-root/plan.md) | medium | built 2026-10-06; reviewed and merged 2026-10-06 | - | - |
| [64 - What the review of host/30, host/56, daemon/13 and claude/10 found is fixed](host/64-what-the-review-of-host-30-and-56-found/plan.md) | high | built 2026-10-06 ([implemented.md](host/64-what-the-review-of-host-30-and-56-found/implemented.md)); reviewed and merged 2026-10-06 | host 30, host 56, daemon 13, claude 10 | - |
| [65 - What the review of the nine built plans found is fixed](host/65-what-the-review-of-the-nine-built-plans-found/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-what-the-review-of-the-nine-built-plans-found/implemented.md)); p1-p6 reviewed and merged 2026-10-06; the nine reviewed plans' tasks are done; p2's guard is superseded by host 67 | host 48 p9-p11, container 05 p7, container 05 p3, host 58, container 04, container 03, proxy 02, daemon 15, daemon 12 | - |
| [65 p1 - The gate refuses a method it does not know, and the proxy sends a call once](host/65-p1-the-gate-and-the-proxy/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-p1-the-gate-and-the-proxy/implemented.md)); reviewed and merged 2026-10-06 | host 65 | - |
| [65 p2 - A machine cannot change what git on the host runs, or reach another repository](host/65-p2-a-machines-git-directory/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-p2-a-machines-git-directory/implemented.md)); reviewed and merged 2026-10-06; its allowlist is superseded by host 67 | host 65, container 05 p7 | - |
| [65 p3 - A file URI keeps every character of its path, and every temp file is private and swept](host/65-p3-file-uris-and-private-files/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-p3-file-uris-and-private-files/implemented.md)); reviewed and merged 2026-10-06; the four agents' sdk range and the eight package versions at 0.10.0 (Softov's answer) | host 65, host 58 | - |
| [65 p4 - An image holds what its tag says](host/65-p4-parts/plan.md) | medium | built 2026-10-06 ([implemented.md](host/65-p4-parts/implemented.md)); reviewed and merged 2026-10-06 ([deferred.md](host/65-p4-parts/deferred.md)) | host 65, container 05 p3 | - |
| [65 p5 - A nested host has one process per session, and a dev container is made only where it is allowed](host/65-p5-nested-hosts-and-dev-containers/plan.md) | high | built 2026-10-06 ([implemented.md](host/65-p5-nested-hosts-and-dev-containers/implemented.md)); reviewed and merged 2026-10-06 | host 65, container 04, container 03 | - |
| [65 p6 - Each verb takes only what it reads, and the records name the right things](host/65-p6-small-cli-and-record-fixes/plan.md) | medium | built 2026-10-06 ([implemented.md](host/65-p6-small-cli-and-record-fixes/implemented.md)); reviewed and merged 2026-10-06 | host 65, daemon 15, daemon 12 | - |
| [66 - A session honours the folders VS Code trusts](host/66-a-session-honours-the-folders-vscode-trusts/plan.md) | high | built 2026-10-06 ([implemented.md](host/66-a-session-honours-the-folders-vscode-trusts/implemented.md)); ahpc and ahpapp must push the key ([deferred.md](host/66-a-session-honours-the-folders-vscode-trusts/deferred.md)) | - | host 45 task 01, which no longer declares `workspaceTrust` |
| [66 p1 - The host declares workspaceTrust, keeps it per connection, and asks before a session moves](host/66-p1-the-host-declares-keeps-and-asks/plan.md) | high | built 2026-10-06 ([implemented.md](host/66-p1-the-host-declares-keeps-and-asks/implemented.md)) | host 66 | 66 p2, 66 p3 |
| [66 p2 - Claude and pi load a project's files only when it is trusted](host/66-p2-claude-and-pi-load-trusted-files/plan.md) | high | built 2026-10-06 ([implemented.md](host/66-p2-claude-and-pi-load-trusted-files/implemented.md)) | host 66 p1 | - |
| [66 p3 - An ACP agent in a folder nobody trusted](host/66-p3-an-acp-agent-in-an-untrusted-folder/plan.md) | medium | built 2026-10-06 ([implemented.md](host/66-p3-an-acp-agent-in-an-untrusted-folder/implemented.md)) | host 66 p1 | - |
| [67 - A machine commits in a repository of its own, and ahpd fetches the work back](host/67-a-machine-commits-in-its-own-repository/plan.md) | high | built 2026-10-07, `sessionTree` shared or copy; supersedes host/65 p2's git allowlist | host 65 p2 (no `deferred.md` there to close), container 05 p7 | - |
| [68 - An attachment's bytes are a file the host wrote, and every backend reads attachments through one helper with one set of limits](host/68-attachment-bytes-are-a-file-the-host-wrote/plan.md) | medium | built 2026-10-07 ([implemented.md](host/68-attachment-bytes-are-a-file-the-host-wrote/implemented.md)) | - | claude 20, acp 14, pi 15, plugin 36 |
| [69 - Streamed deltas are merged for a short window in the host's dispatch, for every backend](host/69-a-streamed-delta-is-merged-before-it-goes-out/plan.md) | medium | built 2026-10-07 ([implemented.md](host/69-a-streamed-delta-is-merged-before-it-goes-out/implemented.md)); reviewed and merged | - | - |
| [70 - What the 0.10.0 release review found is fixed](host/70-what-the-release-review-found-is-fixed/plan.md) | high | built 2026-10-07 ([implemented.md](host/70-what-the-release-review-found-is-fixed/implemented.md)); reviewed and merged | - | release 0.10.0 |
| [71 - An automation wakes on what a session does](host/71-an-automation-wakes-on-what-a-session-does/plan.md) | medium | built 2026-10-07 ([implemented.md](host/71-an-automation-wakes-on-what-a-session-does/implemented.md), [deferred.md](host/71-an-automation-wakes-on-what-a-session-does/deferred.md), [diagrams](host/71-an-automation-wakes-on-what-a-session-does/diagrams.md)) | - | the bot study, step 3 |
| [72 - A plugin is told when the host closes, and the computer plugin stops its work there](host/72-a-plugin-is-told-when-the-host-closes/plan.md) | high | built 2026-10-07 ([implemented.md](host/72-a-plugin-is-told-when-the-host-closes/implemented.md)); reviewed and merged | - | release 0.10.0 |
| [73 - A role editor offers trust and proxy, the two subjects the gate asks for and does not advertise](host/73-a-role-editor-offers-trust-and-proxy/plan.md) | medium | built 2026-10-08 | - | - |
| [74 - The sdk's tools live in one folder](host/74-the-sdks-tools-live-in-one-folder/plan.md) | medium | built 2026-10-09 ([implemented.md](host/74-the-sdks-tools-live-in-one-folder/implemented.md)); 79a3541 | - | - |
| [75 - VS Code opens the uncommitted changes first](host/75-vs-code-opens-the-uncommitted-changes-first/plan.md) | medium | built 2026-10-09 ([implemented.md](host/75-vs-code-opens-the-uncommitted-changes-first/implemented.md)) | - | VS Code shows Commit |
| [76 - A commit and a pull request get their words as the host is configured](host/76-commit-and-pull-request-words-as-configured/plan.md) | medium | built 2026-10-09 ([implemented.md](host/76-commit-and-pull-request-words-as-configured/implemented.md)) | - | - |
| [77 - A client plugin lists its parts, and a part can be switched off](host/77-a-client-plugin-lists-its-parts/plan.md) | medium | built 2026-10-09 ([implemented.md](host/77-a-client-plugin-lists-its-parts/implemented.md)) | host/49 | - |
| [78 - Completions offer each slash command once](host/78-completions-offer-each-command-once/plan.md) | medium | built 2026-10-09 ([implemented.md](host/78-completions-offer-each-command-once/implemented.md)) | - | - |
| [79 - A quiet session sleeps, and wakes when something needs it](host/79-a-quiet-session-sleeps-and-wakes/plan.md) | high | built 2026-10-13 ([implemented.md](host/79-a-quiet-session-sleeps-and-wakes/implemented.md)); 95e6a02 | host/71 | 21 idle claude processes, out of swap |
| [80 - The automation store moves to the server, and an automation is a Markdown file](host/80-an-automation-is-a-markdown-file/plan.md) | medium | built 2026-10-11 ([implemented.md](host/80-an-automation-is-a-markdown-file/implemented.md)); released in 0.11.0 | plugin 45-p1 | 83 p2 |
| [81 - Users, teams, projects, roles, policies, computers and usage get typed channels and commands](host/81-host-records-get-channels-and-commands/plan.md) | high | built 2026-10-11 ([implemented.md](host/81-host-records-get-channels-and-commands/implemented.md)); ahpapp half and policy watch in [deferred.md](host/81-host-records-get-channels-and-commands/deferred.md) | plugin 44 | ahpapp typed records |
| [81 p1 - The host serves x- commands, and a plugin registers one](host/81-p1-the-host-serves-x-commands/plan.md) | high | built 2026-10-11 ([implemented.md](host/81-p1-the-host-serves-x-commands/implemented.md)) | plugin 44 | 81 p2, p3, p4 |
| [81 p2 - People and policies are channels and commands](host/81-p2-people-and-policies-are-channels/plan.md) | high | built 2026-10-11 ([implemented.md](host/81-p2-people-and-policies-are-channels/implemented.md)); policy watch in [deferred.md](host/81-p2-people-and-policies-are-channels/deferred.md) | 81 p1 | 81 p4 |
| [81 p3 - Usage is read through commands](host/81-p3-usage-is-read-through-commands/plan.md) | high | built 2026-10-11 ([implemented.md](host/81-p3-usage-is-read-through-commands/implemented.md)) | 81 p1 | - |
| [81 p4 - Computers are a channel and commands](host/81-p4-computers-are-a-channel/plan.md) | high | built 2026-10-11 ([implemented.md](host/81-p4-computers-are-a-channel/implemented.md)) | 81 p1, 81 p2 | - |
| [82 - A file or the whole changeset is staged, unstaged, discarded or committed](host/82-a-file-or-changeset-is-staged-or-committed/plan.md) | medium | built 2026-10-11 ([implemented.md](host/82-a-file-or-changeset-is-staged-or-committed/implemented.md)) | - | ahpc screen/11 |
| [83 - The host offers what VS Code's own host offers](host/83-the-host-matches-vscodes-host/plan.md) | high | active 2026-10-11; p1 to p5 built and checked; host/104 holds the \"Disable (Session)\" fix | - | VS Code window parity |
| [83 p1 - The host describes itself as VS Code's host does](host/83-p1-the-host-describes-itself/plan.md) | high | built 2026-10-11 ([implemented.md](host/83-p1-the-host-describes-itself/implemented.md)); checked on Windows in VS Code 2026-10-16 | 83 | 83 p3, 83 p5 |
| [83 p2 - A run is stopped, and runs are capped](host/83-p2-a-run-is-stopped-and-runs-are-capped/plan.md) | high | built 2026-10-11 ([implemented.md](host/83-p2-a-run-is-stopped-and-runs-are-capped/implemented.md)); checked on Windows in VS Code 2026-10-16 | 83, host 80 | - |
| [83 p3 - A remote session is taken and keeps its origin](host/83-p3-a-remote-session-keeps-its-origin/plan.md) | high | built 2026-10-11 ([implemented.md](host/83-p3-a-remote-session-keeps-its-origin/implemented.md)); checked on Windows in VS Code 2026-10-16; ACP, cofold and pi deferred | 83 p1 | - |
| [83 p4 - A customization is switched for all sessions or a folder](host/83-p4-customization-switched-for-all-sessions/plan.md) | medium | built 2026-10-11 ([implemented.md](host/83-p4-customization-switched-for-all-sessions/implemented.md)); checked on Windows in VS Code 2026-10-16 | 83 | - |
| [83 p5 - A chat is attached to a message](host/83-p5-a-chat-is-attached-to-a-message/plan.md) | low | built 2026-10-13 ([implemented.md](host/83-p5-a-chat-is-attached-to-a-message/implemented.md)); checked live | 83 p1 to p3 | - |
| [84 - The operator sets the environment of agent shells](host/84-the-operator-sets-agent-shell-environment/plan.md) | medium | built 2026-10-11 ([implemented.md](host/84-the-operator-sets-agent-shell-environment/implemented.md)); the check by hand remains; ACP, cofold and pi deferred | - | ACP, cofold and pi shells |
| [85 - A watched changeset gets its files when a turn ends](host/85-watched-changeset-gets-files-at-turn-end/plan.md) | high | built 2026-10-13 ([implemented.md](host/85-watched-changeset-gets-files-at-turn-end/implemented.md)); a session in a machine is not checked | - | - |
| [86 - Every automation due at once fires](host/86-every-automation-due-at-once-fires/plan.md) | high | built 2026-10-16 ([implemented.md](host/86-every-automation-due-at-once-fires/implemented.md)) | - | - |
| [87 - A turn is refused while one runs](host/87-a-turn-is-refused-while-one-runs/plan.md) | high | built 2026-10-16 ([implemented.md](host/87-a-turn-is-refused-while-one-runs/implemented.md)) | - | - |
| [88 - A 0.10.0 offer gets the 1.0.0 contract](host/88-a-0-10-0-offer-gets-the-1-0-0-contract/plan.md) | high | built 2026-10-15 ([implemented.md](host/88-a-0-10-0-offer-gets-the-1-0-0-contract/implemented.md)) | - | - |
| [89 - Chat and session read state stay in step](host/89-chat-and-session-read-state-stay-in-step/plan.md) | high | built 2026-10-15 ([implemented.md](host/89-chat-and-session-read-state-stay-in-step/implemented.md)) | - | - |
| [90 - An archived session gives back its worktree](host/90-an-archived-session-gives-back-its-worktree/plan.md) | medium | built 2026-10-15 ([implemented.md](host/90-an-archived-session-gives-back-its-worktree/implemented.md)) | - | 91 |
| [91 - Merged sessions archive and delete themselves](host/91-merged-sessions-archive-and-delete-themselves/plan.md) | medium | built 2026-10-15 ([implemented.md](host/91-merged-sessions-archive-and-delete-themselves/implemented.md)) | 90 | - |
| [92 - A session keeps its working folder, and the backends find it there after a restart](host/92-a-session-keeps-its-working-folder/plan.md) | high | built 2026-10-15 | 57 | - |
| [93 - A turn lets go of its sender at every end](host/93-a-turn-lets-go-of-its-sender-at-every-end/plan.md) | medium | built 2026-10-15 ([implemented.md](host/93-a-turn-lets-go-of-its-sender-at-every-end/implemented.md)) | - | - |
| [94 - VS Code lists ahpd's automations](host/94-vscode-lists-ahpds-automations/plan.md) | high | built 2026-10-15 ([implemented.md](host/94-vscode-lists-ahpds-automations/implemented.md)) | - | - |
| [95 - An automation moves as VS Code's file](host/95-an-automation-moves-as-vscodes-file/plan.md) | medium | built 2026-10-16 | - | - |
| [96 - A plain request tests the token](host/96-a-plain-request-tests-the-token/plan.md) | medium | active; tasks 01-02 implemented and reviewed; the browser check remains | - | ahpw sign-in |
| [97 - An unchanged client set is echoed back](host/97-an-unchanged-client-set-is-echoed-back/plan.md) | medium | built 2026-10-16 | - | - |
| [98 - A client rule reaches the system prompt](host/98-a-client-rule-reaches-the-system-prompt/plan.md) | medium | built 2026-10-19; [implemented.md](host/98-a-client-rule-reaches-the-system-prompt/implemented.md) | - | - |
| [99 - A client sees the agent account](host/99-a-client-sees-the-agent-account/plan.md) | low | active 2026-10-16; merged, waits on the check by hand | - | - |
| [100 - Terminal commands approved by rule](host/100-terminal-commands-approved-by-rule/plan.md) | medium | planned 2026-10-16; parent of p1 to p6; p1 and p3 to p6 built, p2 waits on its [review](../pending/host-100-p2-review.md) | - | 101 |
| [100 p1 - A command is split and matched](host/100-p1-a-command-is-split-and-matched/plan.md) | medium | active 2026-10-16; tasks 01 to 04 implemented | 100 | 100 p2, 100 p3 |
| [100 p2 - A session gets its owner's command check](host/100-p2-a-session-gets-its-owners-command-check/plan.md) | medium | active 2026-10-20; tasks 01 to 03 implemented; reviewed 2026-10-20, [review](../pending/host-100-p2-review.md) waits on Softov | 100 p1 | 100 p4, 100 p5, 101 |
| [100 p3 - Another parser replaces the splitter](host/100-p3-another-parser-replaces-the-splitter/plan.md) | medium | active 2026-10-19; tasks 01 to 03 implemented | 100 p1 | - |
| [100 p4 - Claude and ACP ask only for unmatched commands](host/100-p4-claude-and-acp-ask-for-unmatched-commands/plan.md) | medium | active 2026-10-18; task 01 and task 02 implemented | 100 p2 | - |
| [100 p5 - pi and cofold ask only for unmatched commands](host/100-p5-pi-and-cofold-ask-for-unmatched-commands/plan.md) | medium | active 2026-10-19; task 01 and task 02 implemented | 100 p2 | - |
| [100 p6 - The docs name the terminal rules](host/100-p6-the-docs-name-the-terminal-rules/plan.md) | medium | active 2026-10-19; task 01 implemented | 100 p1 to p5 | - |
| [101 - A rule makes a tool call ask every time](host/101-a-rule-makes-a-tool-call-ask-every-time/plan.md) | medium | active 2026-10-19; tasks 01 to 06 implemented | 100 p2 | - |
| [102 - Verify a JWT locally](host/102-verify-a-jwt-locally/plan.md) | low | built 2026-10-19; [implemented.md](host/102-verify-a-jwt-locally/implemented.md) | - | - |
| [103 - A row's diff stat is the session's own work](host/103-a-rows-diff-stat-is-the-sessions-work/plan.md) | medium | active 2026-10-16; tasks 01 to 06 implemented; [problem](../problems/a-sessions-changes-are-kept-under-two-keys.md) open; [drawing check](../pending/host-103-drawing-checks.md) pending | - | - |
| [104 - A session switch on a built-in stays](host/104-a-session-switch-on-a-builtin-stays/plan.md) | medium | active 2026-10-16; merged, waits on the check by hand | - | - |
| [105 - A synced skill is named by its plugin](host/105-a-synced-skill-is-named-by-its-plugin/plan.md) | medium | active 2026-10-16; merged, waits on the check by hand | - | - |
| [106 - A slow client is bounded](host/106-a-slow-client-is-bounded/plan.md) | medium | built 2026-10-16 | - | - |
| [107 - A chat is served by a backend of its own](host/107-a-chat-is-served-by-a-backend-of-its-own/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #71 | - | plugin 52 p14 |
| [108 - A person mints tokens of their own](host/108-a-person-mints-tokens-of-their-own/plan.md) | medium | active 2026-10-20; tasks 01 to 07 implemented; [checks by hand](../pending/host-108-token-checks.md) pending | - | - |
| [109 - A session outside the paths stays listed](host/109-a-session-outside-the-paths-stays-listed/plan.md) | high | active 2026-10-18; task 01 implemented; [Ember check](../pending/host-109-ember-checks.md) pending | - | - |
| [110 - A gone folder leaves the session summary](host/110-a-gone-folder-leaves-the-session-summary/plan.md) | medium | built 2026-10-19; [implemented.md](host/110-a-gone-folder-leaves-the-session-summary/implemented.md) | - | - |
| [111 - The sdk files sit in domain folders](host/111-the-sdk-files-sit-in-domain-folders/plan.md) | medium | built 2026-10-21 (implemented.md); merged in #54 | - | - |
| [112 - A listing answers the caller's own records](host/112-a-listing-answers-the-callers-own-records/plan.md) | medium | built 2026-10-21 (implemented.md); merged in #56 | - | plugin 52 |
| [113 - A person's own token names them at the door](host/113-a-persons-token-names-them-at-the-door/plan.md) | high | built 2026-10-21 (implemented.md); merged in #60 | - | - |
| [114 - A subscribe with no view gets every turn](host/114-a-subscribe-with-no-view-gets-every-turn/plan.md) | medium | draft 2026-10-22 | - | - |
| [115 - A background task has one shape](host/115-a-background-task-has-one-shape/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #72 | host 47 p2 | - |
| [116 - A plugin opens a canvas on a chat](host/116-a-plugin-opens-a-canvas-on-a-chat/plan.md) | medium | draft 2026-10-22 | - | - |
| [117 - ahpd speaks AHP 1.1.0](host/117-ahpd-speaks-ahp-1-1-0/plan.md) | medium | draft 2026-10-22; not built until AHP 1.1.0 is released | AHP 1.1.0 | - |
| [118 - A connector action runs as a tool](host/118-a-connector-action-runs-as-a-tool/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #73 | plugin 53 | plugin 50 |
| [119 - A row counts the work while a turn runs](host/119-a-row-counts-the-work-while-a-turn-runs/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #74 | - | - |
| [120 - A bot session starts with its actions](host/120-a-bot-session-starts-with-its-actions/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #78 | host 118 | - |

Next free number in `host`: `121`.

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
| [10 - A Claude session runs on a preset, and the ahpd-only chips move into it](claude/10-a-claude-session-runs-on-a-preset/plan.md) | high | built 2026-10-09 ([implemented.md](claude/10-a-claude-session-runs-on-a-preset/implemented.md)) | host 31 | - |
| [11 - An answered AskUserQuestion call carries its answers, live and after a restart](claude/11-an-answered-question-carries-its-answers/plan.md) | medium | built 2026-10-04 ([implemented.md](claude/11-an-answered-question-carries-its-answers/implemented.md)) | claude 08 | ahpapp chat/01 |
| [12 - A second Claude harness runs on another endpoint, named on its own and keyed from the daemon's environment](claude/12-a-second-claude-runs-on-another-endpoint/plan.md) | medium | built 2026-10-02 ([implemented.md](claude/12-a-second-claude-runs-on-another-endpoint/implemented.md)) | claude 10 | - |
| [13 - A Claude harness offers the models it is told, written or fetched from an endpoint](claude/13-a-claude-harness-offers-the-models-it-is-told/plan.md) | medium | built 2026-10-02 ([implemented.md](claude/13-a-claude-harness-offers-the-models-it-is-told/implemented.md)) | claude 12 | - |
| [14 - A model the CLI rejects fails the turn that asked for it](claude/14-a-rejected-model-fails-the-turn/plan.md) | high | built 2026-10-02 ([implemented.md](claude/14-a-rejected-model-fails-the-turn/implemented.md)) | claude 13 | - |
| [15 - A Claude plugin is loaded once, and each preset is a variant with its own name and models](claude/15-one-load-and-each-preset-is-a-variant/plan.md) | high | built 2026-10-02 ([implemented.md](claude/15-one-load-and-each-preset-is-a-variant/implemented.md)) | claude 10, 12, 13 | the ACP presets plan |
| [16 - A Claude preset that cannot be resolved skips only itself](claude/16-a-preset-that-fails-skips-only-itself/plan.md) | high | built 2026-10-03 ([implemented.md](claude/16-a-preset-that-fails-skips-only-itself/implemented.md)) | claude 15 | - |
| [17 - A Claude subagent chat opens with its task's description as title and its prompt as the first message](claude/17-a-subagent-chat-opens-with-its-task/plan.md) | high | built 2026-10-04 ([implemented.md](claude/17-a-subagent-chat-opens-with-its-task/implemented.md)); every task done, reviewed 2026-10-10 | - | - |
| [18 - session.ts is split into one file per area, and session.ts only composes them](claude/18-session-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](claude/18-session-is-split-by-area/implemented.md)); every task done, reviewed 2026-10-10 | - | - |
| [19 - An AskUserQuestion shows each question's header, and an answer shows on every client at once with its typed text reaching the tool](claude/19-a-question-shows-headers-and-answer-at-once/plan.md) | high | built | claude 11 | - |
| [20 - A Claude turn reads its message's attachments, queued and steered ones included](claude/20-a-claude-turn-reads-its-attachments/plan.md) | medium | built 2026-10-07 ([implemented.md](claude/20-a-claude-turn-reads-its-attachments/implemented.md), [deferred.md](claude/20-a-claude-turn-reads-its-attachments/deferred.md)) | host 68 | ahpapp `chat/03` for Claude sessions |
| [21 - A client's tools reach the agent whole and on time](claude/21-client-tools-reach-agent-whole-and-on-time/plan.md) | high | built 2026-10-11 ([implemented.md](claude/21-client-tools-reach-agent-whole-and-on-time/implemented.md)); the VS Code check by hand remains | - | - |
| [22 - A Claude session fails cleanly](claude/22-a-claude-session-fails-cleanly/plan.md) | medium | built 2026-10-11 ([implemented.md](claude/22-a-claude-session-fails-cleanly/implemented.md)) | - | - |
| [23 - agent-claude is on the Claude Agent SDK 0.3.301](claude/23-agent-claude-is-on-agent-sdk-0-3-301/plan.md) | medium | built 2026-10-16 ([implemented.md](claude/23-agent-claude-is-on-agent-sdk-0-3-301/implemented.md)) | - | - |

Next free number in `claude`: `24`.

## documentation

Reference: [00-documentation.md](documentation/00-documentation.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The stale prose matches the code again](documentation/01-correct-the-stale-prose/plan.md) | low | built 2026-09-20 ([implemented.md](documentation/01-correct-the-stale-prose/implemented.md)) | - | - |
| [02 - Captures are taken and read with ahpc, and ahpd keeps no proxy or capture check](documentation/02-captures-are-taken-and-read-with-ahpc/plan.md) | medium | dropped 2026-10-11 ([deferred.md](documentation/02-captures-are-taken-and-read-with-ahpc/deferred.md)) | - | - |
| [03 - Each area of the host has one doc](documentation/03-each-area-of-the-host-has-one-doc/plan.md) | medium | built 2026-10-08 ([implemented.md](documentation/03-each-area-of-the-host-has-one-doc/implemented.md)); reviewed and merged 2026-10-08 (210143a) | - | - |
| [04 - Each package's README says how to use it, how to configure it and what each option does](documentation/04-each-package-readme-says-how-to-use-it/plan.md) | medium | built 2026-10-09 ([implemented.md](documentation/04-each-package-readme-says-how-to-use-it/implemented.md)); 7356624 | - | - |
| [05 - The docs are a site on GitHub Pages, in server, sdk and plugins folders](documentation/05-the-docs-are-a-site-on-github-pages/plan.md) | medium | built 2026-10-15 | - | the same site in ahpc, which copies its shape |

Next free number in `documentation`: `06`.

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
| [18 - The ACP bridge resumes, forks and asks](plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md) | medium | built 2026-10-10 ([implemented.md](plugin/18-the-acp-bridge-resumes-forks-and-asks/implemented.md)); ACP v2 in [deferred.md](plugin/18-the-acp-bridge-resumes-forks-and-asks/deferred.md) | plugin 07, host 19 (task 02 after host 19 task 01) | - |
| [19 - A docker machine may run under gVisor](plugin/19-a-docker-machine-may-run-under-gvisor/plan.md) | low | built 2026-10-12 ([implemented.md](plugin/19-a-docker-machine-may-run-under-gvisor/implemented.md)) | plugin 10 | - |
| [20 - A plugin is a client of its own host, as a principal of its own](plugin/20-a-plugin-is-a-client-of-its-own-host/plan.md) | high | built 2026-10-10 ([implemented.md](plugin/20-a-plugin-is-a-client-of-its-own-host/implemented.md)) | plugin 01, host 11 | plugin 21, and every gateway, trigger and facade plugin |
| [21 - A plugin serves an HTTP route on the daemon's listener](plugin/21-a-plugin-serves-an-http-route/plan.md) | medium | built 2026-10-04 ([implemented.md](plugin/21-a-plugin-serves-an-http-route/implemented.md)) | daemon 05, plugin 20 | webhook, callback and facade plugins |
| [22 - A cofold write lands on the file its check allowed, and not on one that changed since it was read](plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) | medium | built 2026-10-09 ([implemented.md](plugin/22-a-cofold-write-lands-where-it-was-allowed/implemented.md)) | plugin 14 | - |
| [23 - A cofold session reopens on the model its turns ran on](plugin/23-a-cofold-session-keeps-its-model/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/23-a-cofold-session-keeps-its-model/implemented.md)) | plugin 14 | - |
| [24 - The log says when each plugin starts loading and how long it took](plugin/24-the-log-times-each-plugin/plan.md) | medium | built 2026-09-28 ([implemented.md](plugin/24-the-log-times-each-plugin/implemented.md)) | plugin 01 | - |
| [25 - A plugin's agent sees every path the daemon serves](plugin/25-a-plugin-agent-sees-every-served-path/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/25-a-plugin-agent-sees-every-served-path/implemented.md)) | plugin 01 | - |
| [26 - A plugin declares a schema for its options, and the loader checks it](plugin/26-a-plugin-declares-its-options-schema/plan.md) | medium | built 2026-09-28 ([implemented.md](plugin/26-a-plugin-declares-its-options-schema/implemented.md)) | daemon 08 | - |

| [27 - An answer given the moment a cofold request opens reaches the run](plugin/27-an-early-answer-reaches-the-paused-run/plan.md) | high | built 2026-09-28 ([implemented.md](plugin/27-an-early-answer-reaches-the-paused-run/implemented.md)) | plugin 03 | - |

| [28 - A test that ends a session waits for its cleanup to finish before removing its folder](plugin/28-a-closed-session-test-waits-for-its-run/plan.md) | high | built 2026-09-29 ([implemented.md](plugin/28-a-closed-session-test-waits-for-its-run/implemented.md)) | plugin 27 | - |

| [29 - A tool call says when it started and how long it ran, live and in history](plugin/29-a-tool-call-says-when-it-ran/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-a-tool-call-says-when-it-ran/implemented.md)) | - | - |
| [29 p1 - The sdk has one helper that builds and keeps a tool call's timing _meta](plugin/29-p1-the-sdk-keeps-a-calls-times/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-p1-the-sdk-keeps-a-calls-times/implemented.md)) | plugin 29 | - |
| [29 p2 - Claude tool calls carry their start and end, live and restored](plugin/29-p2-claude-stamps-its-calls/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-p2-claude-stamps-its-calls/implemented.md)) | plugin 29 | - |
| [29 p3 - pi tool calls carry their start and end, live and restored](plugin/29-p3-pi-stamps-its-calls/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-p3-pi-stamps-its-calls/implemented.md)) | plugin 29 | - |
| [29 p4 - ACP tool calls carry their start and end while the daemon runs](plugin/29-p4-acp-stamps-its-calls/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-p4-acp-stamps-its-calls/implemented.md)) | plugin 29 | - |
| [29 p5 - cofold tool calls carry their start and end live too, and restored calls keep their kind](plugin/29-p5-cofold-stamps-its-live-calls/plan.md) | medium | built 2026-10-03 ([implemented.md](plugin/29-p5-cofold-stamps-its-live-calls/implemented.md)) | plugin 29 | - |

| [30 - Two more tests wait for what their session is still doing](plugin/30-two-more-tests-wait-for-their-session/plan.md) | high | built 2026-09-30 ([implemented.md](plugin/30-two-more-tests-wait-for-their-session/implemented.md)) | plugin 28 | - |
| [31 - A plugin file takes the nearest manifest only when it is a plugin's](plugin/31-a-plugin-file-takes-only-a-plugin-manifest/plan.md) | low | built 2026-10-07 ([implemented.md](plugin/31-a-plugin-file-takes-only-a-plugin-manifest/implemented.md)); task 01 reviewed 2026-10-06 | - | - |

| [32 - A turn's usage is every model call it made, sent as it runs, with the harness's cost](plugin/32-a-turns-usage-is-every-call-it-made/plan.md) | high | built 2026-10-01; p1-p4 | - | the agent meter |
| [32 p1 - claude counts every call, subagents and cache writes included, with its cost](plugin/32-p1-claude-counts-every-call/plan.md) | high | built 2026-10-01 ([implemented.md](plugin/32-p1-claude-counts-every-call/implemented.md)) | plugin 32 | - |
| [32 p2 - pi sums every call of a turn, with its cost](plugin/32-p2-pi-sums-its-calls/plan.md) | high | built 2026-10-01 ([implemented.md](plugin/32-p2-pi-sums-its-calls/implemented.md)) | plugin 32 | - |
| [32 p3 - cofold counts each step, and sends the run's cost](plugin/32-p3-cofold-counts-each-step/plan.md) | high | built 2026-10-01 ([implemented.md](plugin/32-p3-cofold-counts-each-step/implemented.md)) | plugin 32 | - |
| [32 p4 - ACP sends the cost and tokens its agent reports](plugin/32-p4-acp-reports-what-it-has/plan.md) | medium | built 2026-10-01 ([implemented.md](plugin/32-p4-acp-reports-what-it-has/implemented.md)) | plugin 32 | - |

| [33 - A phone hears when a session needs a person](plugin/33-a-phone-hears-a-session-needs-a-person/plan.md) | high | built 2026-10-10 ([implemented.md](plugin/33-a-phone-hears-a-session-needs-a-person/implemented.md)) | plugin 17 | - |
| [34 - The cofold session is split into one file per area, and session.ts composes them](plugin/34-cofold-session-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](plugin/34-cofold-session-is-split-by-area/implemented.md)); every task done, reviewed 2026-10-10 | - | - |
| [35 - A cofold session uses what published cofold already ships - listed models with their price, compaction, and a question for the person](plugin/35-cofold-uses-what-cofold-ships/plan.md) | high | built 2026-10-06 ([implemented.md](plugin/35-cofold-uses-what-cofold-ships/implemented.md)); reviewed and merged 2026-10-06 | plugin 05, plugin 32 p3 | - |
| [36 - A cofold turn reads its message's attachments, and sends an image only to a model that takes images](plugin/36-a-cofold-turn-reads-its-attachments/plan.md) | medium | built 2026-10-09 | host 68, plugin 40 | - |
| [37 - A bot is a record a person makes, with a session to talk to it in](plugin/37-a-bot-is-a-record-with-a-session/plan.md) | high | built 2026-10-08 ([implemented.md](plugin/37-a-bot-is-a-record-with-a-session/implemented.md)); 01 and 03 (1a3ee7a), 02, 04 and 05 (6fb1289) | plugin 09 as the pattern | the bot harness, a bot as a principal, the ahpc and ahpapp bot screens |
| [38 - A plugin cannot change what the host gave it](plugin/38-a-plugin-cannot-change-what-the-host-gave-it/plan.md) | high | built 2026-10-09 ([implemented.md](plugin/38-a-plugin-cannot-change-what-the-host-gave-it/implemented.md)); 01-06 (9f3798c) | plugin 37 (built on it) | plugins out of process |
| [39 - Each optionsSchema declares every field the code reads](plugin/39-each-options-schema-declares-every-field/plan.md) | medium | built 2026-10-09 ([implemented.md](plugin/39-each-options-schema-declares-every-field/implemented.md)); 23710ef | documentation 04 | - |
| [40 - ahpd runs on the current cofold release, and keeps no copy of what cofold now ships](plugin/40-ahpd-runs-on-the-current-cofold/plan.md) | high | built 2026-10-09 ([implemented.md](plugin/40-ahpd-runs-on-the-current-cofold/implemented.md)) | plugin 35 | - |
| [41 - A bot's colour is a name or a hex colour](plugin/41-a-bot-colour-is-a-name-or-a-hex/plan.md) | high | built 2026-10-10 ([implemented.md](plugin/41-a-bot-colour-is-a-name-or-a-hex/implemented.md)) | plugin 37 | ahpapp bots on the host |
| [42 - A reserved name is refused for a scheme and a harness](plugin/42-a-reserved-name-is-refused/plan.md) | high | built 2026-10-10 ([implemented.md](plugin/42-a-reserved-name-is-refused/implemented.md)) | - | plugin 43, plugin 44 |
| [43 - A bot can be watched](plugin/43-a-bot-can-be-watched/plan.md) | high | built 2026-10-10 ([implemented.md](plugin/43-a-bot-can-be-watched/implemented.md)) | plugin 42 | - |
| [44 - A plugin serves a channel, and bots have a catalogue](plugin/44-a-plugin-serves-a-channel/plan.md) | high | built 2026-10-10 ([implemented.md](plugin/44-a-plugin-serves-a-channel/implemented.md)) | plugin 42 | ahpapp and ahpc bot catalogue |
| [45 - A plugin keeps its records in the host's record store, and the bot keeps its records there](plugin/45-a-plugin-keeps-records-in-the-host-store/plan.md) | medium | built 2026-10-11; p1 and p2 built, p2 awaiting review | plugin 43, cofold commands/05 | plugin 49 |
| [45 p1 - The host gives each plugin a record store](plugin/45-p1-the-host-gives-a-record-store/plan.md) | medium | built 2026-10-11 ([implemented.md](plugin/45-p1-the-host-gives-a-record-store/implemented.md)) | cofold commands/05 | 45 p2, host 80 |
| [45 p2 - The bot keeps its records in the record store](plugin/45-p2-the-bot-keeps-its-records-there/plan.md) | medium | built 2026-10-11 ([implemented.md](plugin/45-p2-the-bot-keeps-its-records-there/implemented.md)); released in 0.11.0; awaiting review | 45 p1 | - |
| [46 - An admin makes a bot for any owner, and the manifest names the host owner](plugin/46-an-admin-makes-a-bot-for-any-owner/plan.md) | high | built 2026-10-11 ([implemented.md](plugin/46-an-admin-makes-a-bot-for-any-owner/implemented.md)) | plugin 37 | ahpapp bot owner picker |
| [47 - A bot runs in a machine](plugin/47-a-bot-runs-in-a-machine/plan.md) | high | draft 2026-10-13; tasks not written | plugin 37 | container/05 p8 question |
| [48 - A webhook talks to a bot or fires an automation](plugin/48-a-webhook-starts-a-bot-or-an-automation/plan.md) | medium | built 2026-10-15 | plugin 21, 37, 45 p1 | issue and chat initiators |
| [49 - A bot's first turn is a template](plugin/49-a-bots-first-turn-is-a-template/plan.md) | medium | built 2026-10-15 ([implemented.md](plugin/49-a-bots-first-turn-is-a-template/implemented.md)) | plugin 45 p2 | - |
| [50 - A connector plugin runs Activepieces pieces as tools](plugin/50-a-connector-plugin-runs-activepieces-pieces/plan.md) | medium | active 2026-10-23; tasks 01 to 05 implemented, with the checks by hand in [pending](pending/plugin-50-first-pieces.md) | host 118, plugin 53 | OAuth and Instagram connectors |
| [51 - A plugin id is a slug](plugin/51-a-plugin-id-is-a-slug/plan.md) | high | built 2026-10-16 ([implemented.md](plugin/51-a-plugin-id-is-a-slug/implemented.md)) | daemon 19 | ahpw `/plugins/web/` |
| [52 - A person talks with a bot in a chat of their own](plugin/52-a-bot-manages-and-delegates/plan.md) | medium | draft 2026-10-16; parent of p1 to p14 | plugin 49 | - |
| [52 p1 - The host keeps one task list](plugin/52-p1-the-host-keeps-one-task-list/plan.md) | medium | built 2026-10-19; [implemented.md](plugin/52-p1-the-host-keeps-one-task-list/implemented.md) | 52 | 52 p12, 52 p13 |
| [52 p2 - A bot chat is a session with no harness](plugin/52-p2-a-bot-chat-is-a-session-with-no-harness/plan.md) | medium | built 2026-10-16 | 52 | 52 p3 |
| [52 p3 - A message wakes the bot and it replies](plugin/52-p3-a-message-wakes-the-bot-and-it-replies/plan.md) | medium | active 2026-10-17; 16 tasks, all implemented | 52 p2 | 52 p7, 52 p8, 52 p14 |
| [52 p4 - A group chat has members and mentions](plugin/52-p4-a-group-chat-has-members-and-mentions/plan.md) | medium | dropped 2026-10-22; merged into 52 p14 | 52 p3, 52 p11 | - |
| [52 p5 - A bot is made with its AGENTS.md](plugin/52-p5-a-bot-is-made-with-its-agents-file/plan.md) | medium | dropped 2026-10-17; moved into 52 p3 tasks 10 and 11 | 52 p3 | - |
| [52 p6 - A bot wakes when a session it started finishes](plugin/52-p6-a-bot-wakes-when-a-session-it-started-finishes/plan.md) | medium | dropped 2026-10-22; merged into 52 p14 | 52 p3 | - |
| [52 p7 - A manager bot edits only its own folder](plugin/52-p7-a-manager-bot-edits-only-its-own-folder/plan.md) | medium | draft 2026-10-16; tasks not written | 52 p3, host 100 p2, host 101 | - |
| [52 p8 - AGENTS.md is the bot's one copy](plugin/52-p8-agents-md-is-the-bots-one-copy/plan.md) | medium | active 2026-10-17; 6 tasks, 01, 02, 05 and 06 implemented | 52 p3 | - |
| [52 p9 - Front and Back are chats of one session](plugin/52-p9-front-and-back-are-chats-of-one-session/plan.md) | medium | dropped 2026-10-22; merged into 52 p14 | 52 p3, host 107 | - |
| [52 p10 - A bot changes bots with a tool](plugin/52-p10-a-bot-changes-bots-with-a-tool/plan.md) | medium | draft 2026-10-18; tasks not written | 52 p8 | - |
| [52 p11 - A bot has a private session](plugin/52-p11-a-bot-has-a-private-session/plan.md) | medium | dropped 2026-10-22; merged into 52 p14 | 52 p9 | - |
| [52 p12 - Claude and ACP write the task list](plugin/52-p12-claude-and-acp-write-the-task-list/plan.md) | medium | active 2026-10-18; tasks 01 to 07 implemented; title answer recorded | 52 p1 | - |
| [52 p13 - A client sees the task list](plugin/52-p13-a-client-sees-the-task-list/plan.md) | medium | active 2026-10-18; 5 tasks, 01, 02, 03 and 05 implemented; 04 done 2026-10-19 | 52 p1 | - |
| [52 p14 - A bot session has a Front, Backs and wakes](plugin/52-p14-a-bot-session-has-a-front-and-backs/plan.md) | medium | draft 2026-10-22; merged from 52 p4, p6, p9, p11 and p7's permission mode; tasks not written | 52 p3, host 107 | - |
| [52 - The computer and bot listings answer the caller's own](plugin/52-the-computer-and-bot-listings-answer-the-callers-own/plan.md) | medium | built 2026-10-21 (implemented.md); merged in #59 | host 112 | - |
| [53 - A client sees the plugins and the connectors](plugin/53-a-client-sees-plugins-and-connectors/plan.md) | medium | active 2026-10-22; sixteen tasks, all implemented, awaiting review | plugin 44, plugin 48 | ahpw connectors and plugins pages, the UI component tree, connector actions as tools |
| [54 - A webhook takes what real senders send](plugin/54-a-webhook-takes-what-real-senders-send/plan.md) | high | planned 2026-10-22; seven tasks, 01 to 07 implemented, awaiting review | plugin 48, plugin 53 | - |
| [55 - The connectors channel opens to a list reader, and a receive capability names its path](plugin/55-connectors-open-to-a-list-reader/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #69 | plugin 53, plugin 54 | - |
| [56 - A steered bot chat message is its own turn](plugin/56-a-steered-bot-message-is-its-own-turn/plan.md) | high | planned 2026-10-22; one task, implemented | - | - |
| [57 - A cofold transcript skips a run that a rewind dropped while it reads](plugin/57-a-transcript-skips-a-run-a-rewind-dropped/plan.md) | medium | built 2026-10-23 (implemented.md); merged in #70 | - | - |
| [58 - Plugins and adapters carry icons](plugin/58-plugins-and-adapters-carry-icons/plan.md) | medium | active 2026-10-23; tasks 01-03 merged in #80; 04 and 05 implemented, and 05 waits for icon curation | - | - |
| [59 - A plugin loads, unloads and reloads while the daemon runs](plugin/59-a-plugin-loads-and-unloads-live/plan.md) | medium | active 2026-10-23; four tasks, all implemented | - | - |
| [60 - A connector shows whether it works](plugin/60-a-connector-shows-whether-it-works/plan.md) | medium | active 2026-10-23; four tasks, all implemented | - | proxy 04 |
| [61 - A plugin icon has a dark variant](plugin/61-a-plugin-icon-has-a-dark-variant/plan.md) | medium | built 2026-10-24 ([implemented.md](plugin/61-a-plugin-icon-has-a-dark-variant/implemented.md)); merged in #86 | plugin 58 | - |
| [62 - A working connector is ready, not open](plugin/62-a-working-connector-is-ready/plan.md) | medium | active 2026-10-24; one task, implemented | - | - |

Next free number in `plugin`: `63`.

## container

Reference: [00-container.md](container/00-container.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A session in a dev container, with its whole host inside it](container/01-a-session-in-a-dev-container/plan.md) | high | built 2026-09-24, except its `ahpapp` half ([implemented.md](container/01-a-session-in-a-dev-container/implemented.md)) | plugin 11, plugin 12 | an ahpapp plan, which drives the same four methods |
| [02 - VS Code offers a dev container on a folder served by ahpd](container/02-vscode-offers-our-dev-container/plan.md) | high | active 2026-10-10; task 04 done; tasks 01-03 blocked on Softov's Windows VS Code run | container 01; task 04 also container 03, plugin 16 | - |
| [03 - A dev container is a computer, listed and reachable without the connection that made it](container/03-a-dev-container-is-a-computer/plan.md) | medium | built 2026-10-05 ([implemented.md](container/03-a-dev-container-is-a-computer/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | container 01, plugin 15 | - |
| [04 - A cofold session in a computer runs in an ahpd started inside it](container/04-a-cofold-session-in-a-computer/plan.md) | medium | built 2026-10-06 ([implemented.md](container/04-a-cofold-session-in-a-computer/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | plugin 14, plugin 15 | - |
| [05 - An agent in a machine is built once, started fast, and reached from anywhere](container/05-an-agent-in-a-machine/plan.md) | high | active, a parent of twelve child plans; p1-p7 and p9 built; p11 dropped 2026-10-22, merged into p8 | plugin 15, plugin 16, container 04, container 03, claude 15 | the next agent and plugin plans |
| [05 p1 - A secret reaches a machine in its environment, never in its argv](container/05-p1-a-secret-reaches-a-machine-by-name/plan.md) | high | built 2026-10-05 ([implemented.md](container/05-p1-a-secret-reaches-a-machine-by-name/implemented.md)); every task done, reviewed 2026-10-10 | container 05, container 03 | 05 p2 |
| [05 p2 - An ACP preset says what its machine needs](container/05-p2-an-acp-agent-says-what-its-machine-needs/plan.md) | high | built 2026-10-05 ([implemented.md](container/05-p2-an-acp-agent-says-what-its-machine-needs/implemented.md)); tasks 01, 04, 05 done, reviewed 2026-10-10; 02, 03 dropped | container 05 p1, acp 05 | 05 p5 |
| [05 p3 - Parts are built from one versions file, and the joined image from the same file](container/05-p3-parts-are-built-from-one-versions-file/plan.md) | high | built 2026-10-04 ([implemented.md](container/05-p3-parts-are-built-from-one-versions-file/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | container 05 | 05 p4 |
| [05 p4 - A part is mounted into a machine, from its image or from a volume](container/05-p4-a-part-is-mounted-into-a-machine/plan.md) | high | built 2026-10-05 ([implemented.md](container/05-p4-a-part-is-mounted-into-a-machine/implemented.md)); every task done, reviewed 2026-10-10 | container 05 p3, plugin 15, container 03 | 05 p5 |
| [05 p5 - Agents run from their parts and keep their own state, and the host's binary and home become opt-ins](container/05-p5-agents-run-from-their-parts/plan.md) | high | built 2026-10-06 ([implemented.md](container/05-p5-agents-run-from-their-parts/implemented.md)); reviewed and merged 2026-10-06 | container 05 p2, container 05 p3, container 05 p4, container 05 p6, container 04, claude 15, plugin 15, acp 05 | 05 p8, 05 p9 |
| [05 p6 - An agent's configuration lives in a volume per profile, seeded from the host once](container/05-p6-agent-configuration-lives-in-a-volume/plan.md) | high | built 2026-10-06 ([implemented.md](container/05-p6-agent-configuration-lives-in-a-volume/implemented.md)); every task done, reviewed 2026-10-10 | container 05 | 05 p5 |
| [05 p7 - A worktree reaches its machine with the repository it belongs to](container/05-p7-a-worktree-brings-its-repository/plan.md) | high | built 2026-10-06 ([implemented.md](container/05-p7-a-worktree-brings-its-repository/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | plugin 16, container 03 | 05 p8 |
| [05 p8 - A profile's machines may live on another Docker or in a VM](container/05-p8-a-profile-on-another-docker/plan.md) | medium | planned 2026-10-03; p11 merged in 2026-10-22; tasks 01-13 todo | container 05 p3, container 05 p5, container 05 p7, container 05 p9 | - |
| [05 p9 - An ssh machine runs a nested host](container/05-p9-an-ssh-machine-runs-a-nested-host/plan.md) | medium | built 2026-10-19; pnpm test green on Linux in PR 7 CI; [implemented.md](container/05-p9-an-ssh-machine-runs-a-nested-host/implemented.md), [deferred.md](container/05-p9-an-ssh-machine-runs-a-nested-host/deferred.md) | container 04 (tasks 11, 14, 15, 17) | 05 p10 |
| [05 p10 - A host joins another, which lists it as a computer and relays its sessions](container/05-p10-a-host-joins-a-hub/plan.md) | medium | planned 2026-10-03; tasks 01-06 todo | container 05 p9, daemon 13 | - |
| [05 p11 - A virtual machine is made for a computer, by libvirt and then by Proxmox](container/05-p11-a-vm-is-made-for-a-machine/plan.md) | medium | dropped 2026-10-22; merged into 05 p8 | - | - |
| [05 p12 - A machine off this host reaches its models through this host's proxy](container/05-p12-off-host-machine-reaches-models-via-proxy/plan.md) | high | draft 2026-10-14; the proxy is an option, and a machine uses its own configuration by default; task 03 dropped; the setting's name is open | container 05 p9, proxy 01, claude 16, proxy 02 | - |

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
| [11 - A turn's parts come in the order the model wrote them, one part per block](pi/11-turn-parts-come-in-the-order-written/plan.md) | high | built 2026-09-28 ([implemented.md](pi/11-turn-parts-come-in-the-order-written/implemented.md)) | pi 10 | - |
| [12 - A tool call says what it runs on, on pi, cofold and Claude live](pi/12-a-tool-call-says-what-it-runs-on/plan.md) | medium | built 2026-09-28 ([implemented.md](pi/12-a-tool-call-says-what-it-runs-on/implemented.md)) | - | - |
| [13 - A model pi cannot find fails the turn that asked for it](pi/13-a-model-pi-cannot-find-fails-the-turn/plan.md) | high | built 2026-10-02 ([implemented.md](pi/13-a-model-pi-cannot-find-fails-the-turn/implemented.md)) | - | - |
| [14 - agent-pi.test.ts is split into one test file per area](pi/14-pi-test-is-split-by-area/plan.md) | high | built 2026-10-04 ([implemented.md](pi/14-pi-test-is-split-by-area/implemented.md)); every task done, reviewed 2026-10-10 | - | - |
| [15 - A pi turn reads its message's attachments, queued and steered ones included](pi/15-a-pi-turn-reads-its-attachments/plan.md) | medium | built 2026-10-07 ([implemented.md](pi/15-a-pi-turn-reads-its-attachments/implemented.md)) | host 68 | - |
| [16 - agent-pi is on pi 1.3.0](pi/16-agent-pi-is-on-pi-1-3/plan.md) | medium | built 2026-10-16 ([implemented.md](pi/16-agent-pi-is-on-pi-1-3/implemented.md)) | - | - |

Next free number in `pi`: `17`.

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
| [15 - An ACP question is cancelled and answered in full](acp/15-acp-question-cancelled-and-answered-in-full/plan.md) | medium | built 2026-10-13 ([implemented.md](acp/15-acp-question-cancelled-and-answered-in-full/implemented.md)) | - | - |
| [16 - agent-acp is on the ACP SDK 1.8.0](acp/16-agent-acp-is-on-acp-sdk-1-8/plan.md) | medium | built 2026-10-16 ([implemented.md](acp/16-agent-acp-is-on-acp-sdk-1-8/implemented.md)) | - | - |
| [17 - The permission mode a session asks for is sent](acp/17-the-asked-permission-mode-is-sent/plan.md) | medium | built 2026-10-19; [implemented.md](acp/17-the-asked-permission-mode-is-sent/implemented.md) | - | - |
| [18 - More agents, with their links and their variables](acp/18-more-agents-with-their-links-and-variables/plan.md) | medium | built 2026-10-20 (implemented.md); merged in #52 | - | - |
| [19 - A terminal an ACP agent in a machine asks for runs in the machine](acp/19-a-terminal-in-a-machine-runs-in-the-machine/plan.md) | high | active 2026-10-20; tasks 01 and 02 implemented, 0 done | - | the p7 hand check's terminal turns |

Next free number in `acp`: `17`.

## usage

Reference: [00-usage.md](usage/00-usage.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Usage is kept behind one port, model use and computer time, with live totals](usage/01-usage-is-kept-behind-one-port/plan.md) | high | built 2026-10-01 ([implemented.md](usage/01-usage-is-kept-behind-one-port/implemented.md)) | - | the meters and the policy plans |
| [02 - A turn writes what it used to the usage store, charged to its owner, team and project](usage/02-a-turn-writes-what-it-used/plan.md) | high | built 2026-10-02 ([implemented.md](usage/02-a-turn-writes-what-it-used/implemented.md)) | usage 01, host 34, host 35 | policy |
| [03 - A machine records who created it and writes the time it was up, charged to its owner](usage/03-a-machine-writes-its-up-time/plan.md) | high | built 2026-10-02 ([implemented.md](usage/03-a-machine-writes-its-up-time/implemented.md)) | usage 01, host 34 | - |
| [04 - A client reads what a pool spent, and the records behind it, through a usage scheme](usage/04-usage-is-read-through-a-scheme/plan.md) | high | built 2026-10-02 ([implemented.md](usage/04-usage-is-read-through-a-scheme/implemented.md)) | usage 02, usage 03, host 36 | ahpapp usage/01, policy |
| [05 - A usage total says the tokens sent and the tokens received, beside the sum](usage/05-a-total-says-tokens-sent-and-received/plan.md) | high | built 2026-10-07 ([implemented.md](usage/05-a-total-says-tokens-sent-and-received/implemented.md)) | - | ahpapp usage 02 |
| [06 - A usage record keeps the provider's cost beside the cost it charges, each split into sent and received](usage/06-a-record-keeps-the-providers-cost-beside-ours/plan.md) | high | built 2026-10-09 ([implemented.md](usage/06-a-record-keeps-the-providers-cost-beside-ours/implemented.md)) | usage 05 | usage 07 |
| [07 - An agent's reported cost is kept as the provider's, and a record says nothing it was not told](usage/07-an-agents-reported-cost-is-the-providers/plan.md) | high | built 2026-10-09 ([implemented.md](usage/07-an-agents-reported-cost-is-the-providers/implemented.md)) | usage 06 | - |
| [08 - A usage list shows the charged pools a reader may read, names them, and sums any range by user, team and project](usage/08-usage-list-by-reader-range-and-group/plan.md) | high | built 2026-10-09 (9e38af1) | - | ahpapp `usage/04` |

Next free number in `usage`: `09`.

## policy

Reference: [00-policy.md](policy/00-policy.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - A policy says who may use which agent, model and computer](policy/01-a-policy-says-who-may-use-what/plan.md) | high | built 2026-10-02 ([implemented.md](policy/01-a-policy-says-who-may-use-what/implemented.md)) | host 36 | policy 02, proxy 02 |
| [02 - A limit says how much it allows, how much is used and when it resets](policy/02-a-limit-says-what-is-used-and-when-it-resets/plan.md) | high | built 2026-10-19; [implemented.md](policy/02-a-limit-says-what-is-used-and-when-it-resets/implemented.md) | policy 01, usage 02 | policy 03, ahpw budget view |
| [04 - The policy form reads its choices from the manifest](policy/04-policy-form-reads-choices-from-manifest/plan.md) | medium | built 2026-10-06 ([implemented.md](policy/04-policy-form-reads-choices-from-manifest/implemented.md)); reviewed and merged 2026-10-06 | policy 01 | ahpapp policy/01 |
| [05 - A put clears pool and cap, and a client imports the limits type](policy/05-a-put-clears-pool-and-cap/plan.md) | medium | built 2026-10-19; [implemented.md](policy/05-a-put-clears-pool-and-cap/implemented.md) | policy 02 | ahpw policy editor |

Next free number in `policy`: `05` (`03` is held for hours, sessions and the cancel during a turn; charge rules take `05`).

## proxy

Reference: [00-proxy.md](proxy/00-proxy.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - The proxy knows its providers and model names](proxy/01-the-proxy-knows-its-providers-and-models/plan.md) | high | built 2026-10-01 ([implemented.md](proxy/01-the-proxy-knows-its-providers-and-models/implemented.md)) | - | proxy 02 |
| [02 - The proxy serves a person's chat completions and messages, streamed back unchanged](proxy/02-the-proxy-serves-a-persons-model-calls/plan.md) | high | built 2026-10-06 ([implemented.md](proxy/02-the-proxy-serves-a-persons-model-calls/implemented.md)); reviewed and merged 2026-10-06, fixes in host 65 | proxy 01, policy 01, usage 01, host 35 | container 05 p12 |
| [03 - A refused port in the proxy tests stays refused](proxy/03-a-refused-port-in-the-proxy-tests-stays-refused/plan.md) | high | built 2026-10-21 (implemented.md); merged in #53 | - | - |
| [04 - A model provider is a connector](proxy/04-providers-are-connectors/plan.md) | high | active 2026-10-24; four tasks, all implemented; icons await curation and `config-dev.json` awaits the move | plugin 60 | - |
| [05 - A provider's own models are callable, and the proxy answers at the root](proxy/05-a-providers-own-models-are-callable/plan.md) | high | active 2026-10-24; six tasks, six implemented; Softov reviews the final checklist before the plan closes | proxy 04 | proxy 06 |
| [06 - The proxy serves every model endpoint](proxy/06-the-proxy-serves-every-model-endpoint/plan.md) | high | planned 2026-10-24; seven tasks, todo; batches are proxy 07 | proxy 05 | - |

Next free number in `proxy`: `07`.

## vault

Reference: [00-vault.md](vault/00-vault.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Secrets live in a vault, and a plugin option or a machine need names one](vault/01-secrets-live-in-a-vault/plan.md) | high | built 2026-10-03 ([implemented.md](vault/01-secrets-live-in-a-vault/implemented.md)) | - | - |
| [01 p1 - The vault port and the daemon's plain file](vault/01-p1-the-vault-and-its-local-file/plan.md) | high | built 2026-10-03 ([implemented.md](vault/01-p1-the-vault-and-its-local-file/implemented.md)) | - | 01 p2 |
| [01 p2 - A machine need names a secret, read when the machine is made](vault/01-p2-a-machine-need-names-a-secret/plan.md) | high | built 2026-10-03 ([implemented.md](vault/01-p2-a-machine-need-names-a-secret/implemented.md)) | vault 01 p1 | - |

Next free number in `vault`: `02`.

## Domains without a plan

None. `host`, `claude`, `documentation`, `plugin`, `container`, `pi`, `acp`, `usage`, `policy`, `proxy` and `vault` each have a plan above.
Ideas, one file each:

- [an SSH command that attaches to the daemon](../ideas/an-ssh-command-that-attaches-to-the-daemon.md)
- [a plugin reloads without a restart](../ideas/a-plugin-reloads-without-a-restart.md)
- [Copilot through the CLI](../ideas/copilot-goes-through-the-cli.md)
- [deliberate duplication](../ideas/deliberate-duplication.md)
- [turn and model-call diagnostics](../ideas/turn-and-model-call-diagnostics.md)
- [more computer runtimes](../ideas/more-computer-runtimes.md)
- [repositories are resources](../ideas/repositories-are-resources.md)
- [issues follow the repository](../ideas/issues-follow-the-repository.md)
- [a sqlite store](../ideas/a-sqlite-store.md)
- [a postgresql store](../ideas/a-postgresql-store.md)
- [initiators start sessions](../ideas/initiators-start-sessions.md)
- [agents report their plan](../ideas/agents-report-their-plan.md)
- [cofold speaks ACP through papo](../ideas/cofold-speaks-acp-through-papo.md)
