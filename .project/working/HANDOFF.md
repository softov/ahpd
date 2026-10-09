---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-10-09. [plans/index.md](../plans/index.md) is the backlog and each plan's Resume state is its detail; what merged is in `git log`.

## How builds run now

Builds run as daemon sessions on the `claude-deepseek-build` preset through ahpc, at most 2-3 at a time, so Softov can watch them.
Each session has `isolation=worktree`, and its worktree is under `/github/ahpd.worktrees/build-agents-<id>`.
The builder sets tasks `implemented`, never `done`.
The review reads the diff against the plan, probes the security and data-loss paths, and reruns the four gates (`pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build`).
On Softov's approval: commit in the worktree, rebase on main, rerun the gates, fast-forward main, remove the worktree and the branch, and keep the session.
Never push; Softov pushes.

## In flight

- **Unpushed:** main is ahead of `origin/main` by daemon/09 (`f1acaba`), plugin/37 tasks 02, 04, 05 (`6fb1289`), host/43 p4 task 01 (`85b0dc4`), plugin/38 (`9f3798c`), host/74 (`79a3541`), documentation/04 (`7356624`), host/43 p4 tasks 02-04 (`995f0ce`), their closures and the plugin/39 plan.
- **Waiting on Softov:** usage/06 task 03 and usage/07 task 04, which need his captures (Anthropic dialect, DeepSeek, a live `claude-openrouter` turn).
- **Building:** [plugin/39](../plans/plugin/39-each-options-schema-declares-every-field-the-code-reads/plan.md), worktree `build-agents-p39`, from `1171c04`, built here (no DeepSeek balance).
- **Clients ready for host/43 p4:** ahpapp host/05 (`a66f582`) reads both names and sends `ahpd.commit`; ahpc ahp/07 (`a13ec65`) reads `ahpd.model` too. Both are merged on their mains and unpushed.

## Next, buildable now

1. host/43 p4 task 05 after the ahpapp build people run sends `ahpd.commit`.
2. Planned and not started: host/44 p2-p3, host/45, host/47 p1-p6 (AHP 1.0.0); host/59-61 (refactors); host/49, host/50; daemon/13 task 04; claude/19.

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
- The gates as one line, run in a worktree: `pnpm install && node tools/schema.mjs && pnpm build && pnpm typecheck && pnpm boundary && npx vitest run --maxWorkers=2 --testTimeout=10000`. The suite takes about ten minutes; two at once roughly double it.
- Every suite run rewrites `packages/sdk/test/fixtures/wire.jsonl` with this box's endpoints; `git checkout --` it before committing.
- A build session is started with `node /github/ahpc/dist/src/main.js --host ws://127.0.0.1:37537 session new --agent claude-deepseek-build --cwd /github/ahpd --set permissionMode=dontAsk --set effortLevel=high --set isolation=worktree --set branch=main --set worktreeBranchPrefix=build/`, then `prompt <uri> "<text>"`; `session list` and `session history <uri>` watch it. A builder sometimes ends its turn waiting on a watcher that never wakes it, so read its worktree, not only its report.
