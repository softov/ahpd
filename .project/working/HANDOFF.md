---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only. [plans/index.md](../plans/index.md) is the backlog; what merged is in `git log` since `9e21f7e`.

## In flight (2026-10-02)

- Builds run as sessions on Softov's local daemon, at most three at once, in worktrees under `/github/ahpd.worktrees/`. Each is validated against its plan (diff read, probes on security and data-loss paths, gates rerun) before it is closed and merged. Never push.
- Merged today, unpushed: `a5f6704` (acp/12, acp/10), `c1408be` ([claude/15](../plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md)), `19ef0e8` (acp/04, 06, 08, 09, 11). Nothing is building now.
- Softov's `~/.config/ahpd/config.json` was rewritten to one agent-claude entry with presets `claude`, `claude-openrouter` and `claude-openrouter-build` (backup `config.json.bak-20261002-presets`). His daemon needs a restart, in his terminal, to pick up claude/15 and that config; until then the build runner falls back to `--set preset=build`.
- acp/05 waits for an ACP presets plan, not yet written; container/05 p2 and p5 wait for it too.

## Uncommitted on main

- [UPSTREAM.md](../../UPSTREAM.md) Pass 5, this file, and the computer-control planning below: five new decisions, two superseded, the vault domain, plugin/15 and 16, container/00 and 02 to 05 with p1 to p12, the trimmed idea `more-computer-runtimes`, and the index. Not committed until Softov approves.

## Planning now: computer control and the vault

- Decisions made today: [a dev container is reached by docker exec](../decisions/a-dev-container-is-reached-by-docker-exec.md), [a machine runtime is named for its maker](../decisions/a-machine-runtime-is-named-for-its-maker.md), [the vault is a port with a plain local file until it is encrypted](../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md), which superseded the encrypted one on 2026-10-03 ([encryption is an idea](../ideas/the-local-vault-is-encrypted.md)), [a secret is named in a host, team or user scope](../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md), [a plugin loads once and each preset is a variant](../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md).
- Order: [vault/01 p1](../plans/vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/plan.md) and [container/05 p1](../plans/container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md) first; then plugin/15 and 16 finish; then 05 p3 to p7; then the first remote test by hand on dev86 (Docker, `/dev/kvm`, no libvirt yet), then p12 (proxy) before p9 (ssh) and p11 (libvirt first on dev86).
- Softov answered the open questions on 2026-10-03; the answers are rows in each plan's second table, chosen for now, each made in one function or option so it can change. Only container/05 p1's question on how `up` takes a value stays open.
- Names the planning agent chose, for Softov to look at: the label `ahpd.name` (container/03), p8's profile options `code` and `gitCredential`, p2's rule that the host's tools reach a machine only at a non-loopback URL, and a joined node being host-owned and metered like an ssh machine (p10).
- libvirt is not installed on dev86 yet; p11 task 01 starts with it.
- A bug on main, fixed by [05 p5](../plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md) task 09: a Claude variant's env and pushed credentials are spread after the filtered machine env, so the daemon's env reaches a machine (`packages/agent-claude/src/session.ts`, the machine launch). Two Claude variants on one profile are refused only because the create check compares targets; p6 task 05 merges identical needs.
- Lost with claude/15 (in its `deferred.md`): agent-acp and agent-cofold can no longer serve two backends from one daemon until each gets presets.
- Ten records from the usage and policy work cite ahp-review (`policies-are-a-scheme-clients-edit`, `teams-and-projects...`, `policy-checks...`, `a-deny-binds...`, `usage-and-computer-time...`, usage/00, usage/04, plugin/32, policy/01 tasks 03 and 04). That session owns them; left for it.
- Then: usage/05 (prices), policy/02 (limits and charge rules), proxy/02 (listener), policy/03 (mid-turn debit), host/33 task files.

## Waiting on Softov

- The claude/08 check in ahpapp; daemon/09's final check; checks 6-21 of 0.8.0; by-hand checks for host/30 task 05, daemon/13 and claude/10 task 03.
- host/30 task 06: the upstream issue's text, shown before it is posted.
- cofold commands/03 and the `@cofold/terminal` range bump.
- ahpapp chat/02's two open questions.
- Removing the redundant worktrees `/github/.worktrees/ahpd-server`, `ahpd-sdk`, `ahpd-sdk-2`.

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
- `ahpc watch --until idle` returns early; poll `session list --json` instead (status bit 8 is in progress).
