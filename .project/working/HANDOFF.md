---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-10-08. [plans/index.md](../plans/index.md) is the backlog and each plan's Resume state is its detail; what merged is in `git log`.

## How builds run now

Builds run as daemon sessions on the `claude-deepseek-build` preset through ahpc, at most 2-3 at a time, so Softov can watch them.
Each session has `isolation=worktree`, and its worktree is under `/github/ahpd.worktrees/build-agents-<id>`.
The builder sets tasks `implemented`, never `done`.
The review reads the diff against the plan, probes the security and data-loss paths, and reruns the four gates (`pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build`).
On Softov's approval: commit in the worktree, rebase on main, rerun the gates, fast-forward main, remove the worktree and the branch, and keep the session.
Never push; Softov pushes.

## In flight

- **Unpushed:** 8 commits on main ahead of `origin/main`.
- **Restart owed:** Softov restarts his daemon to wire in host/73, usage/06, usage/07 (01-03, 05), daemon/09 task 12 and the new `@ahpd/bot` plugin package.
- **Waiting on Softov:** usage/06 task 03 and usage/07 task 04, which need his captures (Anthropic dialect, DeepSeek, a live `claude-openrouter` turn).
- **Building:** [plugin/37](../plans/plugin/37-a-bot-is-a-record-with-a-session/plan.md) tasks 02, 04 and 05, session `c7421e55`; [daemon/09](../plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) tasks 01 and 04 (`--force`), session `666bc42b`.

## Next, buildable now

1. [plugin/38](../plans/plugin/38-a-plugin-cannot-change-what-the-host-gave-it/plan.md), approved, after plugin/37 merges.
2. [host/74](../plans/host/74-the-sdks-tools-live-in-one-folder/plan.md), alone, because it moves files.
3. [host/43 p4](../plans/host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) task 01; tasks 02-05 wait on ahpapp and ahpc.
4. A short plan for revising the package READMEs: how to use the code, its ahpd config and CLI commands, each option explained.

Not yet written: a usage plan where the usage list sends each pool's kind and name, so ahpapp drops `poolWords` and `KIND_ORDER`.
[plugin/36](../plans/plugin/36-a-cofold-turn-reads-its-attachments/plan.md) waits on a cofold release.
Doc drift found by documentation/03 and left for a decision: AHP.md marks `automationRun/cancelRequested` supported where `packages/sdk/src/host/actions.ts` refuses it; AHP.md and a comment in `packages/sdk/src/host/terminals.ts` claim a served-directory check `createTerminal` does not make; `TitleStrategy`'s `utility` is never selected.

## Waiting on Softov

- host/56 task 05: his measurement with the probes in `/github/ahpapp/.scratch/org/`.
- host/30 task 05: his VS Code test by hand.
- Flaky tests: `computer-devcontainer.test.ts` under full load, `ENOTEMPTY` in afterEach cleanup, and once a `computer-needs.test.ts` vault restart case. A problem file or a fix plan was offered, with no answer yet.

## Carried from 2026-10-03, not rechecked since

- Checks nobody has made: VS Code's `computer` picker chip; ahpapp against the published packages; 0.6 session state read by 0.8; an MCP tool call on each agent; host/24, 25, 27, claude/05, 06, 07, pi/12 in a client; daemon/11 in ahpapp.
- After the release: the `docs/` prose pass; README and manifest mismatches in computer, tunnel-devtunnel, agent-acp, agent-pi and agent-cofold.

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`.
- `pnpm test` generates `tools/ahp.strict.schema.json` first; running vitest alone in a fresh checkout fails the acp ports tests for want of it.
