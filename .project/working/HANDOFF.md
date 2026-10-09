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

- **Waiting on Softov:** usage/06 task 03 and usage/07 task 04, which need his captures (Anthropic dialect, DeepSeek, a live `claude-openrouter` turn).
- **cofold released:** agents 0.2.1 and tools 0.3.0 (`release-2026-10-09`). ahpd is still on 0.1; moving it broke 25 agent-cofold tests, so [plugin/40](../plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md) takes the whole range and certifies every change. plugin/22 task 04 is dropped into plugin/40 task 07.
- **cofold tools/04** (planned in cofold): `files: { requireRead: false }` turns off the read-first rule. Its release and version are Softov's; plugin/40 task 09 takes it after.
- **claude/19:** built in `/github/ahpd.worktrees/build-agents-claude-19`, tasks `implemented`, uncommitted; waits for review.
- **Parked:** `/github/ahpd.worktrees/build-agents-cofold-uptake` holds the first try at the range move. plugin/40 starts from main and copies what it needs; removing the worktree is Softov's call.
- **VS Code 1.141 hosts:** ahpc ahp/08 (`356852c`) and ahpapp host/06 (`2b63956`) offer `0.10.0` after `1.0.0`. Merged and pushed, not yet tried against a live 1.141 host.
- **Clients ready for host/43 p4:** ahpapp host/05 (`a66f582`) reads both names and sends `ahpd.commit`; ahpc ahp/07 (`a13ec65`) reads `ahpd.model` too. Both are merged and pushed.

## Next, buildable now

Ten, in waves of at most three; every requirement is built.

| Wave | Plan | Note |
| --- | --- | --- |
| 1 | [plugin/40](../plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md) tasks 01-08 | 01 and 02 land together |
| 1 | [claude/19](../plans/claude/19-a-question-shows-its-headers-and-its-answer-at-once/plan.md) | review and merge only |
| 1 | [host/59](../plans/host/59-one-record-store-provider-and-shared-value-helpers/plan.md) | unblocks host/61 |
| 2 | cofold tools/04 | tested against plugin/40 01-08 with a packed tarball; no version, no tag |
| 2 | [host/60](../plans/host/60-one-json-file-reader-and-writer-and-a-session-is-one-row/plan.md) | the session store; before host/50 |
| 2 | [host/49](../plans/host/49-a-session-loads-a-clients-plugins/plan.md) | unblocks host/47 p5 |
| 3 | [host/50](../plans/host/50-a-peer-chat-is-its-own-conversation/plan.md) | after host/60; unblocks host/47 p1 |
| 3 | [host/44 p2](../plans/host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/plan.md) | |
| 3 | [host/45](../plans/host/45-root-config-declares-every-value-it-holds/plan.md) | |
| 4 | [host/44 p3](../plans/host/44-ahpd-speaks-ahp-1-0-0-p3-a-sessions-row-lists-its-chats/plan.md) | after host/50, which records a session's chats |

After those: plugin/40 task 09 (after Softov releases tools/04), [plugin/36](../plans/plugin/36-a-cofold-turn-reads-its-attachments/plan.md) (after plugin/40), host/61 (after host/59 and plugin/40, both touch `runs.ts`), host/47 p1-p6, host/43 p4 task 05, daemon/13 task 04.

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
