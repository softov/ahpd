---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-10-06. [plans/index.md](../plans/index.md) is the backlog and each plan's Resume state is its detail; what merged is in `git log`.

## How builds run now

Builds run as Agent subagents in worktrees under `.claude/worktrees/`, not as daemon sessions (the free build model is gone).
Each one: build, review the diff and the security paths, rerun the four gates (`pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build`), Softov's answers become plan rows, a fix turn, close-out (`implemented.md`, plan `built`, index row "tasks implemented, awaiting review"), show Softov, and on his approval commit on the branch, rebase on main, fast-forward main, remove the worktree.
Never push; Softov pushes.

## In flight

- **Merged 2026-10-06, unpushed:** `f76e948` (plans) and container/05 p7 (`b677360`).
- **Restart owed:** Softov restarts his daemon to wire in container/05 p6 (`7cd7117`), the acp model fix (`08f046b`) and p7 (`b677360`); p7 brings the profile setting `gitGuard`, default `bind`.
- **Known limit after p7:** ahpd's own `git worktree add` and changes-view commit run the repository's hooks on the host; under `gitGuard: "open"` an agent could have written them.

## Queue

1. [container/04](../plans/container/04-a-cofold-session-in-a-computer/plan.md) tasks 07-17; task 17 now follows [the host records which plugin registered each agent](../decisions/the-host-records-which-plugin-registered-each-agent.md).
2. [container/05 p5](../plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md), whole.
3. daemon/09 with daemon/13, host/57 and plugin/18, then plugin/20, then plugin/33.

Planned 2026-10-05 and 2026-10-06, no open questions, not yet placed in that order:
- [host/58](../plans/host/58-private-files-refused-cursors-and-decoded-file-uris/plan.md) (bugs, high), then [host/59](../plans/host/59-one-record-store-provider-and-shared-value-helpers/plan.md), [host/60](../plans/host/60-one-json-file-reader-and-writer-and-a-session-is-one-row/plan.md), [host/61](../plans/host/61-agents-share-their-session-kit-presets-and-input-checks/plan.md): code reduction.
- [host/62](../plans/host/62-every-backend-calls-a-clients-tool/plan.md) p1-p4: every backend calls a client's tool.
- [daemon/15](../plans/daemon/15-a-verb-declares-only-its-own-flags/plan.md): a verb declares only its own flags.
- In cofold: [commands/04](../../../cofold/.project/plans/commands/04-an-action-declares-what-it-does-to-what/plan.md) (effect and resource on an action); ahpd declares them on its commands in a later plan, after that cofold release.

## Waiting on Softov

- host/56 task 05: his measurement with the probes in `/github/ahpapp/.scratch/org/`.
- host/30 task 05: his VS Code test by hand.
- The VS Code test host (`code agent host`, 127.0.0.1:37600) may still be running from 2026-10-05; stop it when he is done.
- Flaky tests: `computer-devcontainer.test.ts` "offers the session folder's dev container" under full load, `ENOTEMPTY` in afterEach cleanup, and once a `computer-needs.test.ts` vault restart case; a problem file or a fix plan was offered, no answer yet.
- Fork PR workflows run without approval for returning contributors (`first_time_contributors`); he may change it.

## Carried from 2026-10-03, not rechecked since

- Must ship in 0.8.1: four gate holes (a session driven by a `file:read` guest through `file:///<id>`; a terminal under a foreign scheme driven with `file:read`; automations created by a `file:read` guest; a changeset operation run with `file:write` alone), and daemon/09 on the registry.
- Checks nobody has made: VS Code's `computer` picker chip; ahpapp against the published packages; 0.6 session state read by 0.8; an MCP tool call on each agent; host/24, 25, 27, claude/05, 06, 07, pi/12 in a client; daemon/11 in ahpapp.
- After the release: the `docs/` prose pass; README and manifest mismatches in computer, tunnel-devtunnel, agent-acp, agent-pi and agent-cofold.

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`.
- `pnpm test` generates `tools/ahp.strict.schema.json` first; running vitest alone in a fresh checkout fails the acp ports tests for want of it.
