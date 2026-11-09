---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-11-09. *Outside this repository* was last checked on 2026-11-04.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [docs/updates/](../../docs/updates/).

## Main

- The last release is 0.14.0 (`v0.14.0`). `0.15.0-rc.1` is on npm `next` (`v0.15.0-rc.1`, #231). What the release needs is in [pending/release.md](../pending/release.md).
- Main's code is at `10ed70e69`, the merge of #259. CI passed every job on `d097edfd9`, in run 42659078870.
- On 2026-11-08 and 2026-11-09, these PRs merged:
  - #252: MayCXC's three audit branches (0210 at `b67a59acb`, 1647 at `93bda3612`, 2330 at `1f643e14a`) merged with main. `effortLevel` stays on Claude and cofold, `chatMutable`.
  - #254: a closed host waits for the git it started, so Windows can remove a session's folder after `host.close()`.
  - #255: the parts bump of 2026-11-09.
  - #256: the Linux unit tests run in two shards, and host-tools waits for a plugin's real load.
  - #257: MayCXC's 0340 at `20e812035`, the computer sandboxes its commands.
  - #258: the process tests run in two shards.
  - #259: plan daemon/20261109-1532, a log line says its level. It is `built`.
- Two PRs are open, each waiting for Softov's review and his word to merge:
  - #260: every clock wait for an event in the tests waits `WAIT_MS`. CI passed every job, after one rerun of `linux (2/2)`.
  - #261: a command in a shell started with the integration waits for its first mark, so a Windows `!command` answers its output alone. The real PowerShell case passed on Windows CI. `windows (4/4)` failed once in plugin-load, "loads computer with the options schema", at 20 s. GitHub refused to rerun that job, so the PR needs a new run.
- MayCXC said on 2026-11-09 not to wait for him. His branches 0210, 1647, 2330 and 0340 are all on main, and he has pushed nothing since 0340.
- CI shards: `linux (1/2)`, `linux (2/2)`, `processes (1/2)`, `processes (2/2)` and `windows (1/4)` to `windows (4/4)`. `check` and `check-windows` are the checks the `main` ruleset requires; each is green only when every shard of its job is.
- A slow runner can still fail a job with nothing wrong in the code. Rerun the failed jobs once with `gh run rerun <id> -R softov/ahpd --failed`; a second failure needs a look.
- Softov's dev daemon runs from `/github/ahpd` with `~/.config/ahpd/config-dev.json`. It started at 13:26 on 2026-11-09, on `e388d12f5`. The checkout was then moved to main at `d097edfd9`, and `pnpm install` ran. A restart in his terminal runs main. Never restart it or use the ports 5180 and 37537 yourself.
- `/github/ahpd` keeps a cleanup of 2026-11-06 that is not committed: nine host plans link `maycxc-union-20261101-review.md` by `git://f48055f0`, and that file is deleted. The whole edit, with the handoff of 2026-11-06, is saved in `/github/ahpd.worktrees/ahpd-local-edits-2026-11-06.patch`.
- Code goes through a PR on `softov/ahpd`. Plan-only commits go to main. A PR merges with `gh pr merge <n> -R softov/ahpd --admin --merge`, only on Softov's word. Show a PR's text in chat before opening it.
- `gh pr checks` has no `--json` here, and `gh pr edit` fails on the Projects classic deprecation. Read a job's log with `gh api repos/softov/ahpd/actions/jobs/<id>/logs`, and set a PR body with `gh api repos/softov/ahpd/pulls/<n> -X PATCH -F body=@<file>`.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by every test run. Restore it with `git checkout --` and never print it. Run one vitest suite at a time, with `TMPDIR` on a folder outside the home's dot-folders.
- On this machine, computer-spawn's "fails a turn on a session whose CLI is gone" fails on main too. CI passes it.
- A test daemon for checks: `source .project/pending/test-daemon.sh`, on port 39200, with its token at `~/ahpd-check/token`. Check `ss -ltnp` before you start one, and stop it by pid.
- `/github/ahpd` is a shared checkout, and the dev daemon runs from it. Work in a worktree from `origin/main` under `/github/ahpd.worktrees/`.
- Worktrees in `/github/ahpd.worktrees/`. Remove one only on Softov's word:
  - `audit-guards`, on `host/20261108-1222-the-audit-keeps-its-guards`: another session's, with changes not committed.
  - `base-0210`, `base-1647`, `base-2330` and `base-main`: detached, at the bases of the audit merge.
  - `briefs-commit`, `plan-mcp` and `pending-check`: detached, for plan-only commits and checks.
  - `build-agents-057f374c`, `build-agents-3795760c`, `build-agents-ae3197fe`, `build-agents-e6611632`, `build-agents-ed43acf5`, `devtunnel-key-values` and `usage-task-03`: build sessions' worktrees.
  - `wait-ms` (#260) and `win-command` (#261): the open PRs.
  - `release-prerelease`: merged in #163.
  - Merged branches: `build-agents-6c0a50f2` (#199), `build-agents-74d376da` (#196), `build-agents-9b7dd5b5` (#197), `build-agents-b6d26e50` (#187), `build-agents-cba21cdc` (#198), `canvas-example` (#194), `grants-follow-the-answers` (#192), `maycxc-union` and `union-ad15488a`.
- Local branches with no worktree: `fork/host-124-shell-integration`, `fork/maycxc-1248-1303-1334` (merged), `host/20261031-0804-actions-answered`, `host/20261101-0329-maycxc-union`, `host/20261101-0331-maycxc-cancel-4e6d5cb8` and `pr-250`. Delete them only on his word.
- Many ACP servers at once: each read of the session list starts one server per ACP preset that has `session/list`, 8 on his box. A proper fix would answer the list from the record and ask the servers only on a refresh; no brief yet.

## Left open on 2026-11-09

- An ACP server's stderr line that says no level, such as gemini's, is logged at info.
- Some test helpers and loops give up after a count of event-loop turns, not after a time. Examples are the `until(check, times)` of cofold-turn, nested-proxy and computer-disposable. #260 left them as they are.
- agent-cofold-fork's "keeps the chat going when the store cannot truncate the conversation" failed once on Linux CI in #260.
  Turn t3 ended after 71 ms with no `chat/turnComplete`. It passed on the rerun and eight times on this machine.
- The process job's failure on #254 was its 300 s limit, which #258 fixed. It was not a stall of `docker buildx imagetools inspect`: the test's `docker` is a stand-in that asks no registry.

## Waiting for Softov

- The release: [pending/release.md](../pending/release.md). ahpw is on `@ahpd/sdk ^0.15.0-rc.1` (ahpw `aec9fd3`), and `@ahpd/web 0.9.0-rc.1` is on npm. What is left is a working day on the daemon and the checks by hand.
- The checks by hand: [pending/triage.md](../pending/triage.md) orders them.
- The grant role editor in ahpw shows the new subjects of #205. Nobody has opened it in a browser.
- [problems/a-refused-back-turn-stays-working-in-another-window.md](../problems/a-refused-back-turn-stays-working-in-another-window.md): check after the daemon restart.
- The deferred items of plan [an agent asks the person](../plans/host/20261103-1620-an-agent-asks-the-person/deferred.md): Claude keeps its own question tool, and the tool may be renamed to `AskUserQuestion`.
- [briefs/a-claude-login-shows-its-account-and-plan.md](../briefs/a-claude-login-shows-its-account-and-plan.md) is covered by plugin/20261106-0438, now `built`. Delete it on his word, with a `git://` ref in the plan.
- Open plans that need his word:
  - host/20261031-1200, the sdk's text is plain, `draft`: he reads [research/sdk-plain-text-strings.md](../research/sdk-plain-text-strings.md) and answers its *Choices to check* before any code.
  - host/83, `active`: p1 to p5 are `built`. Close it on his word.
  - container/02, `active`: three tasks are `blocked`.
  - container/05, `active`: p12 is `draft`, and every other part is `built` or `dropped`.
  - container/20261030-1141, the VM plan, `active`: task 01 waits for [pending/vm-01-dev02-libvirt.md](../pending/vm-01-dev02-libvirt.md).
  - plugin/20261106-1058, CI fails only for a real fault, `planned`: five tasks `todo`.
- Briefs and an idea that wait for a plan on his word: [the-change-counters-agree.md](../briefs/the-change-counters-agree.md), [the-text-a-person-reads-is-plain.md](../briefs/the-text-a-person-reads-is-plain.md), [a-tunnel-token-that-lasts.md](../briefs/a-tunnel-token-that-lasts.md) and [ideas/acp-resumable-doubt.md](../ideas/acp-resumable-doubt.md).
- A Copy button beside a view's link waits for a brief: it needs a client-side copy action across ahpd's view checker, ahpw and ahpc.
- Two comments in `packages/sdk/src/host/tooling.ts`, at lines 445 and 735, still name `heldAs`, which #191 removed.
- `restartNeeded` stays a read-only root config value (Softov, 2026-11-01). ahpw and ahpapp read it there next, in their own repositories.

## Next builds

- plugin/20261106-1058, CI fails only for a real fault: `planned`, high.
- The VM plan `20261030-1141-a-vm-is-made-on-a-server` has its code merged. It waits on its checks by hand.
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
