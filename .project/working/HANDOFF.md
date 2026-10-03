---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. [plans/index.md](../plans/index.md) is the backlog; what merged is in `git log` since `9e21f7e`.

## In flight (2026-10-03, evening)

Builds run as sessions on Softov's daemon, at most three at once, in worktrees under `/github/ahpd.worktrees/`; each is reviewed against its plan with probes before it is closed and merged. Never push.

- **Merged today, unpushed:** plans review fixes (`b5c3992`), [host/42](../plans/host/42-an-automation-owner-rides-in-meta/plan.md) (`08371ca`), [host/40](../plans/host/40-a-connection-is-told-who-it-is/plan.md) (`d640a11`), [claude/16](../plans/claude/16-a-preset-that-fails-skips-only-itself/plan.md) and [host/41](../plans/host/41-a-failure-belongs-to-the-item-that-failed/plan.md) (`a603dc9`), plans host/43 (`22c08e0`).
- **Building:** [plugin/16](../plans/plugin/16-a-disposable-machine/plan.md) in `build-agents-4f6063dd` (session `claude-openrouter-build:/464c648a-...`, base e168711, uncommitted), on its third fix turn: owner check at session creation, host-id read errors, UUID-only id, `wx` create. After it: re-review, rebase onto main (only `host.ts` overlaps), close, merge.
- **Restart owed:** once plugin/16 merges, Softov restarts his daemon to wire in host/40, 41, 42, claude/16 and plugin/16. After it the daemon keeps `claude` without `OPENROUTER_API_KEY`; the build preset still needs the key.
- **Plans being written (uncommitted on main when they land):** host/44 (move to AHP 1.0.0, p1 speak 1.0.0 and 0.9.0; p2 automation `disableConditions`, `runCount`; p3 `SessionSummary.chats`), with host/43 retargeted to 1.0.0; host/45 (root config declares the ~40 keys VS Code pushes, as upstream); host/46 (built-in surfaces advertised, roles grant `subject:operation`). Review them, then commit, then build host/44 p1 first.
- **AHP 1.0.0:** additive over 0.9.0. ahpd accepts 1.0.0 and 0.9.0, highest compatible wins (Softov). ahpd must ship host/44 p1 before ahpapp bumps its protocol package; ahpc needs `'1.0.0'` at `src/ahp/live.ts:207`. Softov migrates the clients himself; the ahpapp session (softov-c6) waits for word that host/44 p1 merged.
- **host/43** (wire follows the protocol): written, waits on host/44 p1. Client hand-off draft for it is in the build session's scratch `client-changes-for-protocol.md`, on hold.
- **Old worktree** `build-agents-a6e38512`: another session's earlier copy of host/40, now merged from its own worktree; Softov decides whether to remove it.
- **Flaky:** `agent-acp-ports.test.ts` ("reads and writes a file through the host's own store") fails under full load and passes alone.

## Queue after that

host/44 p1, then host/43 p1-p4 (p4's renames after ahpapp and ahpc read both names), host/44 p2-p3, host/45, host/46; the container line: container/03 (rebase after plugin/16; listing labels and vault values in clear are known defects in its worktree `build-agents-74c74a74`), then 05 p1, container/02 task 04, 05 p3-p7, p12 (needs a proxy listener plan), p9, p11 (libvirt on dev86 first). Usage and policy plans (usage/05, policy/02, proxy/02, policy/03) belong to the other session, as do the ten records there that cite ahp-review.

## Open questions recorded in plans

About thirty, in each plan's Resume state, asked when the plan comes up for building: container/02, 04, 05 p1, p3, p5, p6, p7, p8, p9, p10, p12; plugin/18, 20, 21, 22, 29 p4, 33; daemon/09, 12, 13; host/33, 43 p3 (`http` sent as `object`, `true` as `{}`, explained, awaiting a yes); claude/11.

## Waiting on Softov

- The claude/08 check in ahpapp; daemon/09's final check; checks 6-21 of 0.8.0; by-hand checks for host/30 task 05, daemon/13 and claude/10 task 03.
- host/30 task 06: the upstream issue's text, shown before it is posted.
- cofold commands/03 and the `@cofold/terminal` range bump.
- ahpapp chat/02's two open questions.
- Removing the redundant worktrees `/github/.worktrees/ahpd-server`, `ahpd-sdk`, `ahpd-sdk-2`, and `build-agents-a6e38512`.
- A rule he may want to write: a failure belongs to the item that failed (one bad preset, profile, part, runtime or secret fails alone).

## Must ship in 0.8.1

- Four gate holes on main and in 0.8.0: a session driven by a `file:read` guest through `file:///<id>`; a terminal under a foreign scheme driven with `file:read`; automations created by a `file:read` guest; a changeset operation run with `file:write` alone.
- daemon/09 reaches the registry only in 0.8.1, since the published 0.8.0 sdk still peers the protocol package.

## Checks nobody has made

- VS Code with the seeded `computer` picker: the chip reads `This host` or a machine's name, once.
- ahpapp against the published packages: the computer picker, and the dev container relay with `devcontainer.plugins` in a real container.
- Session state written by 0.6 read by 0.8.
- An MCP tool call on each agent: listed, runs, result shown.
- In ahpapp or VS Code: an approval's options (host/24), a fork shown as a fork (host/25), the list while a worker runs (host/27), a restored Claude session (claude/05), Stop inside a subagent (claude/06), a re-subscribe after an open call (claude/07), tool call titles (pi/12).
- daemon/11 in ahpapp: editing a plugin's options and a credential answered `<set>`.

## Next after the release

- The `docs/` prose pass.
- README and manifest mismatches: the computer README lists 9 of 18 options; the `ahpd.options` manifests disagree with the code in tunnel-devtunnel, agent-acp, agent-pi and computer; agent-cofold has none; cofold's README says `apiKey` may be a function.

## Environment notes written nowhere else

- CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`.
- A manifest change needs `pnpm install --no-frozen-lockfile` once; a package committed without its importer in `pnpm-lock.yaml` breaks `--frozen-lockfile` for everybody.
- A plugin whose `ahpd.entry` is under `dist` must be rebuilt after its source moves.
- The daemon runs out of heap at about 2 GB with six build sessions; three at once holds.
- An OpenRouter Claude session cannot be resumed after a daemon restart (`400 previous_message_id`); start a new one in the same worktree. Its first request sometimes fails with an empty response; retry once.
- `packages/computer/test/computer-disposable.test.ts` ("loads the disposable example") fails about one full run in three under load and passes alone.
- `agent-acp-ports.test.ts` flakes the same way.
- `ahpc watch --until idle` returns early; poll `session list --json` instead (status bit 8 is in progress).
