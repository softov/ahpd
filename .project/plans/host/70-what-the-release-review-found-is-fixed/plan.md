---
title: What the 0.10.0 release review found is fixed
domain: host
status: built
priority: high
created: 2026-10-07
revalidated: 2026-10-07
decisions:
  - decisions/pushing-workspace-trust-needs-trust-write.md
  - decisions/a-preset-sandbox-off-wins-over-a-stored-on.md
refs:
  - "[code://packages/computer/src/runtime.ts#L770-L789](../../../../packages/computer/src/runtime.ts#L770-L789) - `ran` resolves on a non-zero exit, so a failed `docker exec` reads as empty output"
  - "[code://packages/computer/src/runtime.ts#L2200](../../../../packages/computer/src/runtime.ts#L2200) - `bringBackBranch` reads only stdout"
  - "[code://packages/computer/src/runtime.ts#L2347-L2352](../../../../packages/computer/src/runtime.ts#L2347-L2352) - `bringBackOfMachine` reads a failed branch list as no branches"
  - "[code://packages/computer/src/runtime.ts#L2393](../../../../packages/computer/src/runtime.ts#L2393) - `keepUncommitted` reads a failed status as a clean tree"
  - "[code://packages/computer/src/runtime.ts#L3127-L3153](../../../../packages/computer/src/runtime.ts#L3127-L3153) - `remove`, which removes the git volume after a fetch that may not have run"
  - "[code://packages/computer/src/runtime.ts#L1325-L1332](../../../../packages/computer/src/runtime.ts#L1325-L1332) - `madeUnderBind`"
  - "[code://packages/computer/src/devcontainer.ts#L66-L69](../../../../packages/computer/src/devcontainer.ts#L66-L69) - the labels an adopted dev container has"
  - "[code://packages/computer/src/manifest.ts#L1071-L1081](../../../../packages/computer/src/manifest.ts#L1071-L1081) - the clash check folds in the session folder"
  - "[code://packages/computer/src/runtime.ts#L3069-L3071](../../../../packages/computer/src/runtime.ts#L3069-L3071) - the runtime mounts the repository, and nothing under `copy`"
  - "[code://packages/sdk/src/host/gate.ts#L269-L276](../../../../packages/sdk/src/host/gate.ts#L269-L276) - `dispatchNeeds`"
  - "[code://packages/sdk/src/users.ts#L23-L45](../../../../packages/sdk/src/users.ts#L23-L45) - the built-in roles and `SUBJECTS`"
  - "[code://packages/sdk/src/host/trust.ts#L163](../../../../packages/sdk/src/host/trust.ts#L163) - `autoApproved` reads `globalAutoApproveEnabled`"
  - "[code://packages/sdk/src/host/root.ts#L162-L208](../../../../packages/sdk/src/host/root.ts#L162-L208) - `ROOT_CONFIG_SCHEMA`, which does not declare it"
  - "[code://packages/sdk/src/host/lifecycle.ts#L545-L550](../../../../packages/sdk/src/host/lifecycle.ts#L545-L550) - a session leaves its machine; the nested record stays"
  - "[code://packages/sdk/src/host/history.ts#L310-L322](../../../../packages/sdk/src/host/history.ts#L310-L322) - a nested record makes the history empty"
  - "[code://packages/agent-claude/src/session.ts#L73](../../../../packages/agent-claude/src/session.ts#L73) - the stored sandbox is spread after the preset"
  - "[code://packages/sdk/src/sessiontools.ts#L430-L431](../../../../packages/sdk/src/sessiontools.ts#L430-L431) - a `file://` URI written by hand"
  - "[code://packages/sdk/src/host/lifecycle.ts#L690](../../../../packages/sdk/src/host/lifecycle.ts#L690) - `chat.close()` with the default `removing`"
---

## Goal

ahpd 0.10.0 ships without the defects a release review of everything since v0.9.0 found.
A removed machine never loses its work, and ahpd never removes a person's own dev container by mistake.
Pushing trust needs a grant.
The docs describe 0.10.0.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The review ran in three sessions, one each for `packages/sdk`, `packages/computer` with `packages/server`, and the agent packages.
Each finding below was read against the code before it went into this plan.

### Searches performed

- `rg "globalAutoApproveEnabled" packages/sdk/src packages/server/src` - only `trust.ts`.
- `rg "workspaceTrust|honoursTrust|clientToolTimeoutMs" docs README.md packages/*/README.md` - nothing.
- `git show v0.9.0:packages/computer/src/runtime.ts` - a 0.9 machine has the provider label and at least one `ahpd.*` label.

