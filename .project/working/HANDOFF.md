---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. *Main* is as of 2026-11-09. The sections after it were last checked on 2026-11-04.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [docs/updates/](../../docs/updates/).

## Main

- The last release is 0.14.0 (`v0.14.0`). `0.15.0-rc.1` is on npm `next` (`v0.15.0-rc.1`, #231). What the release needs is in [pending/release.md](../pending/release.md).
- Main is `8c312dba1`. CI on it was running when this was written. Its code is at `10ed70e69`, the merge of #259, whose PR run passed every job.
- On 2026-11-08 and 2026-11-09, these PRs merged:
  - #252: MayCXC's three audit branches (0210 at `b67a59acb`, 1647 at `93bda3612`, 2330 at `1f643e14a`) merged with main. `effortLevel` stays on Claude and cofold, `chatMutable`.
  - #254: a closed host waits for the git it started, so Windows can remove a session's folder after `host.close()`.
  - #255: the parts bump of 2026-11-09.
  - #256: the Linux unit tests run in two shards, and host-tools waits for a plugin's real load.
  - #257: MayCXC's 0340 at `20e812035`, the computer sandboxes its commands.
  - #258: the process tests run in two shards.
  - #259: plan daemon/20261109-1532, a log line says its level. It is `built`.
- MayCXC said on 2026-11-09 not to wait for him. His branches 0210, 1647, 2330 and 0340 are all on main, and he has pushed nothing since 0340.
- CI shards: `linux (1/2)`, `linux (2/2)`, `processes (1/2)`, `processes (2/2)` and `windows (1/4)` to `windows (4/4)`. `check` and `check-windows` are the checks the `main` ruleset requires; each is green only when every shard of its job is.
- A slow runner can still fail a job with nothing wrong in the code. Rerun the failed jobs once with `gh run rerun <id> -R softov/ahpd --failed`; a second failure needs a look.
- Softov's dev daemon has not been restarted for these merges. A restart in his terminal wires in #252 to #259. Never restart it or use the ports 5180 and 37537 yourself.
- Code goes through a PR on `softov/ahpd`. Plan-only commits go to main. A PR merges with `gh pr merge <n> -R softov/ahpd --admin --merge`, only on Softov's word. Show a PR's text in chat before opening it.
- `gh pr checks` has no `--json` here, and `gh pr edit` fails on the Projects classic deprecation. Read a job's log with `gh api repos/softov/ahpd/actions/jobs/<id>/logs`, and set a PR body with `gh api repos/softov/ahpd/pulls/<n> -X PATCH -F body=@<file>`.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by every test run. Restore it with `git checkout --` and never print it. Run one vitest suite at a time, with `TMPDIR` on a folder outside the home's dot-folders.
- On this machine, computer-spawn's "fails a turn on a session whose CLI is gone" fails on main too. CI passes it.
- A test daemon for checks: `source .project/pending/test-daemon.sh`, on port 39200, with its token at `~/ahpd-check/token`. Check `ss -ltnp` before you start one, and stop it by pid.
- `/github/ahpd` is a shared checkout on an old main. Work in a worktree from `origin/main` under `/github/ahpd.worktrees/`.
- Worktrees in `/github/ahpd.worktrees/`. Remove one only on Softov's word:
  - `audit-guards`, on `host/20261108-1222-the-audit-keeps-its-guards`: another session's, with changes not committed.
  - `base-0210`, `base-1647`, `base-2330` and `base-main`: detached, at the bases of the audit merge.
  - `briefs-commit`, `plan-mcp` and `pending-check`: detached, for plan-only commits and checks.
  - `build-agents-057f374c`, `build-agents-3795760c`, `build-agents-ae3197fe`, `build-agents-e6611632`, `build-agents-ed43acf5`, `devtunnel-key-values` and `usage-task-03`: build sessions' worktrees.
  - `release-prerelease`: merged in #163.
  - Merged branches: `build-agents-6c0a50f2` (#199), `build-agents-74d376da` (#196), `build-agents-9b7dd5b5` (#197), `build-agents-b6d26e50` (#187), `build-agents-cba21cdc` (#198), `canvas-example` (#194), `grants-follow-the-answers` (#192), `maycxc-union` and `union-ad15488a`.
- Local branches with no worktree: `fork/host-124-shell-integration`, `fork/maycxc-1248-1303-1334` (merged), `host/20261031-0804-actions-answered`, `host/20261101-0329-maycxc-union`, `host/20261101-0331-maycxc-cancel-4e6d5cb8` and `pr-250`. Delete them only on his word.
- Many ACP servers at once: each read of the session list starts one server per ACP preset that has `session/list`, 8 on his box. A proper fix would answer the list from the record and ask the servers only on a refresh; no brief yet.

## Left open on 2026-11-09

- `agent-cofold-delete.test.ts:21` and `watches.test.ts:45` wait a fixed 4 s, not `WAIT_MS`. A slow runner can fail them as it failed cofold-store.
- `scripts/parts-publish.mjs` asks the registry with `docker buildx imagetools inspect` and no time limit. A stall timed out the process job once on #254.
- On Windows, a `!command`'s result holds PowerShell's prompts and the echoed sentinel line.
- An ACP server's stderr line that says no level, such as gemini's, is logged at info.

## Waiting for Softov

- The release: [pending/release.md](../pending/release.md).
- The four host/20261103-1620 plans: every task is `implemented`, and each plan waits for his review. The checks on a live daemon are in [pending/host-1620-terminal-tool-checks.md](../pending/host-1620-terminal-tool-checks.md).
  - The deferred items of plan [an agent asks the person](../plans/host/20261103-1620-an-agent-asks-the-person/deferred.md): Claude keeps its own question tool, and the tool may be renamed to `AskUserQuestion`.
  - `write_bash`, `read_bash`, `bash_shutdown` and `list_bash` ask no approval, as in VS Code. Only `bash` asks. Each tool checks the person's terminal grant.
- The grant role editor in ahpw shows the new subjects of #205. Nobody has opened it in a browser.
- Three plan records do not match main:
  - plugin/20261103-0905 merged in #200 and is `planned`.
  - plugin/20261103-0158 merged in #199 and has one task `todo`.
  - plugin/20261103-1044 is `planned`, but #203 replaced its PR #201.
- [problems/a-refused-back-turn-stays-working-in-another-window.md](../problems/a-refused-back-turn-stays-working-in-another-window.md): check after the daemon restart.
- plugin/20261102-1122, the host keeps the tunnels: its checks by hand passed on 2026-11-04. A brief, [briefs/a-tunnel-token-that-lasts.md](../briefs/a-tunnel-token-that-lasts.md), finds the long-lived token Dev Tunnels accepts.
- host/20261102-1347, the host serves its tools at `/mcp`: checks by hand in [pending/host-1347-mcp-checks.md](../pending/host-1347-mcp-checks.md).
- [briefs/a-connector-shows-a-view.md](../briefs/a-connector-shows-a-view.md): a plan only when he says plan it.
- Two comments in `packages/sdk/src/host/tooling.ts`, at lines 412 and 669, still name `heldAs`, which #191 removed. They are MayCXC's to fix on `union`.
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
- proxy/05: its checks passed on 2026-11-04.
- proxy/06: [pending/proxy-06-endpoint-checks.md](../pending/proxy-06-endpoint-checks.md).
- plugin/63: [pending/plugin-63-model-list-checks.md](../pending/plugin-63-model-list-checks.md).
- proxy/04: built on 2026-11-04.
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
- plugin/54 and plugin/56 are `implemented` and wait for his review.

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
- The fork's shell integration branch is kept locally as `fork/host-124-shell-integration`. The four host/20261103-1620 plans built it again on main from `ahp-review/briefs/agent-terminal-tool.md`.
- A test session `claude-deepseek:/845c1908-…` is still on Softov's daemon. Remove it only when he says so.
- The preset allow-list edit in `~/.config/ahpd/agents/claude-deepseek-build.json` waits on Softov.

## By Softov's hand

The checks in [pending/](../pending/).
