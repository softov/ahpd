---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. [plans/index.md](../plans/index.md) is the backlog.

## Now

- 0.8.0 is published. Softov's checks 1 to 5 pass; checks 6 to 21 wait.
- plugin/28 and plugin/30 are closed: CI green on `aa66dec`. host/29 is on main.
- [daemon/09](../plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md) is on main in `21a4488`, pushed; its tasks wait on Softov's check. Task 03 waits on cofold commands/03. It reaches the registry only in 0.8.1, since the published 0.8.0 sdk still peers the protocol package.
- [claude/08](../plans/claude/08-tool-input-is-the-whole-input/plan.md) is built and reviewed on main, uncommitted; Softov checks the whole `toolInput` in ahpapp, then it is committed.
- [plugin/29](../plans/plugin/29-a-tool-call-says-when-it-ran/plan.md), tool call times, is planned: p1 (sdk helper) first, then p2-p5.
- Planned 2026-09-29, from the VS Code key comparison: [host/31](../plans/host/31-a-sessions-config-outlives-a-restart/plan.md) before [claude/10](../plans/claude/10-a-claude-session-runs-on-a-preset/plan.md) presets; [claude/09](../plans/claude/09-a-message-runs-on-the-agent-it-picked/plan.md) the agent picker; [daemon/11](../plans/daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md), [daemon/12](../plans/daemon/12-a-plugin-option-is-set-from-the-command-line/plan.md) and [daemon/13](../plans/daemon/13-ahpd-restart/plan.md) for configuration from a client. None started.

## Waiting on Softov

- cofold commands/03 is planned, not built; the `@cofold/terminal` range bump in ahpd needs his approval.
- The claude/08 check: he reports `toolInput` cut in ahpapp with the daemon run from source (2026-09-30); being traced.
- host/30 task 06: the upstream issue's text, shown to him before it is posted.

## Answered 2026-09-30, now planned

- [host/30](../plans/host/30-a-session-is-listed-under-its-providers-name/plan.md), [daemon/10](../plans/daemon/10-a-first-run-sets-the-daemon-up/plan.md) (`ahpd configure`), [acp/11](../plans/acp/11-the-agent-gets-mcp-servers/plan.md) (after daemon/11), [plugin/22](../plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md) (in cofold), and [plugin/31](../plans/plugin/31-a-plugin-file-takes-only-a-plugin-manifest/plan.md), which replaced the manifest problem.

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
- An MCP tool call on Claude, and on each other agent: the tool is listed, runs, and its result is shown.
- In ahpapp or VS Code: an approval's options in its dropdown (host/24), a fork shown as a fork (host/25), the session list while a worker runs (host/27), a restored Claude session (claude/05), Stop inside a subagent with and without `workerStop: "session"` (claude/06), a re-subscribe after a turn that ended with an open call (claude/07), and tool calls titled by what they run on (pi/12).

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`; a test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- A manifest change needs `pnpm install --no-frozen-lockfile` once, because `CI=true` freezes the lockfile; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves, or a daemon that loads it by name runs the stale build.
