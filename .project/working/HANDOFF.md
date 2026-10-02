---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. [plans/index.md](../plans/index.md) is the backlog.

## Now: usage control and people (2026-10-02)

- On main, unpushed: [usage/02](../plans/usage/02-a-turn-writes-what-it-used/plan.md) `79ac6c5`, [usage/03](../plans/usage/03-a-machine-writes-its-up-time/plan.md) `bff867b`, Softov's `keptLabel` `ee386ec`, [host/37](../plans/host/37-a-session-is-listed-once-under-its-own-harness/plan.md) `7552054` (all built); the ideas cleanup and the vault idea `b2d7bae`, `b848db6`; the [usage/04](../plans/usage/04-usage-is-read-through-a-scheme/plan.md) plan with its task files `2ee2a8b`.
- Since then on main: [host/36](../plans/host/36-people-are-resources-a-client-manages/plan.md) built `9dc028a`; the [host/38](../plans/host/38-a-client-sees-who-sent-each-turn/plan.md) plan with task files `aaf408e`. Building now, one worktree each: `ahpd-usage04` ([usage/04](../plans/usage/04-usage-is-read-through-a-scheme/plan.md), answers locked 2026-10-02, decision `a-scheme-provider-may-authorize-a-read-itself`) and `ahpd-host38` (sender on `message._meta`). Both touch `host.ts`; the second to merge rebases.
- Open questions waiting on Softov: ahpapp chat/02 (2), the rules draft (3).
- ahpapp main `6ae695c` has the plans chat/02 (task files, 2 open questions), people/01, usage/01, policy/01 (draft).
- Build order: usage/04, host/38, then ahpapp chat/02, people/01, usage/01.
- Still to plan to finish usage control: usage/05 (prices), proxy/02 (listener), and policy in three plans (store and allow/deny; limits and charge rules; mid-turn debit and cancel). The rules draft (file:///github/ahp-review/prospect/ahp-user-rules.md) has 3 open questions for Softov first.
- Ideas added, uncommitted on main until Softov says so: [presets are harnesses](../ideas/presets-are-harnesses.md), [repositories are resources](../ideas/repositories-are-resources.md) (now also GitLab as a forge port and browsing commits and pull requests), the [vault](../ideas/a-secret-store.md) shape Softov set (repositories wait on it), [issues follow the repository](../ideas/issues-follow-the-repository.md) (tasker's code copied as an issue tracker, browsed through AHP), the [sqlite](../ideas/a-sqlite-store.md) and [postgresql](../ideas/a-postgresql-store.md) store plugins, [initiators start sessions](../ideas/initiators-start-sessions.md) (webhooks, issue triggers, chat threads), [agents report their plan](../ideas/agents-report-their-plan.md) and [cofold speaks ACP through papo](../ideas/cofold-speaks-acp-through-papo.md). No GitLab plan exists in ahpd yet.
- Runner scripts for agents live in the session scratchpad: `run-plan.sh`, `run-fix.sh`, `run-tasks.sh` (writes task files only). Agents set tasks `implemented`; closing, commit and merge are done after review, merge only on Softov's OK.

## Now

- 0.8.0 is published. Softov's checks 1 to 5 pass; checks 6 to 21 wait.
- plugin/28 and plugin/30 are closed: CI green on `aa66dec`. host/29 is on main.
- [daemon/09](../plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) is on main in `21a4488`, pushed; its tasks wait on Softov's check. Task 03 waits on cofold commands/03. It reaches the registry only in 0.8.1, since the published 0.8.0 sdk still peers the protocol package.
- [claude/08](../plans/claude/08-tool-input-is-the-whole-input/plan.md) tasks 01-04 are on main in `fd3295b` (2026-10-01), `implemented`, gates green (127 files, 1939 tests, twice). A row reads the call's `description` for Bash, Task, Agent and Monitor, else VS Code's line (``Running `<first line>` ``), else name plus a subject; the confirmation card too. Softov's ahpapp check of the four is still owed before they are `done`. [claude/09](../plans/claude/09-a-message-runs-on-the-agent-it-picked/plan.md) gained task 05.
- VS Code shows no AskUserQuestion in a Claude session restored after a daemon restart (Softov, 2026-09-30): VS Code hides the completed row and draws only the `inputRequest` part, which a live turn has and a transcript rebuild does not. Not a regression; VS Code's own Claude restore does the same. Decided to rebuild it: [claude/11](../plans/claude/11-an-answered-question-carries-its-answers/plan.md) task 03.
- [host/33](../plans/host/33-a-session-tool-acts-as-the-person-it-works-for/plan.md), planned 2026-09-30: a session tool acts with the grants of whoever sent the turn, VS Code's spawn and message limits, and a `sessionTools` option; no host-side confirmation. Next: write its task files 01-03 (do-spec), then build; host/30 is on main.
- main is pushed through `a1bf028` (2026-10-01), and ahpapp `8362f7f` (chat/01) is pushed. Push only when Softov asks.
- daemon/13 (`ahpd restart`), daemon/12 (plugin options from the CLI) and plugin/31 are on main in `5221af7` (2026-09-30), unpushed, after six review-and-fix passes and a merge-readiness review. Decided 2026-09-30: local `ahpd restart` only signals, remote is `--remote`/`POST /api/restart`; the terminal waits while the daemon stops; the old daemon quiesces its host (`Host.close`) before the successor; `plugin config` never imports a disabled plugin; no lock on `daemon.json`. Tasks stay `implemented`; the by-hand checks for daemon/13 wait on Softov. 
- build-sdk is on main in `e33ebee` (2026-09-30), unpushed: [host/30](../plans/host/30-a-session-is-listed-under-its-providers-name/plan.md) tasks 01-04 and 07-10 and [host/31](../plans/host/31-a-sessions-config-outlives-a-restart/plan.md) tasks 01-02, `implemented`. It carries four gate holes that are also on main before it and in 0.8.0, so they must ship in 0.8.1: a session driven by a `file:read` guest through `file:///<id>`, a terminal under a foreign scheme (`agenthost-terminal:`) driven with `file:read`, automations created by a `file:read` guest, and a changeset operation run with `file:write` alone. host/30 task 05 waits on Softov's by-hand checks, task 06 on the upstream issue text. The worktrees `/github/.worktrees/ahpd-server`, `/github/.worktrees/ahpd-sdk` and `/github/.worktrees/ahpd-sdk-2` are now redundant; removing them waits on Softov; `ahpd-sdk-2` holds only what `e33ebee` committed.
- [plugin/29](../plans/plugin/29-a-tool-call-says-when-it-ran/plan.md), tool call times, is planned: p1 (sdk helper) first, then p2-p5.
- Build order: host/33 (task files first); claude/09, 10, 11 (claude/08 is committed); host/32 tasks 01-03 after host/31 (task 04 may go first); daemon/14, daemon/11, daemon/10, acp/11 (after daemon/11), plugin/22 (in cofold); ahpapp chat/01 after claude/11. Next batch, once host/35, usage/01 and proxy/01 are merged: host/34 and [plugin/17](../plans/plugin/17-a-plugin-hears-a-session-needs-a-person/plan.md), whose refs (host.ts `emit`, the test path under `packages/sdk/test/`, the PLUGINS.md line ranges) are re-pointed first, after that merge. Subagents build in worktrees and set tasks `implemented`, never `done`; a merge to main is reviewed, gated twice, and committed only on Softov's OK.

## Waiting on Softov

- cofold commands/03 is planned, not built; the `@cofold/terminal` range bump in ahpd needs his approval.
- The claude/08 check in ahpapp (tasks 01-04, already committed).
- daemon/09's final check, the 0.8.1 release, checks 6-21, and the by-hand checks for host/30 task 05 and daemon/13.
- host/30 task 06: the upstream issue's text, shown to him before it is posted.

## Answered 2026-09-30, now planned

- [host/30](../plans/host/30-a-session-is-listed-under-its-providers-name/plan.md), [daemon/10](../plans/daemon/10-a-first-run-sets-the-daemon-up/plan.md) (`ahpd configure`), [acp/11](../plans/acp/11-the-agent-gets-mcp-servers/plan.md) (after daemon/11), [plugin/22](../plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) (in cofold), and [plugin/31](../plans/plugin/31-a-plugin-file-takes-only-a-plugin-manifest/plan.md), which replaced the manifest problem.

## Next after the release

- The `docs/` prose pass.
- README and manifest mismatches: the computer README lists 9 of 18 options and says nothing under `computer:` is written, while [docs/COMPUTER.md](../../docs/COMPUTER.md) makes a machine with `resourceWrite`; the `ahpd.options` manifests disagree with the code in tunnel-devtunnel, agent-acp, agent-pi and computer, and agent-cofold has none; cofold's README says `apiKey` may be a function.

## Blocked or not started

- [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md) is blocked: VS Code does not list the ahpd dev tunnel.
- [container/05](../plans/container/05-an-agent-in-a-machine/plan.md) p8, p9 and p10 are drafts.
- [plugin/15](../plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md), [plugin/16](../plans/plugin/16-a-disposable-machine/plan.md), [container/03](../plans/container/03-a-dev-container-is-a-computer/plan.md) and [container/04](../plans/container/04-a-cofold-session-in-a-computer/plan.md) have review fix tasks still `todo`.

## Checks nobody has made

- VS Code with the seeded `computer` picker: the chip should read `This host` or a machine's name, once.
- ahpapp against the published packages: the computer picker, and the dev container relay with `devcontainer.plugins` in a real container.
- Session state written by 0.6 read by 0.8.
- An MCP tool call on Claude, and on each other agent: the tool is listed, runs, and its result is shown.
- In ahpapp or VS Code: an approval's options in its dropdown (host/24), a fork shown as a fork (host/25), the session list while a worker runs (host/27), a restored Claude session (claude/05), Stop inside a subagent with and without `workerStop: "session"` (claude/06), a re-subscribe after a turn that ended with an open call (claude/07), and tool calls titled by what they run on (pi/12).

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`; a test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- A manifest change needs `pnpm install --no-frozen-lockfile` once, because `CI=true` freezes the lockfile; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves, or a daemon that loads it by name runs the stale build.
