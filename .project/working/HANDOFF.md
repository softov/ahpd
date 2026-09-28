---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

What is in progress and what is waiting. Plans, decisions and docs say the rest; [plans/index.md](../plans/index.md) is the backlog.

## Now

- `origin/main` is at `474b455`; nothing since `v0.7.0` is released.
- `@cofold/remote` 0.4.0 is released (cofold tag `release-2026-09-28`), and ahpd depends on `^0.4.0`.
- Closed on 2026-09-28 after Softov's checks: [daemon/05](../plans/daemon/05-an-http-api/plan.md), [claude/04](../plans/claude/04-a-subagent-has-its-own-chat/plan.md), [pi/11](../plans/pi/11-a-turns-parts-come-in-the-order-they-were-written/plan.md) and [plugin/14](../plans/plugin/14-cofold-runs-its-own-tools/plan.md).
- Committed on main, awaiting Softov's review: [host/24](../plans/host/24-an-approval-offers-the-agents-own-options/plan.md), [host/25](../plans/host/25-a-forked-chat-says-where-it-came-from/plan.md), [host/26](../plans/host/26-the-changeset-reads-git-status-right/plan.md) (task 01 blocked, the `D` not reproduced), [host/27](../plans/host/27-a-session-reads-running-while-any-chat-runs/plan.md), [claude/05](../plans/claude/05-a-replayed-exchange-is-one-turn/plan.md), [claude/06](../plans/claude/06-a-stop-in-a-worker-chat-stops-that-worker/plan.md), [claude/07](../plans/claude/07-a-turn-ends-with-no-call-left-open/plan.md), [pi/12](../plans/pi/12-a-tool-call-says-what-it-runs-on/plan.md), [daemon/07](../plans/daemon/07-an-upgrade-without-a-backend-is-told-the-command/plan.md) and [acp/01](../plans/acp/01-the-bridge-survives-its-agent/plan.md) task 01 (a missing ACP command fails the turn instead of ending the daemon).
- Main has the 0.8.0 bump and no `v0.8.0` tag; the tag is made only once Softov validates publishing, since pushing it publishes.
- `docs/PLUGINS.md` and `packages/agent-acp/README.md` name `@agentclientprotocol/codex-acp` as where `codex-acp` comes from, uncommitted.
- The 0.6.x upgrade was checked on 2026-09-28: a 0.6 configuration names no plugin, since 0.6 had Claude built in, so 0.8.0 exits saying no backend is loaded, which daemon/07 makes name `ahpd plugin install @ahpd/agent-claude`; with the plugin installed it serves, and a 0.6.3 background daemon is shown and stopped by 0.8.0. Session state written by 0.6 was not exercised.

## Waiting on Softov

- Uncommitted on 2026-09-28, gates green in main's tree: the README and `package.json` pass over all 8 packages and the root README; [daemon/08](../plans/daemon/08-the-config-file-is-checked-in-one-place/plan.md) and [plugin/26](../plans/plugin/26-a-plugin-declares-its-options-schema/plan.md) implemented, awaiting review, on `@cofold/config` ^0.3.0 (released 2026-09-28, cofold `c7835d6`, tag `release-2026-09-28-2`). The `docs/` prose pass is next.
- Found by plugin/26, not fixed: the computer README lists 9 of 18 options; `ahpd.options` manifests disagree with the code in tunnel-devtunnel, agent-acp, agent-pi, computer, and agent-cofold has none; cofold's README says `apiKey` may be a function.

- [plugin/22](../plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) waits on Softov choosing the approach (task 01).
- [acp/11](../plans/acp/11-the-agent-gets-mcp-servers/plan.md) is a draft with two open questions.
- [A plugin file without its own package.json takes the enclosing package's manifest](../problems/a-plugin-file-without-a-manifest-takes-the-enclosing-packages.md) is open, with two candidate fixes and none chosen.

## Blocked or not started

- [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md) is blocked: VS Code does not list the ahpd dev tunnel.
- [container/05](../plans/container/05-an-agent-in-a-machine/plan.md) p8, p9 and p10 are drafts.
- [plugin/15](../plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md), [plugin/16](../plans/plugin/16-a-disposable-machine/plan.md), [container/03](../plans/container/03-a-dev-container-is-a-computer/plan.md) and [container/04](../plans/container/04-a-cofold-session-in-a-computer/plan.md) have review fix tasks still `todo`.

## Checks nobody has made

- VS Code with the seeded `computer` picker: the chip should read `This host` or a machine's name, once.
- ahpapp against the published packages: the computer picker, and the dev container relay with `devcontainer.plugins` in a real container.
- `packages/computer/README.md` is stale: it says nothing under `computer:` is written, while [docs/COMPUTER.md](../../docs/COMPUTER.md) makes a machine with `resourceWrite`. It waits on whether the README becomes the full user doc.

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`; a test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- A manifest change needs `pnpm install --no-frozen-lockfile` once, because `CI=true` freezes the lockfile; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves, or a daemon that loads it by name runs the stale build.
