---
title: A role editor offers trust and proxy, the two subjects the gate asks for and does not advertise
domain: host
status: planned
priority: medium
created: 2026-10-07
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions:
  - decisions/pushing-workspace-trust-needs-trust-write.md
refs:
  - "[code://packages/sdk/src/users.ts#L111-L173](../../../../packages/sdk/src/users.ts#L111-L173) - `OPERATIONS`, which has no `trust` and no `proxy` entry"
  - "[code://packages/sdk/src/users.ts#L30](../../../../packages/sdk/src/users.ts#L30) - the built-in member role, which holds `proxy:read`, `proxy:write` and `trust:write`"
  - "[code://packages/sdk/src/host/root.ts#L305-L331](../../../../packages/sdk/src/host/root.ts#L305-L331) - `advertisedGrants`, read off `OPERATIONS` and the registered schemes"
  - "[code://packages/sdk/src/host/gate.ts#L272-L278](../../../../packages/sdk/src/host/gate.ts#L272-L278) - a `workspaceTrust` push asks for `trust:write`"
  - "[code://packages/server/src/proxy/listener.ts#L462](../../../../packages/server/src/proxy/listener.ts#L462) - a model call asks for `proxy:write`"
  - "[code://packages/server/src/proxy/listener.ts#L614](../../../../packages/server/src/proxy/listener.ts#L614) - the model list asks for `proxy:read`"
  - "[code://packages/sdk/test/users-host.test.ts#L369](../../../../packages/sdk/test/users-host.test.ts#L369) - the test that the advertisement covers every gated subject"
---

## Goal

A client's role editor shows `trust` and `proxy`, so an operator can give a custom role `trust:write`, `proxy:read` or `proxy:write`.

## Reconnaissance

### Searches performed

- 2026-10-07: the gate asks for `trust:write`, `proxy:read` and `proxy:write`. `OPERATIONS` holds neither subject, and no resource provider is registered under either name.
- `advertisedGrants` lists `OPERATIONS` and the registered schemes only, so neither subject reaches a client.
- `grantProblem` takes any operation word on a subject outside `OPERATIONS`, so a role file can name them today. Only an editor that draws from the advertisement cannot.
- Softov looked for `trust:write` in ahpapp's role editor on 2026-10-07 and did not find it.

### Runtime path

```
OPERATIONS -> advertisedGrants -> handshake and root state `ahpd.grants` -> client role editor
```

### Gaps

- `Not found: trust or proxy in OPERATIONS - searched packages/sdk/src/users.ts`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [Pushing workspaceTrust needs trust:write, and the member role has it](../../../decisions/pushing-workspace-trust-needs-trust-write.md) | Softov, 2026-10-07 |

| What | Source | Task |
| --- | --- | --- |
| Add `trust` and `proxy` to the advertisement | Softov, 2026-10-07, chose "Plan both", which named "add `trust` (and check `proxy`) to the role editor's operations list" | 01 |
| `trust` has one operation, `push`, in the write group | (defaulted: pushing the list is the one act the gate asks about) | 01 |
| `proxy` has `models` in the read group and `call` in the write group | (defaulted: the two acts the listener asks about) | 01 |
| The gate keeps asking for the groups, `trust:write`, `proxy:read` and `proxy:write` | (defaulted: no role or test changes meaning) | 01 |

## Proposed architecture

- **State flow** - two entries in `OPERATIONS`. `advertisedGrants` and `grantProblem` read them with no change.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - trust and proxy are in the operations table](task-01-trust-and-proxy-are-in-the-operations-table.md) | todo | - |

## Risks and tradeoffs

- A role file that names an operation word on `trust` or `proxy` other than the new ones becomes invalid. None of the built-in roles does.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-trust-and-proxy-are-in-the-operations-table.md](task-01-trust-and-proxy-are-in-the-operations-table.md).
- **Open questions:** none.
- **Watch out for:** the comment at `root.ts` says "Eight subjects"; correct the count.

## Final verification checklist

- [ ] A test: the advertisement holds `trust` and `proxy` with their operations and groups.
- [ ] A test: a role with `trust:write` may push `workspaceTrust`, and one without it may not.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [ ] `plans/index.md` updated.
