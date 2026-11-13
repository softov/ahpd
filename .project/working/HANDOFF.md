---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-11-12. *Outside this repository* was last checked on 2026-11-04.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [docs/updates/](../../docs/updates/).

## Main

- The last release is 0.14.0 (`v0.14.0`). `0.15.0-rc.1` is on npm `next` (`v0.15.0-rc.1`). What the release needs is in [pending/release.md](../pending/release.md), and the checks by hand are ordered in [pending/triage.md](../pending/triage.md).
- Main's last code merge is #310 (`5341abc30`). Open: PR #311, the release notes, and PR #312, the downgrade check read as semver.
- The repository is `ahpio/ahpd` since 2026-11-11 (#290). MayCXC's fork has no work missing from main.
- Code goes through a PR on `ahpio/ahpd`; plan-only commits go to main. Show a PR's text in chat before opening it. Merge with `gh pr merge <n> -R ahpio/ahpd --admin --merge`, only on Softov's word.
- `check` and `check-windows` must both be green before a merge; no ruleset requires them now. A slow runner can fail a job with nothing wrong: rerun once with `gh run rerun <id> -R ahpio/ahpd --failed`.
- `gh pr checks` has no `--json` here, and `gh pr edit` fails. Read a job's log with `gh api repos/ahpio/ahpd/actions/jobs/<id>/logs`, and set a PR body with `gh api repos/ahpio/ahpd/pulls/<n> -X PATCH -F body=@<file>`.

## The dev daemon

- Softov's dev daemon runs from `/github/ahpd` with `~/.config/ahpd/config-dev.json`, on ports 5180 and 37537. It runs from `src`, so a restart is all a merge needs. It needs `DEEPSEEK_API_KEY` in its environment. Never restart it or use its ports yourself.
- It was last restarted at 02:22 local on 2026-11-12, on #303. It needs a restart for #304 to #310.
- `/github/ahpd` is a shared checkout. Work in a worktree from `origin/main` under `/github/ahpd.worktrees/`.
- A test daemon for checks: `source .project/pending/test-daemon.sh`, on port 39200, with its token at `~/ahpd-check/token`. Check `ss -ltnp` before you start one, and stop it by pid.

## Tests

- Run one vitest suite at a time: `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run <package>`. A fresh worktree needs `pnpm schema` first.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by every run. Restore it with `git checkout --` and never print it.
- An sdk host change is gated by the computer suite too.
- CI on main is green at `2a04b7472` (run 43315911168), `check` and `check-windows` both.
- `release.yml` runs the whole `pnpm test` before it publishes, so a flaky case can fail a tag run.
- Flaky on main in the 100 CI runs since 2026-11-11 08:10 UTC, each passed on a rerun:
  - `tunnel-devtunnel-view.test.ts` "starts no poll when the tunnel stops during its first read": 5 runs, on Linux and Windows, last 43229860508. It fails at line 237, after the 50 event-loop turns of line 236. No problem file, no plan.
  - `agent-cofold-fork.test.ts` "keeps the chat going when the store cannot truncate the conversation": 3 runs on Linux. No problem file, no plan.
  - `computer-spawn.test.ts` "fails a turn on a session whose CLI is gone": once on CI (43162247025), and it times out on this box.
  - `nested-process.test.ts` "a daemon that stops leaves the session inside the machine for the next one": once (43132937874).
  - `computer-devcontainer.test.ts` "omits the dev container row for a URI it cannot read a folder from": once on Windows (43114109287).
  - `computer-servercheck.test.ts` "runs its own script under sh": once (43115235109). Task 02 of plugin/20261106-1058 fixes it.
  - `host-attachments.test.ts` "hands a queued and a steering message their attachments", once on Windows: in [problems/two-attachment-cases-time-out-on-windows.md](../problems/two-attachment-cases-time-out-on-windows.md).

## Builders

- Builders run as ahpd sessions over the MCP tools, on `claude-deepseek-build`, with a worktree each. The MCP token is uclau's `claude-code-mcp`, in `~/.claude.json`.
- The build preset denies `flock`, `git add`, `git checkout --` and `pnpm typecheck`. A builder runs `pnpm exec tsc -p tsconfig.json --noEmit` and writes tests; the reviewer runs the suites and commits.
- DeepSeek can stop a builder with `402 Insufficient Balance`. The session's jsonl under `~/.claude/projects/-github-ahpd-worktrees-build-agents-<id>/` shows it.
- `list_agents` drops an agent that failed to open with no reason. `get_session_context` once answered an empty transcript for a session with a finished turn.

## Worktrees and branches

Remove each only on Softov's word.

- `base-main`: detached, in use by another session's test daemon.
- `pending-check`: detached, built for checks on a test daemon.
- `pr302-check`: detached at #302's head, merged.
- Ten `build-agents-*` worktrees, each on a branch that is on main: the plans of #301 to #310. Their daemon sessions stay.
- `release-report`: detached, for plan-only commits of the release check.
- `notes-catch-up`: branch `docs/20261112-0-15-notes-catch-up`, PR #311, the release notes of what merged since 0.15.0-rc.1. It merges on Softov's word, before the bump to `0.15.0-rc.2`. It also fixes the `root/progress` line of `docs/sdk/AHP.md`.
- `downgrade-semver`: branch `daemon/20261110-0947-the-downgrade-check-reads-semver`, PR #312, task 06 of daemon/20261110-0947. The smoke test passed on the image `ahpd:semver-check`, built from it.
- Local branches with no worktree: `fork/host-124-shell-integration`, `fork/maycxc-1248-1303-1334`, `host/20261031-0804-actions-answered`, `host/20261101-0329-maycxc-union`, `host/20261101-0331-maycxc-cancel-4e6d5cb8` and `pr-250`.

## Plans waiting to close

Each plan here has every task `implemented`, and closes as `built` on Softov's word after his review.

- The Windows check of 2026-11-12, [results](../pending/windows-machine-paths-checks.md#results-on-windows-2026-11-12): the seven plans of #304 to #310. They close after the Windows check runs again.
- plugin/20261112-0145, three plans: #301, #302 and #303.
- The release run of 2026-11-11: thirteen plans, from #273 to #281, #286 and #293 to #295. They are acp/20261110-0813, cofold/20261110-0813 (two), host/20261110-0813 (six), host/20261111-0609 (two), host/20261111-1203 and pi/20261110-0813.
- The five fixes of the release run's problems, #296 to #300: pi/20261111-1444, cofold/20261111-1445, daemon/20261111-1447, container/20261111-1507 and plugin/20261111-1507.

## Next

- ahpc's `cli/20261112-0821-create-session-waits-on-progress`, in the ahpc repository, can be built. A create that makes no machine sends no progress, so ahpc keeps its timeout for it.
- [host/20261112-0821-an-unused-new-session-is-removed](../plans/host/20261112-0821-an-unused-new-session-is-removed/plan.md) stays `draft`. Softov chose deletion as VS Code does. Its Resume state holds the research and two questions before task 01 is rewritten.
- The brief [the-terminal-tool-runs-on-windows-when-set.md](../briefs/the-terminal-tool-runs-on-windows-when-set.md) waits for Softov's word. Its open points are where the setting lives and its name.
- ahpw's plan plugins/20261112-0221-a-record-draws-the-operations-it-offers is unblocked by #302. Another session builds it on Softov's word.
- plugin/20261106-1058, CI fails only for a real fault: `planned`, high, five tasks `todo`.
- [cofold/20261111-1054-cofold-reads-the-cofold-names](../plans/cofold/20261111-1054-cofold-reads-the-cofold-names/plan.md) waits for a `@cofold/copapo` release that reads the cofold names.

## Open findings with no brief yet

- Each read of the session list starts one server per ACP preset that has `session/list`, 8 on Softov's box. A fix would answer from the record and ask the servers only on a refresh.
- A restored ACP session shows the host's added first-prompt text as the person's own words, in Codex and Gemini.
- `/mcp` keeps no session, so an MCP client is not a row in `x-ahpd-clients`. Softov likes an `Mcp-Session-Id` for it.
- The policy form saves a row that can do nothing: a `deny` with limits, or an empty `match`. A row's `pool` and a limit's `pool` are two things under one word.
- Build session `01927fa8` finished its turn, but the host marked it `error` 10 s after start and froze its record. Softov's terminal log for 07:13 local on 2026-11-11 holds the cause.
- `@` lists nothing on a daemon whose PATH has no `rg`. [briefs/at-lists-files-without-rg-on-the-path.md](../briefs/at-lists-files-without-rg-on-the-path.md) holds the ways to fix it.
- An ACP server's stderr line with no level, such as gemini's, is logged at info.
- Some test helpers give up after a count of event-loop turns, not after a time, such as the `until(check, times)` of cofold-turn, nested-proxy and computer-disposable.
- A Copy button beside a view's link needs a client-side copy action across ahpd's view checker, ahpw and ahpc.
- Two comments in `packages/sdk/src/host/tooling.ts`, at lines 448 and 746, still name `heldAs`, which #191 removed.
- `docs/sdk/AHP.md:175` says a session's start says no `root/progress`, which #309 changed. PR #311 fixes it.
- The 0.15.0 image refuses a volume an rc wrote: `docker/entrypoint.sh:36-37` compares with `sort -V`, which puts `0.15.0` before `0.15.0-rc.1`. PR #312, task 06 of daemon/20261110-0947, fixes it.

## The release run of 2026-11-11

Its notepad is [release-run.md](release-run.md), its agent tests are in [release-run.md](release-run.md#agent-tests), and its ranked problems are in [problems-report-20261111.md](problems-report-20261111.md). The OpenAI key has no credit, so Codex ends at "Quota exceeded".

## Waiting for Softov

- What `0.15.0-rc.2` needs before its tag is in [pending/release.md](../pending/release.md#left). npm trusts `ahpio/ahpd` since 2026-11-12.
- `0.15.0-rc.2` is tagged with the machine parts pulled by tag. The digest pin of [problems/part-images-are-pulled-by-a-tag-with-no-digest.md](../problems/part-images-are-pulled-by-a-tag-with-no-digest.md) comes before 0.15.0 (Softov, 2026-11-12).
- The GHCR package `ghcr.io/ahpio/ahpd` is private until he makes it public once. The edge image is on it: run 43315911087 pushed `sha-2a04b74`. Its visibility was not read: the `gh` token has no `read:packages`. No machine part is on `ghcr.io/ahpio` until `0.15.0-rc.2`.- `edge.yml` has no paths filter, so a plan-only push to main builds the edge image. A `paths-ignore` is suggested.
- The API keys in his private env file were shown in a chat on 2026-11-11. He rotates them.
- The grant role editor in ahpw shows the new subjects of #205. Nobody has opened it in a browser.
- [problems/a-refused-back-turn-stays-working-in-another-window.md](../problems/a-refused-back-turn-stays-working-in-another-window.md): check after the daemon restart.
- [briefs/a-claude-login-shows-its-account-and-plan.md](../briefs/a-claude-login-shows-its-account-and-plan.md) is covered by plugin/20261106-0438, now `built`. Delete it on his word, with a `git://` ref in the plan.
- Open plans that need his word:
  - host/20261031-1200, the sdk's text is plain, `draft`: he answers the *Choices to check* of [research/sdk-plain-text-strings.md](../research/sdk-plain-text-strings.md).
  - host/83, `active`: p1 to p5 are `built`. Close it on his word.
  - container/02, `active`: three tasks are `blocked`.
  - container/05, `active`: p12 is `draft`, and every other part is `built` or `dropped`.
  - container/20261030-1141, the VM plan, `active`: task 01 waits for [pending/vm-01-dev02-libvirt.md](../pending/vm-01-dev02-libvirt.md).
- Briefs and an idea that wait for a plan: [a-client-shows-what-github-says-of-a-pull-request.md](../briefs/a-client-shows-what-github-says-of-a-pull-request.md), [the-change-counters-agree.md](../briefs/the-change-counters-agree.md), [the-text-a-person-reads-is-plain.md](../briefs/the-text-a-person-reads-is-plain.md), [a-tunnel-token-that-lasts.md](../briefs/a-tunnel-token-that-lasts.md), [the-policy-check-is-a-server-setting.md](../briefs/the-policy-check-is-a-server-setting.md) and [ideas/acp-resumable-doubt.md](../ideas/acp-resumable-doubt.md).
- `restartNeeded` stays a read-only root config value. ahpw and ahpapp read it there next, in their own repositories.
- The preset allow-list edit in `~/.config/ahpd/agents/claude-deepseek-build.json`.
- A test session `claude-deepseek:/845c1908-…` is on his daemon. Remove it only when he says so.

## Outside this repository

- ahp-review has no remote. Its tree has edits that are not committed, among them `briefs/ahpd-merge-notes.md`.
- What ahpc lacks against ahpd is in `ahp-review/briefs/ahpc-catch-up.md`.
- ahpw plan plugins/09, the Connect button for plugin/71, is built and not committed. It waits for Softov's review.
- ahpw's brief for the alert list and the switch is on ahpw's main (`0f9d12a`). Its plan needs a mockup first. Until then ahpw's pages read `health`, which ahpd no longer sends.

## By Softov's hand

The checks in [pending/](../pending/).
