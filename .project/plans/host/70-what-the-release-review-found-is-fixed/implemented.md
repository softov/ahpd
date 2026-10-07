---
title: What the 0.10.0 release review found is fixed - implemented
date: 2026-10-07
refs:
  - git://b1a1e7d - the commit this work sits on; none of it is committed yet, on `build/agents/4f2c8f8e`
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - `remove`, `told`, and the bring-back it refuses to lose"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts) - `dispatchNeeds`"
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts) - `ROOT_CONFIG_SCHEMA`"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - the order of the values a session is built from"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - grants, trusted folders and the per-connection keys"
---

ahpd 0.10.0 now ships without the defects a release review of everything since v0.9.0 found.
A machine is removed only once its work is out, and ahpd never removes a person's own dev container by mistake.
Pushing a window's answer about trust needs a grant.
The key that approves every tool call is one a client can see and turn off.
A session that leaves its machine no longer reads an empty history.
A preset can turn the sandbox off for a session that had it on.
The docs describe 0.10.0 rather than 0.9.

## What was built

- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `told(held, said)` throws for a git command that exited non-zero with text on stderr. A failed `docker exec` therefore never reads as "nothing to bring back". A quiet non-zero exit still answers "no such branch". The three git closures of `bringBackBranch`, `bringBackOfMachine` and `keepUncommitted` go through it. `remove` starts a machine that is not running, where it has work to read. A start, a bring-back or a `keepUncommitted` that fails throws `Could not remove <name>, so it is still here: <cause>` before the `rm -f`. The machine and its volumes stay.
- [`code://packages/computer/src/tools.ts`](../../../../packages/computer/src/tools.ts) - `release_computer` answers that sentence to the model rather than throwing it, so an agent is told the machine is still there.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the disposable timer takes a machine out of `disposables` only after a removal that worked, and logs the refusal and arms again otherwise. `madeUnderBind` judges only a container carrying one of the six labels ahpd writes. A person's own dev container is therefore never removed for a read-only bind of a path in a git directory.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - the clash check folds in the path the runtime mounts for the session's folder, `repository ?? folder`, and nothing under `copy`.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - `trust` joins `SUBJECTS`, and the built-in `member` role holds `trust:write`.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `dispatchNeeds` asks for `trust:write` when a root config carries `workspaceTrust`, and for a sign-in alone when it carries only a connection's own `defaultShell`.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `ROOT_CONFIG_SCHEMA` declares `globalAutoApproveEnabled`, a boolean, default false and titled "Approve Everything", which was read by `trust.ts` and declared nowhere.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - a session that leaves its machine drops its nested record, so a daemon started after the move reads its history from the backend. `restartChat` closes the chat it replaces with `removing` false, as the whole-session restart does.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - the stored sandbox is spread over the preset only when the preset does not say `off`, so a variant built to run unsandboxed does.
- [`code://packages/sdk/src/sessiontools.ts`](../../../../packages/sdk/src/sessiontools.ts) - both answers `set_workspace` gives name the folder with `uriOf`, so a `#` or a `?` in a path is escaped.
- [`code://docs/USERS.md`](../../../../docs/USERS.md), [`code://docs/AHP.md`](../../../../docs/AHP.md), [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md), [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md), [`code://docs/COMPUTER.md`](../../../../docs/COMPUTER.md), and the Claude, pi and ACP READMEs - the docs describe 0.10.0 rather than 0.9. `docs/USERS.md` gained a "Trusted folders" section. `docs/AHP.md` names the two per-connection keys and the sandbox rules. `docs/PLUGINS.md` gained `gitDir`, the two further machine need kinds, and the MCP tools endpoint that runs a client's tool and streams list changes. Its ACP preset table gained `honoursTrust` and `toolsChanged`. `docs/DAEMON.md` gained `--client-tool-timeout-ms`. `docs/COMPUTER.md` gained what a removal does with a stopped machine and with work it cannot bring out.

## Verified

- `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` reports nothing undeclared in any of the eight packages.
- `npx vitest run` from the repository root: 236 files, 3516 tests, all pass.
- The real-Docker cases in `packages/computer/test/computer-git-fetch.test.ts` ran, 26 of 26, and not skipped: the file took 154 seconds. The four cases task 01 names are among them, `brings back the commits of a stopped machine before it removes it`, `keeps the uncommitted files of a stopped copy machine before it removes it`, `keeps a machine whose work cannot be brought back, and says why`, and `release_computer answers the refusal and the machine is still there`.
- `rg -n "workspaceTrust|honoursTrust|clientToolTimeoutMs|globalAutoApproveEnabled" docs packages/*/README.md` finds every key.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` on the plan folder is clean. The findings it still prints in `docs` are sentences older than this plan; nothing written here added one.

## Departures from the plan

- task 08's line for `docs/PROXY.md:105-119` and `docs/POLICY.md:85` said session calls are not wired yet. Read against `chargedAs` in `packages/server/src/proxy/listener.ts`, both already describe `proxy.sessionCalls` as it is, so nothing was corrected there.
- task 07's change reversed the premise of a case in `packages/sdk/test/host-sessionconfig.test.ts`, which still asked for a stored sandbox on over a preset that says off. The full gates found it, and the case now asks for the preset's answer in both spellings. Its other half, a session with no preset keeping its stored on, is unchanged.
- The helper in `packages/agent-claude/test/agent-claude-declarations.test.ts` passed `settings: undefined`, which `exactOptionalPropertyTypes` refuses. It now spreads the member only when it is there.

## Left for later

- `leftOver()` in `computer-disposable.test.ts` and `computer-git-fetch.test.ts` reads the whole `TMPDIR` of a run, which every test file shares. A bundle another file has in flight therefore reads as a leftover. It is older than this plan, no task here covers it, and each file passes alone. See the Resume of [task-01](task-01-a-machine-is-removed-only-once-its-work-is-out.md).
