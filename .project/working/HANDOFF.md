---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. [plans/index.md](../plans/index.md) is the backlog.

## Now

- 0.8.0 is not published; npm has 0.7.0. The `v0.8.0` tag on `origin` points at `3a399bb`, whose release failed on flaky tests.
- The fixes are committed on main and not pushed: the test flakes, [plugin/27](../plans/plugin/27-an-early-answer-reaches-the-paused-run/plan.md) and [host/28](../plans/host/28-a-changeset-watch-says-when-it-is-armed/plan.md).
- Next: Softov pushes main, deletes the remote `v0.8.0` and pushes it on the new head; then all 8 `@ahpd` packages are checked at 0.8.0 on npm, and Softov checks the upgrade from his installed 0.7.0.
- The worktree `/github/.worktrees/ahpd-flakes` (branch `flakes`) can be removed once the release is out.

## Waiting on Softov

- Review of built plans: [plugin/27](../plans/plugin/27-an-early-answer-reaches-the-paused-run/plan.md), [host/28](../plans/host/28-a-changeset-watch-says-when-it-is-armed/plan.md), [host/24](../plans/host/24-an-approval-offers-the-agents-own-options/plan.md), [host/25](../plans/host/25-a-forked-chat-says-where-it-came-from/plan.md), [host/26](../plans/host/26-the-changeset-reads-git-status-right/plan.md) (task 01 blocked, the `D` not reproduced), [host/27](../plans/host/27-a-session-reads-running-while-any-chat-runs/plan.md), [claude/05](../plans/claude/05-a-replayed-exchange-is-one-turn/plan.md), [claude/06](../plans/claude/06-a-stop-in-a-worker-chat-stops-that-worker/plan.md), [claude/07](../plans/claude/07-a-turn-ends-with-no-call-left-open/plan.md), [pi/12](../plans/pi/12-a-tool-call-says-what-it-runs-on/plan.md), [daemon/07](../plans/daemon/07-an-upgrade-without-a-backend-is-told-the-command/plan.md), [acp/01](../plans/acp/01-the-bridge-survives-its-agent/plan.md) task 01.
- [plugin/22](../plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) waits on the approach (task 01).
- [acp/11](../plans/acp/11-the-agent-gets-mcp-servers/plan.md) is a draft with two open questions.
- [A plugin file without its own package.json takes the enclosing package's manifest](../problems/a-plugin-file-without-a-manifest-takes-the-enclosing-packages.md): two candidate fixes, none chosen.

## Next after the release

- The `docs/` prose pass.
- README and manifest mismatches: the computer README lists 9 of 18 options and says nothing under `computer:` is written, while [docs/COMPUTER.md](../../docs/COMPUTER.md) makes a machine with `resourceWrite`; the `ahpd.options` manifests disagree with the code in tunnel-devtunnel, agent-acp, agent-pi and computer, and agent-cofold has none; cofold's README says `apiKey` may be a function.

## Blocked or not started

- [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md) is blocked: VS Code does not list the ahpd dev tunnel.
- [container/05](../plans/container/05-an-agent-in-a-machine/plan.md) p8, p9 and p10 are drafts.
- [plugin/15](../plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md), [plugin/16](../plans/plugin/16-a-disposable-machine/plan.md), [container/03](../plans/container/03-a-dev-container-is-a-computer/plan.md) and [container/04](../plans/container/04-a-cofold-session-in-a-computer/plan.md) have review fix tasks still `todo`.

## Checks nobody has made

- VS Code with the seeded `computer` picker: the chip should read `This host` or a machine's name, once.
- ahpapp against the published packages: the computer picker, and the dev container relay with `devcontainer.plugins` in a real container.
- Session state written by 0.6 read by 0.8.

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`; a test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- A manifest change needs `pnpm install --no-frozen-lockfile` once, because `CI=true` freezes the lockfile; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves, or a daemon that loads it by name runs the stale build.