### Runtime path

```
remove(machine) -> running? start it -> bringBack (a failed exec throws) -> keepUncommitted -> rm -f -> volume rm
```

### Gaps

- A failed `docker exec` reads as "nothing to bring back".
- An adopted dev container can match `madeUnderBind`.
- The clash check and the runtime name different mount sources.
- `workspaceTrust` needs no grant.
- `globalAutoApproveEnabled` is read and declared nowhere.
- A nested record outlives the machine it was for.
- A stored sandbox on cannot be turned off.
- The docs do not describe trust, `honoursTrust`, `clientToolTimeoutMs`, the MCP tools endpoint of 0.10, or six machine need kinds.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [Pushing workspaceTrust needs trust:write, and the member role has it](../../../decisions/pushing-workspace-trust-needs-trust-write.md) | Softov, 2026-10-07 |
| 2 | [A preset that says sandbox off wins over a session stored with it on](../../../decisions/a-preset-sandbox-off-wins-over-a-stored-on.md) | Softov, 2026-10-07 |

| What | Source | Task |
| --- | --- | --- |
| `remove` starts a stopped machine before it brings the work back | `(defaulted: the fetch runs a command in the machine, and only a running one can)` | 01 |
| A failed exec in the bring-back throws; it never reads as empty | review finding, computer 1 | 01 |
| When the start or the bring-back fails, `remove` refuses, keeps the machine, and says why in one sentence; `release_computer` and `DELETE computer://` answer that sentence; the disposable timer logs it and arms again | `(defaulted: a machine kept is work kept; a volume left without its machine is a leak nobody sees)` | 01 |
| `madeUnderBind` judges only a machine that carries `ahpd.session`, `ahpd.disposable`, `ahpd.profile`, `ahpd.host`, `ahpd.owner` or `ahpd.agents` | review finding, computer 2; the 0.9 labels | 02 |
| The clash check folds in the path the runtime mounts: `repository ?? folder`, and nothing under `copy` | review finding, computer 3 | 03 |
| The three cases sit in `computer-disposable.test.ts`, beside the `sessionFolder` and `sessionRepository` ones | `(defaulted: the cases need a session and its scripted Docker, which that file has and `computer-options.test.ts` does not)` | 03 |
| `trust` joins `SUBJECTS`; `member` gets `trust:write`; a push with `workspaceTrust` needs it | decision 1 | 04 |
| The `trust` row sits in `docs/USERS.md`'s second grants table, and `ahpd.grants` carries no `trust` | `(defaulted: the plan adds the subject to `SUBJECTS`, which the page's test asks a row for; a `trust` line in the advertised map is an amendment the plan does not make)` | 04 |
| `globalAutoApproveEnabled` is declared in `ROOT_CONFIG_SCHEMA`: boolean, default false, title "Approve Everything" | `(defaulted: it is VS Code's key, and a key that changes trust must be visible)` | 05 |
| Leaving a machine also clears the session's nested record | review finding, sdk 4 | 06 |
| A preset `sandbox: "off"` wins over a stored on | decision 2 | 07 |
| `sessiontools.ts` writes the folder with `uriOf`; `restartChat` closes with `close(false)` | review findings, sdk 7 and 8 | 07 |
| The docs list in task 08 | review findings | 08 |
| `ToolCall.provider` stays as it is | `(defaulted: a wire field, not a defect; a release note)` | - |

## Proposed architecture

- **Data flow** - no new data; each fix is local to the file the refs name.
- **Event flow** - a refused trust push is a `rejectionReason` on `ahp-root://`, as any refused dispatch is.
- **State flow** - `remove` keeps a machine it could not empty; nothing else keeps new state.
- **Layer responsibilities** - `packages/computer`: tasks 01-03 · `packages/sdk`: tasks 04-07 · `packages/agent-claude`: task 07 · `docs`: task 08.
- **Source-of-truth files** - [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts), [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A machine is removed only once its work is out](task-01-a-machine-is-removed-only-once-its-work-is-out.md) | done | - |
| [02 - Only a machine ahpd made is judged as made under bind](task-02-only-a-machine-ahpd-made-is-judged.md) | done | - |
| [03 - The clash check names what the runtime mounts](task-03-the-clash-check-names-what-the-runtime-mounts.md) | done | - |
| [04 - Pushing trust needs trust:write](task-04-pushing-trust-needs-trust-write.md) | done | - |
| [05 - The approve-everything key is declared](task-05-the-approve-everything-key-is-declared.md) | done | - |
| [06 - Leaving a machine clears the nested record](task-06-leaving-a-machine-clears-the-nested-record.md) | done | - |
| [07 - A preset can turn the sandbox off, and two small fixes](task-07-a-preset-can-turn-the-sandbox-off.md) | done | - |
| [08 - Docs](task-08-docs.md) | done | 01-07 |

## Risks and tradeoffs

- Starting a stopped machine to empty it runs its entrypoint again. A machine that cannot start is kept and named, so nothing is lost.
- A role an operator wrote without `trust:write` makes its sessions untrusted after the upgrade. The docs say so.

## Resume state

- **Built 2026-10-07:** every task done; reviewed, gates green (3516 tests, 26 real-Docker cases ran), merged.
- **Done so far:** tasks 01 to 08, implemented on 2026-10-07 and uncommitted on `build/agents/4f2c8f8e`. `globalAutoApproveEnabled` is a boolean in the host's own root config schema, default false and titled "Approve Everything". A client draws the control and can turn it off. The recorded wire capture moved with it. `trust` is a subject a role may be written with, and the built-in `member` holds `trust:write`. `dispatchNeeds` asks for that grant when a root config carries `workspaceTrust`. A shell preference alone is still pushed with no grant, and so is anything on a host with no people directory. The page's grants table gained its `trust` row, which its own test asks for. The git calls of the bring-back throw on a non-zero exit with text on stderr. A quiet non-zero exit stays the answer "no such branch". `remove` starts a machine that is not running before it reads, and refuses with `Could not remove <machine>, so it is still here: <cause>` before the `rm -f`, so the machine and its volumes stay. `release_computer` answers that sentence, and the disposable timer logs it and arms again. `madeUnderBind` answers false for a container carrying none of the six labels ahpd writes. A person's own dev container is never removed for a read-only bind of a path in a git directory. The clash check folds in the path the runtime mounts for the session's folder. A profile mount at that path is refused in the manifest's words. The disposable path reads `withGit` before the manifest, to tell it what that path is. A session that leaves its machine drops its nested record with the two map entries. A daemon started after the move then reads its history from the backend, and not an empty conversation from a machine it is not in. The case runs one backend across two daemons, which is what a machine is. It was written first, and failed on the history before the clear, `expected [] to deeply equal ['hello']`. The failure path of the same restart still does not clear it, which the task records as a judgement. There the config may still name that machine. A preset that says `sandbox: "off"` now wins over a session stored with the sandbox on, so a variant built to run unsandboxed does. Both answers `set_workspace` gives name the folder as a URI rather than a hand-written `file://`. A `#` or a `?` in a path is escaped. `restartChat` closes the chat it replaces with `removing` false, as the whole-session restart does, so the machine keeps the transcript the chat comes back to. That step named no case, and one was written: it fails on `expected true to be false` for `disposeSession` with the plain close, and passes with `close(false)`.
- **Task 08:** the docs now describe 0.10.0. `docs/USERS.md` gained a "Trusted folders" section for `workspaceTrust`, the `trust:write` grant and `globalAutoApproveEnabled`. `docs/AHP.md` names the two per-connection keys and the sandbox rules a stored `on` and a preset `off` give. `docs/PLUGINS.md` gained `gitDir`, the two further need kinds, and the tools endpoint that runs a client's tool and streams list changes. Its ACP preset table gained `honoursTrust` and `toolsChanged`. `docs/DAEMON.md` gained `--client-tool-timeout-ms`, and `docs/COMPUTER.md` gained what a removal does with a stopped machine and with work it cannot bring out. `docs/PROXY.md` and `docs/POLICY.md` already described session calls as wired, so nothing was corrected there.
- **Next action:** none. The plan is built; `implemented.md` is written.
- **Open questions:** none.
- **Watch out for:** `ran` resolves on every exit; read `code` and `stderr`, not only `stdout`. `leftOver()` in `computer-disposable.test.ts` and `computer-git-fetch.test.ts` reads the whole `TMPDIR` of a run, and every test file shares it. A bundle another file has in flight reads as a leftover, so a full-package run can fail there while each file passes alone.

## Final verification checklist

- [x] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` from the root pass, every package.
- [x] The real-Docker cases in `computer-git-fetch.test.ts` ran, not skipped.
- [x] `plans/index.md` updated.
