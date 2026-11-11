---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-11-11. *Outside this repository* was last checked on 2026-11-04.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [docs/updates/](../../docs/updates/).

## Main

- The last release is 0.14.0 (`v0.14.0`). `0.15.0-rc.1` is on npm `next` (`v0.15.0-rc.1`, #231). What the release needs is in [pending/release.md](../pending/release.md).
- Main's last code merge is #288 (`5a9167c36`): a stored ACP session opens after a restart. It is beorn's fix for #287, with two of our commits, and #287 is closed.
- #277 to #286 merged on 2026-11-10, and #289 on 2026-11-11. `git log` and each plan's Resume state hold the detail.
- No PR is open on `softov/ahpd`. beorn has not said which ACP server he hit #287 with.
- MayCXC said on 2026-11-09 not to wait for him. His branches 0210, 1647, 2330 and 0340 are all on main, and he has pushed nothing since 0340.
- CI shards: `linux (1/2)`, `linux (2/2)`, `processes (1/2)`, `processes (2/2)` and `windows (1/4)` to `windows (4/4)`. `check` and `check-windows` are the checks the `main` ruleset requires; each is green only when every shard of its job is.
- A slow runner can still fail a job with nothing wrong in the code. Rerun the failed jobs once with `gh run rerun <id> -R softov/ahpd --failed`; a second failure needs a look.
- Softov's dev daemon runs from `/github/ahpd` with `~/.config/ahpd/config-dev.json`. A rebuild and a restart in his terminal wire in #289, the alerts on agent and connector rows. It needs `DEEPSEEK_API_KEY` in its environment, or the DeepSeek agents do not open. Never restart it or use the ports 5180 and 37537 yourself.
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
  - `wait-ms` (#260) and `win-command` (#261): merged.
  - `build-agents-8d842840`: the turn-off build, not pushed and not reviewed.
  - `release-prerelease`: merged in #163.
  - Merged branches: `build-agents-6c0a50f2` (#199), `build-agents-74d376da` (#196), `build-agents-9b7dd5b5` (#197), `build-agents-b6d26e50` (#187), `build-agents-cba21cdc` (#198), `canvas-example` (#194), `grants-follow-the-answers` (#192), `maycxc-union` and `union-ad15488a`.
- Local branches with no worktree: `fork/host-124-shell-integration`, `fork/maycxc-1248-1303-1334` (merged), `host/20261031-0804-actions-answered`, `host/20261101-0329-maycxc-union`, `host/20261101-0331-maycxc-cancel-4e6d5cb8` and `pr-250`. Delete them only on his word.
- Many ACP servers at once: each read of the session list starts one server per ACP preset that has `session/list`, 8 on his box. A proper fix would answer the list from the record and ask the servers only on a refresh; no brief yet.

## In progress on 2026-11-11

- Builders are dispatched over the ahpd MCP tools from now on, so the dispatch itself is tested. The MCP token is uclau's `claude-code-mcp`, in `~/.claude.json`.
- [plugin/20261111-0032-agents-and-connectors-list-their-alerts](../plans/plugin/20261111-0032-agents-and-connectors-list-their-alerts/plan.md) merged in #289. It stays `implemented` until Softov says `built`.
- [plugin/20261111-0032-an-agent-or-connector-turns-off](../plans/plugin/20261111-0032-an-agent-or-connector-turns-off/plan.md) is being built in `build-agents-8d842840`, in session `8d842840`. On 2026-11-11 Softov added a paused state, stored in one `mode` field, and tasks 01 and 02 are being rebuilt for it. The build preset denies `git add`, so new files are committed by hand in review.
- Two plans from [briefs/mcp-client.md](../briefs/mcp-client.md) are written and not committed. They wait for Softov's check: host/20261111-0609-a-row-lists-chats-and-one-chat-archives and host/20261111-0609-the-session-context-tells-each-call. Their four items leave the brief once he approves them.
- ahpw's brief for the alert list and the switch is `ahpw/.project/briefs/an-agent-or-connector-lists-its-alerts-and-turns-off.md`, not committed. Its plan needs a mockup first. Until then ahpw's pages read `health`, which ahpd no longer sends.
- A restored ACP session shows the host's added first-prompt text as the person's own words. Codex and Gemini both do it. No brief yet.
- `/mcp` keeps no session, so an MCP client is not a row in `x-ahpd-clients`. Softov likes an MCP session (`Mcp-Session-Id`) for it. No brief yet.
- A `get_session_context` reply over MCP is cut at the level's cap with no way to read the rest. host/20261111-0609-the-session-context-tells-each-call adds `responseTurnId`.

## Left open on 2026-11-09

- `@` lists nothing on a daemon whose PATH has no `rg`, and no client says why. [briefs/at-lists-files-without-rg-on-the-path.md](../briefs/at-lists-files-without-rg-on-the-path.md) holds the ways to fix it.
- An ACP server's stderr line that says no level, such as gemini's, is logged at info.
- Some test helpers and loops give up after a count of event-loop turns, not after a time. Examples are the `until(check, times)` of cofold-turn, nested-proxy and computer-disposable. #260 left them as they are.
- agent-cofold-fork's "keeps the chat going when the store cannot truncate the conversation" failed once on Linux CI in #260.
  Turn t3 ended after 71 ms with no `chat/turnComplete`. It passed on the rerun and eight times on this machine.
- The process job's failure on #254 was its 300 s limit, which #258 fixed. It was not a stall of `docker buildx imagetools inspect`: the test's `docker` is a stand-in that asks no registry.

## Waiting for Softov

- The GHCR package `ghcr.io/softov/ahpd` is private until he makes it public once.
- Moving the repository to `ahpio/ahpd`, before or after 0.15.0: no decision. GHCR does not redirect, and `compose.yaml` names `ghcr.io/softov/ahpd`.
- `edge.yml` has no paths filter, so a plan-only push to main builds the edge image. A `paths-ignore` is suggested.
- The API keys in his private env file were shown in a chat on 2026-11-11. He rotates them.

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
