---
title: What the 0.10.0 release review found is fixed
domain: host
status: planned
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
  - "[code://packages/computer/src/manifest.ts#L1050-L1052](../../../../packages/computer/src/manifest.ts#L1050-L1052) - the clash check folds in the session folder"
  - "[code://packages/computer/src/runtime.ts#L3021-L3023](../../../../packages/computer/src/runtime.ts#L3021-L3023) - the runtime mounts the repository, and nothing under `copy`"
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
| `trust` joins `SUBJECTS`; `member` gets `trust:write`; a push with `workspaceTrust` needs it | decision 1 | 04 |
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
| [01 - A machine is removed only once its work is out](task-01-a-machine-is-removed-only-once-its-work-is-out.md) | todo | - |
| [02 - Only a machine ahpd made is judged as made under bind](task-02-only-a-machine-ahpd-made-is-judged.md) | todo | - |
| [03 - The clash check names what the runtime mounts](task-03-the-clash-check-names-what-the-runtime-mounts.md) | todo | - |
| [04 - Pushing trust needs trust:write](task-04-pushing-trust-needs-trust-write.md) | todo | - |
| [05 - The approve-everything key is declared](task-05-the-approve-everything-key-is-declared.md) | todo | - |
| [06 - Leaving a machine clears the nested record](task-06-leaving-a-machine-clears-the-nested-record.md) | todo | - |
| [07 - A preset can turn the sandbox off, and two small fixes](task-07-a-preset-can-turn-the-sandbox-off.md) | todo | - |
| [08 - Docs](task-08-docs.md) | todo | 01-07 |

## Risks and tradeoffs

- Starting a stopped machine to empty it runs its entrypoint again. A machine that cannot start is kept and named, so nothing is lost.
- A role an operator wrote without `trust:write` makes its sessions untrusted after the upgrade. The docs say so.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-machine-is-removed-only-once-its-work-is-out.md](task-01-a-machine-is-removed-only-once-its-work-is-out.md).
- **Open questions:** none.
- **Watch out for:** `ran` resolves on every exit; read `code` and `stderr`, not only `stdout`.

## Final verification checklist

- [ ] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` from the root pass, every package.
- [ ] The real-Docker cases in `computer-git-fetch.test.ts` ran, not skipped.
- [ ] `plans/index.md` updated.
