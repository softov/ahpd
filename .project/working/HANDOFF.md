---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. [plans/index.md](../plans/index.md) is the backlog.

## Now

- 0.8.0 is published: all 8 `@ahpd` packages on npm, from `v0.8.0` on `bde31b5`.
- Next: Softov checks the upgrade from his installed 0.7.0.

## Waiting on Softov

- [host/26](../plans/host/26-the-changeset-reads-git-status-right/plan.md) task 01 waits on which client and scope showed the `D` (the question in its Resume).
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
- In ahpapp or VS Code: an approval's options in its dropdown (host/24), a fork shown as a fork (host/25), the session list while a worker runs (host/27), a restored Claude session (claude/05), Stop inside a subagent with and without `workerStop: "session"` (claude/06), a re-subscribe after a turn that ended with an open call (claude/07), and tool calls titled by what they run on (pi/12).

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`; a test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- A manifest change needs `pnpm install --no-frozen-lockfile` once, because `CI=true` freezes the lockfile; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves, or a daemon that loads it by name runs the stale build.
