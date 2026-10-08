---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-10-07. [plans/index.md](../plans/index.md) is the backlog and each plan's Resume state is its detail; what merged is in `git log`.

## How builds run now

Builds run as daemon sessions on the `claude-deepseek-build` preset through ahpc, at most 2-3 at a time, so Softov can watch them.
Each session has `isolation=worktree`, and its worktree is under `/github/ahpd.worktrees/build-agents-<id>`.
The builder sets tasks `implemented`, never `done`.
The review reads the diff against the plan, probes the security and data-loss paths, and reruns the four gates (`pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build`).
On Softov's approval: commit in the worktree, rebase on main, rerun the gates, fast-forward main, remove the worktree and the branch, and keep the session.
Never push; Softov pushes.

## In flight

- **Unpushed:** 17 commits on main ahead of `origin/main`.
- **Building:** [host/73](../plans/host/73-a-role-editor-offers-trust-and-proxy/plan.md), session `a261d92b`, with the fix turn that makes the gate ask for the operation.
- **Building:** [usage/06](../plans/usage/06-a-record-keeps-the-providers-cost-beside-ours/plan.md), session `41e55763`. After its merge, Softov restarts his daemon so ahpapp shows the cost split.
- **Uncommitted, kept by Softov's choice:** `scripts/completions.mjs`.

## Next, buildable now

1. [plugin/37](../plans/plugin/37-a-bot-is-a-record-with-a-session/plan.md) tasks 01 and 03: the bot record and `PluginHost.startSession`.
2. [daemon/09](../plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) task 12: the plugin root.
3. [host/74](../plans/host/74-the-sdks-tools-live-in-one-folder/plan.md), alone, because it moves files.
4. [usage/07](../plans/usage/07-an-agents-reported-cost-is-the-providers/plan.md), after usage/06.
5. [host/43 p4](../plans/host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) task 01; tasks 02-05 wait on ahpapp and ahpc.

Not yet written: a usage plan where the usage list sends each pool's kind and name, so ahpapp drops `poolWords` and `KIND_ORDER`.
[plugin/36](../plans/plugin/36-a-cofold-turn-reads-its-attachments/plan.md) waits on a cofold release.

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
