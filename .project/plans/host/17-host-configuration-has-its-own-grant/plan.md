---
title: Host configuration has its own grant
domain: host
status: built
priority: medium
created: 2026-09-25
revalidated: 2026-09-25
requires:
  - plans/host/11-a-grant-is-a-subject-and-a-verb/plan.md
changes: []
creates: []
decisions:
  - decisions/host-wide-root-settings-need-config-write.md
refs:
  - "[code://packages/sdk/src/host.ts#L271-L281](../../../../packages/sdk/src/host.ts#L271-L281) - `dispatchNeeds`, which gated the root as `file:write` by channel alone"
  - "[code://packages/sdk/src/host.ts#L6846](../../../../packages/sdk/src/host.ts#L6846) - the dispatch gate in `applyDispatch`"
  - "[code://packages/sdk/src/users.ts#L22-L35](../../../../packages/sdk/src/users.ts#L22-L35) - the built-in roles and `SUBJECTS`"
  - "[code://test/users-gate.test.ts](../../../../test/users-gate.test.ts) - the gate's tests"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostRootConfigForwarder.ts - what VS Code pushes on connect
---

## Goal

Changing a root setting that every session reads needs its own grant, `config:write`, instead of `file:write`, and a person's own `defaultShell` needs only a sign-in.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rn "RootConfigChanged" /github/externals/vscode/src/vs` - VS Code dispatches root config from its settings UI (one key, or a `replace` of every schema key) and from forwarders that push only keys the host's schema lists; for this host that is `defaultShell` alone.
- `grep -rn "file:write" docs packages/*/src` - the only statement of the old rule was in `docs/USERS.md`.

### Gaps

- `dispatchNeeds` read the channel only, so it could not tell a person's key from the host's.
- No subject named host configuration.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A host-wide root setting needs config:write, and a person's own needs only a sign-in](../../../decisions/host-wide-root-settings-need-config-write.md) | The user, 2026-09-25: "do 8. **A capability for host configuration.**" |

| What | Source | Task |
| --- | --- | --- |
| A key not in `PER_CONNECTION` needs `config:write` whether or not the schema names it | decision 1 | 01 |
| `replace` needs `config:write` | decision 1 | 01 |
| A host with no users directory refuses nothing, as before | `the-door-is-a-door` | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The root gate reads the action](task-01-the-root-gate-reads-the-action.md) | done | - |

## Risks and tradeoffs

- A deployment whose members changed host settings loses that on upgrade. The refusal names `config:write`, and `docs/USERS.md` says how to grant it.
- A new per-person key must be added to `PER_CONNECTION` or it is gated as host-wide. That is the safe direction.

## Resume state

- **Done so far:** task 01, 2026-09-25. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:** none.
- **Watch out for:** `GATE.dispatchNeeds` now returns `undefined` for "sign-in only"; a caller that treats `undefined` as "ungated" would let an anonymous connection through. The gate checks the principal before the grant.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] `test/users-gate.test.ts` - the classification, a member refused a host key and allowed its shell, a guest allowed its shell, `config:write` allowed, nobody signed in refused.
- [x] `plans/index.md`, `docs/USERS.md` and `working/HANDOFF.md` updated.
