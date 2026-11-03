---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-11-02.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [CHANGELOG.md](../../CHANGELOG.md).

## Main

- The last release is 0.14.0 (`v0.14.0`). The CHANGELOG holds 0.14.1 as unreleased.
- On 2026-11-02, eight PRs merged:
  - #185: MayCXC's host/20261101-0331 branch, four plans.
  - #186: MayCXC's union, ten plans and three fixes.
  - #184: parts, a bump is available.
  - #187: plugin/20261102-1054, a connector signs in with a device code.
  - #188: MayCXC's union at `ad15488a`.
  - #191: MayCXC's union at `84d937e5`. Its plan 1440 removed `heldAs`: a session and a chat now share one URI.
  - #189: plugin/20261102-1122, the host keeps the tunnels.
  - #190: host/20261102-1347, the host serves its tools at `/mcp`.
- The last code merge is #190 (`9a29a4a8`). The last commit on main is `dff1f3d6`, the close of plans 1122 and 1347.
- Main CI is green on `dff1f3d6`, on the second attempt of run 41537922540. It was red after #190. The job `windows (1/3)` failed one test in `packages/computer/test/computer-needs.test.ts`: "fails every command into the machine when a vault-named value cannot be read again". `refused` was `undefined` at line 1184, so `how` did not throw. No merge of 2026-11-02 changes that file or `packages/computer/src`. The main runs for #191 and #189 were cancelled by the next push, so the last green main run is `39408d00`. The rerun was cancelled by the push of `dff1f3d6`. On `dff1f3d6`, run 41537922540, `windows (1/3)` passed and `windows (3/3)` failed on Windows: `commit.test.ts` and `host-merged.test.ts` timed out at 20 s, then `EBUSY` on `rmdir`. The two Windows failures differ, neither file changed on 2026-11-02, and each passed on a rerun. Watch for either one again.
- #190's own PR run failed on two Windows runners the first time, in files it does not touch, and passed on a rerun.
- Disposing a session that this process does not hold leaves its disposable machine behind: [problems/a-disposed-session-not-held-leaves-its-machine.md](../problems/a-disposed-session-not-held-leaves-its-machine.md).
- `/github/ahpd` is on main, clean, level with origin.
- Fetch, and check the base before you cut a build worktree.
- Softov's dev daemon runs from source on port 37537. It runs `packages/server/src/main.ts` through `scripts/dev.mjs` with `--config-file ~/.config/ahpd/config-dev.json`, so a restart in his terminal picks up main with no build. A restart is due for #184 to #191. Never restart it or use the ports 5180 and 37537 yourself.
- After the restart, `/mcp` stays off until `mcpTools` is `all` and `httpApi` is on.
- Code goes through a PR on `softov/ahpd`. Plan-only commits go to main. The ruleset restricts updates to main, so a PR merges with `gh pr merge --admin --merge`, only on Softov's word. Run `gh pr checks` with `-R softov/ahpd` outside a repo.
- `gh pr checks` has no `--json` here. Read a job's log with `gh api repos/softov/ahpd/actions/jobs/<id>/logs`. `gh pr edit --base` fails on the Projects classic deprecation; use `gh api repos/softov/ahpd/pulls/<n> -X PATCH -f base=main`.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by every test run. Restore it with `git checkout --` and never print it. Run one vitest suite at a time.
- On Windows CI, `agent-acp-ports` (the pseudoterminal test) and the vitest worker RPC (`Timeout calling "onTaskUpdate"`) fail at times. Rerun the failed jobs once; a second failure needs a look.
- On this machine, two Docker tests time out: `computer-devcontainer` and `computer-disposable`. They time out on main too, and CI passes them.
- Worktrees in `/github/ahpd.worktrees/`: `briefs-commit` and `plan-mcp` (detached, for plan-only commits), `release-prerelease`, `canvas-example`, `build-agents-b6d26e50` (plan 1054, merged in #187), `maycxc-union` and `union-ad15488a` (merged unions). Remove one only on Softov's word. Check `ss -ltnp` before you start a test daemon, and stop it by pid.
- `plugin/canvas-example` holds `0100edc0`, "--plugin adds to the configured list, and examples/canvas is a canvas plugin". Softov asked for a PR of the whole branch on 2026-11-02. It merges only on his word.
- Local branches with no worktree: `fork/host-124-shell-integration`, `fork/maycxc-1248-1303-1334` (merged), `host/20261031-0804-actions-answered`, `host/20261101-0329-maycxc-union` and `host/20261101-0331-maycxc-cancel-4e6d5cb8`. Delete them only on his word.
- Many ACP servers at once: each read of the session list starts one server per ACP preset that has `session/list`, 8 on his box. A proper fix would answer the list from the record and ask the servers only on a refresh; no brief yet.

## Waiting for Softov

- plugin/20261102-1122, the host keeps the tunnels: built in `dff1f3d6`. Checks by hand: [pending/plugin-1122-tunnel-checks.md](../pending/plugin-1122-tunnel-checks.md). Softov answered its two choices on 2026-11-02, in its [implemented.md](../plans/plugin/20261102-1122-the-host-keeps-the-tunnels/implemented.md) *Left for later*:
  - `handle` in `x-ahpd/invokeOperation` checks `operation.grant`. Not built yet.
  - A brief finds which long-lived token Dev Tunnels accepts; `fromEnv` is decided after it. Not written yet.
- host/20261102-1347, the host serves its tools at `/mcp`: built in `dff1f3d6`. Checks by hand: [pending/host-1347-mcp-checks.md](../pending/host-1347-mcp-checks.md). Softov answered its two choices on 2026-11-02, in its [implemented.md](../plans/host/20261102-1347-the-host-serves-its-tools-at-mcp/implemented.md):
  - `guest` loses `mcp:call`. Not built yet.
  - An option on `callerOf` skips the scope check, and `/mcp` passes it, so a person in no team is not refused. Not built yet.
- plugin/20261102-1054, a connector signs in with a device code: built in `a60ab11c`. Checks by hand: [pending/plugin-1054-device-sign-in-checks.md](../pending/plugin-1054-device-sign-in-checks.md). Plan 1122's check needs this sign-in first.
- [briefs/a-connector-shows-a-view.md](../briefs/a-connector-shows-a-view.md): a plan only when he says plan it.
- Two comments in `packages/sdk/src/host/tooling.ts`, at lines 411 and 668, still name `heldAs`, which #191 removed. They are MayCXC's to fix on `union`.
- MayCXC's plans of 2026-11-02 came in through #185, #186, #188 and #191. `plans.mjs` shows their status.

- MayCXC's union merged in #183 as `79294d20`: `fe077882` (ten plans, 1556 out) with main merged in. Two test commits of ours (`c213917d`, `53a8f017`) make the case driver read a directory as the host does on Windows. MayCXC should take both on `union`. MayCXC's later `union`, `940c91fc`, is the same ten plans rebuilt on `4bf5c9d3`. Main holds all of it, and it lacks only those two fixes, so nothing there needs a merge. The review's *Notes* in [maycxc-union-20261101-review.md](maycxc-union-20261101-review.md) were not checked again. `restartNeeded` stays a read-only root config value (Softov, 2026-11-01, asked again after the rebuild); ahpw and ahpapp read it there next, in their own repositories.
- Softov, 2026-11-01: the read-state plan follows the specification, and a session marked read leaves its chats' bits alone; this replaces host/89's answer. The restart flag becomes a read-only root config value; ahpw and ahpapp follow in their repositories.
- plugin/20261101-1803, a plugin that fails says so: merged in #181 as aa48d47f, `implemented` until his review. Its checks by hand used the `devtunnel` CLI. 184ca4c8 removed it, so they are not run. #182 fixed the usage-pools test that made main red from 2026-11-01.
- daemon/20261031-0555: [pending/install-path-checks.md](../pending/install-path-checks.md).
- pi/20261031-0736: [pending/pi-resume-checks.md](../pending/pi-resume-checks.md).
- claude/20261031-1200: [pending/claude-resume-checks.md](../pending/claude-resume-checks.md).
- cofold/20261031-1200: [pending/cofold-resume-checks.md](../pending/cofold-resume-checks.md).
- plugin/20261031-1200: [pending/plugin-view-checks.md](../pending/plugin-view-checks.md).
- host/20261031-0211, claude/20261031-0228, claude/20261031-0258, daemon/20261031-0555 and pi/20261031-0736, claude/20261031-1200, plugin/20261031-1200 and cofold/20261031-1200: review. Each is `implemented`.
- host/114 and host/116: review.
- x-ahpd/me for a plugin: PR #172 merged as `44d90a59`. The plan host/20261028-0947 stays `implemented` until his review. ahpw organization/05 task 07 can start.
- ahpw idea `a-plugin-page-draws-its-view` is on ahpw main, for the views of plan D.
- After the daemon restart for #156 to #161 and #151, open a terminal in ahpw and in ahpc. `supportsCommandDetection` is now false until the shell prints its first mark.
- host/126: review. ahpc and ahpw must create `ahp-session:` sessions.
- daemon/29: the final checklist in its plan.
- host/121: the checks by hand in its plan's Resume state.
- plugin/71: [pending/plugin-71-sign-in-checks.md](../pending/plugin-71-sign-in-checks.md).
- daemon/41 on Windows: [pending/daemon-41-windows-checks.md](../pending/daemon-41-windows-checks.md).
- host/123: [pending/host-123-engines-checks.md](../pending/host-123-engines-checks.md).
- host/122: [pending/host-122-agent-records-checks.md](../pending/host-122-agent-records-checks.md).
- proxy/05: [pending/proxy-05-model-checks.md](../pending/proxy-05-model-checks.md).
- proxy/06: [pending/proxy-06-endpoint-checks.md](../pending/proxy-06-endpoint-checks.md).
- plugin/63: [pending/plugin-63-model-list-checks.md](../pending/plugin-63-model-list-checks.md).
- proxy/04: icon curation, and [pending/proxy-04-move-config-dev.md](../pending/proxy-04-move-config-dev.md).
- plugin/58: task 05 waits for [pending/plugin-58-icon-curation.md](../pending/plugin-58-icon-curation.md).
- plugin/50: [pending/plugin-50-first-pieces.md](../pending/plugin-50-first-pieces.md).
- The VM plan, task 01: [pending/vm-01-dev02-libvirt.md](../pending/vm-01-dev02-libvirt.md). The checks by hand of tasks 03 and 05 follow it.
- The VM plan, task 06: [pending/vm-06-proxmox-node.md](../pending/vm-06-proxmox-node.md), when a Proxmox node is named.
- Four plans from 2026-10-31, in build order:
  - plugin/20261031-1200, a plugin shows its state: merged in #175. Step 1 of its check passed on this machine; #178 adds the captured `show` answer as a fixture. #180 puts each label and its value on one row, Softov's layout A of two mockups, and shows the tunnel's full URL as its link: merged as 33bab1d9. A Copy button beside the link waits for a brief: it needs a client-side copy action across ahpd's view checker, ahpw and ahpc.
  - claude/20261031-1200, a failed Claude turn is resumed: merged in #174.
  - cofold/20261031-1200, a failed cofold turn is resumed: merged in #177.
- host/20261031-1200, the sdk's text is plain: task 01 wrote [research/sdk-plain-text-strings.md](../research/sdk-plain-text-strings.md). Softov reads it and answers its *Choices to check* before any code.
- [ideas/acp-resumable-doubt.md](../ideas/acp-resumable-doubt.md): ACP is not resumable for now.
- [briefs/the-change-counters-agree.md](../briefs/the-change-counters-agree.md): the ahpw change counters disagree. Softov said write the brief on 2026-10-31. A plan only when he says plan it.
- [briefs/the-text-a-person-reads-is-plain.md](../briefs/the-text-a-person-reads-is-plain.md) stays for the server and plugin slices.
- The `active` plans with all tasks implemented wait for his review. Each stays `active` until he says his review is done.
- Three `active` plans look ready to close on his word: host/83, host/99 and plugin/69. The plan host/83 has p1 to p5 built, and host/99 has every task done. PR #104 merged plugin/69 tasks 05 and 06, which are still `implemented`.
- plugin/71 has no `implemented.md`, though its tasks are implemented.
- container/02 has three tasks `blocked`. container/05 stays `active` while p8 and p10 are `planned`.
- plugin/54 and plugin/56 are `planned` and wait on plugin/53.

## Next builds

- The VM plan `20261030-1141-a-vm-is-made-on-a-server` has its code merged. It waits on the checks by hand above.
- container/05 p10 (task 03 next).
- The ahpw Connect button for plugin/71 is ahpw plan plugins/09, planned.

## Outside this repository

- ahp-review has no remote. Its tree has edits that are not committed, among them `briefs/ahpd-merge-notes.md`, which records the merges of #189, #190 and #191.
- ahpc is level with origin. What ahpc lacks against ahpd is in `ahp-review/briefs/ahpc-catch-up.md`.
- ahpw plan plugins/09 is built and not committed. It waits for Softov's review and the PR text.
- ahpw is on main, on scena `^0.5.14`, and its agent and connector forms have a YAML view.
- scena 0.5.14 is on npm, and its tree is clean.
- The fork's shell integration branch is kept locally as `fork/host-124-shell-integration`. `ahp-review/briefs/agent-terminal-tool.md` says how to redo it on main, and its questions wait on Softov.
- A test session `claude-deepseek:/845c1908-…` is still on Softov's daemon. Remove it only when he says so.
- The preset allow-list edit in `~/.config/ahpd/agents/claude-deepseek-build.json` waits on Softov.

## By Softov's hand

The checks in [pending/](../pending/).
