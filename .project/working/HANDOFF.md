---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

What is in progress and what is waiting. Plans, decisions and docs say the rest; [plans/index.md](../plans/index.md) is the backlog.

## Now

- `main` is at `1d00d3f`, pushed. 47 commits since `v0.7.0` are unreleased.
- `@cofold/remote` 0.4.0 is released (cofold tag `release-2026-09-28`); ahpd still depends on `^0.3.1` until daemon/05 task 16 moves it.
- Two builders are working in worktrees, each awaiting Softov's review and a merge to `main`:
  - `/github/ahpd-d05t16`, branch `d05-16`: [daemon/05](../plans/daemon/05-an-http-api/plan.md) task 16, the HTTP API on Node, Bun and Deno.
  - `/github/ahpd-claude04`, branch `claude-04`: [claude/04](../plans/claude/04-a-subagent-has-its-own-chat/plan.md) fix tasks 08 to 16.

## Waiting on Softov

- [plugin/14](../plans/plugin/14-cofold-runs-its-own-tools/plan.md) fix tasks 17 to 20 are implemented and await review.
- [plugin/22](../plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) waits on Softov choosing the approach (task 01).
- [acp/11](../plans/acp/11-the-agent-gets-mcp-servers/plan.md) is a draft with two open questions.
- [A plugin file without its own package.json takes the enclosing package's manifest](../problems/a-plugin-file-without-a-manifest-takes-the-enclosing-packages.md) is open, with two candidate fixes and none chosen.

## Blocked or not started

- [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md) is blocked: VS Code does not list the ahpd dev tunnel.
- [container/05](../plans/container/05-an-agent-in-a-machine/plan.md) p8, p9 and p10 are drafts.
- [plugin/15](../plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md), [plugin/16](../plans/plugin/16-a-disposable-machine/plan.md), [container/03](../plans/container/03-a-dev-container-is-a-computer/plan.md) and [container/04](../plans/container/04-a-cofold-session-in-a-computer/plan.md) have review fix tasks still `todo`.

## Checks nobody has made

- Before the next release, the upgrade a 0.6.x operator meets; no machine here had 0.6.x installed.
- VS Code with the seeded `computer` picker: the chip should read `This host` or a machine's name, once.
- ahpapp against the published packages: the computer picker, and the dev container relay with `devcontainer.plugins` in a real container.
- `packages/computer/README.md` is stale: it says nothing under `computer:` is written, while [docs/COMPUTER.md](../../docs/COMPUTER.md) makes a machine with `resourceWrite`. It waits on whether the README becomes the full user doc.

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`; a test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- A manifest change needs `pnpm install --no-frozen-lockfile` once, because `CI=true` freezes the lockfile; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves, or a daemon that loads it by name runs the stale build.
