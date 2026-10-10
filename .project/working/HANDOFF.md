---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-10-10.
[plans/index.md](../plans/index.md) is the backlog and each plan's Resume state is its detail; what merged is in `git log`.

## Main

- `main` is at `5f4c87a`, one commit ahead of `origin/main` (this handoff). `d1d950b` is pushed and CI is green (run 38066810517, 3m29s).
- The version is still 0.10.0, with 115 commits since the `v0.10.0` tag. The bump and the tag are Softov's.
- The review of 2026-10-10 found four release blockers:
  - `bot` and `push` are not in `PUBLISHED` in `release.yml`.
  - The plugins' `sdk` peer range is `>=0.10`.
  - `packages/push` has no LICENSE.
  - The decision `the-whole-workspace-is-published` still says eight packages.
- CI runs `test:unit` in the `check` job and `test:processes` in the `processes` job. If `processes` nears its 300 s limit, the next file to move out is `computer-git-fetch`.

## Build worktrees

| Worktree | Branch head | State |
|---|---|---|
| `build-agents-f8d0dae8` | `cfb1224` | [plugin/18](../plans/plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md) tasks 01-04 implemented, reviewed 2026-10-10. The fork reopen bug is fixed there, uncommitted, with a test. Three forks wait for Softov: cancel and decline are the same to a backend, an unknown form field is asked as text, `resumable()` reads only `loadSession`. Before the commit, revert the regenerated `wire.jsonl`; expect a rebase conflict with `ab763e4`. |

The `build-agents-428b7b46` and `build-agents-cofold-uptake` worktrees and their branches are removed.

## Plans to close

- 57 task files under 13 built plans were reviewed against `main` on 2026-10-10 and are `done`.
- Two tasks stay `implemented` and wait for Softov:
  - [host/46 task 01](../plans/host/46-built-in-surfaces-are-advertised-for-role-control/plan.md): holding the session group does not cover the chat group.
  - [host/52 task 05](../plans/host/52-deleting-a-session-deletes-the-backends-copy/plan.md): waits on Softov.
- `active` without `implemented.md`: [daemon/13](../plans/daemon/13-ahpd-restart/plan.md), [host/56](../plans/host/56-the-catalogue-answers-at-once-and-a-summary-is-sent-when-it-changes/plan.md), [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md), [container/05 p9](../plans/container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md).

## Reviews

- [2026-09-19-upstream-pass-4.md](../review/2026-09-19-upstream-pass-4.md)
- [daemon-13-restart-checks.md](../review/daemon-13-restart-checks.md)
- [host-56-measure.md](../review/host-56-measure.md)

## By Softov's hand

- daemon/13 restart checks, host/56 task 05, container/02 tasks 01-03 (Windows VS Code run), container/05 p9 task 06 on dev86.

## Next builds

- [host/79](../plans/host/79-a-quiet-session-sleeps-and-wakes/plan.md): planned, builds once Softov says so.
- container/05 p9 tasks 02, 03 and 05; task 07 waits on 06.
- plugin/19 after plugin/18; container/05 p8, p10, p11, p12; host/33 task files; documentation/02 waits on ahpc cli/02.
- To offer: a VS Code parity host plan (`runCancellation`, `runHistoryLimit`, `customizations`, `_meta.hostBuild`, `vscode.agentHost.resources`, `agentCustomizationSettings`, `remoteSessions`, `completionTriggerCharacters`).

## Open with Softov

- About 21 idle claude processes (about 4.5 GB) wait for an ahpd restart, until host/79 lands.
- The dev container stop problem, VS Code "No models available", the stale `wire.jsonl` fixture, the unset `ANTHROPIC_API_KEY`, the papo flaky-test offer, the ahpc cancel bug.
- Open problems are in [problems/](../problems/).
