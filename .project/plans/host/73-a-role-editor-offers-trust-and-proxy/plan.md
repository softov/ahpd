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
  - "[code://packages/sdk/src/users.ts#L111-L189](../../../../packages/sdk/src/users.ts#L111-L189) - `OPERATIONS`, the table the advertisement and `grantProblem` read"
  - "[code://packages/sdk/src/users.ts#L30](../../../../packages/sdk/src/users.ts#L30) - the built-in member role, which holds `proxy:read`, `proxy:write` and `trust:write`"
  - "[code://packages/sdk/src/host/root.ts#L305-L331](../../../../packages/sdk/src/host/root.ts#L305-L331) - `advertisedGrants`, read off `OPERATIONS` and the registered schemes"
  - "[code://packages/sdk/src/host/gate.ts#L271-L280](../../../../packages/sdk/src/host/gate.ts#L271-L280) - `dispatchNeeds`, where a dispatch's grant is decided"
  - "[code://packages/server/src/proxy/listener.ts#L462](../../../../packages/server/src/proxy/listener.ts#L462) - where a proxy call is held to its grant"
  - "[code://packages/server/src/proxy/listener.ts#L614](../../../../packages/server/src/proxy/listener.ts#L614) - where the model list is held to its grant"
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
| The gate asks for the operation, and the group covers it: `trust:push`, `proxy:call`, `proxy:models` | Softov, 2026-10-07, asked whether the gate asks for the operation or the editor offers groups only, answered "Gate asks the operation" | 01 |

## Proposed architecture

- **State flow** - two entries in `OPERATIONS`. `advertisedGrants` and `grantProblem` read them with no change.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - trust and proxy are in the operations table](task-01-trust-and-proxy-are-in-the-operations-table.md) | implemented | - |

## Risks and tradeoffs

- A role file that names an operation word on `trust` or `proxy` other than the new ones becomes invalid. None of the built-in roles does.
- The built-in roles are unchanged. `member` holds the groups that cover every operation the gate asks for, and `admin` holds `*:*`.

## Resume state

- **Done so far:** task 01 implemented 2026-10-07. `OPERATIONS` holds `trust` and `proxy`, the advertisement carries them, the page documents them, and every gate passes. A review then found that the gate still asked for the groups, so a role holding only `trust:push` could not push. Softov answered the fork, and the gate asks the operation now.
- **Next action:** none. Every task is implemented; the plan is ready to close.
- **Open questions:** none.
- **Watch out for:** the comment at `root.ts` now says "Ten subjects". `docs/USERS.md` was not in the task's *Files* and had to move, and task 01's *Resume* explains why. The *Resume* also records the review fix and the two further pages that moved with it.

## Final verification checklist

- [x] A test: the advertisement holds `trust` and `proxy` with their operations and groups. `users-host.test.ts`, "advertises trust and proxy, which the gate asks about through no method".
- [x] A test: the gate asks the operation. `users-gate-dispatch.test.ts`, "classifies a dispatch by its action, with the channel beside it".
- [x] The same file: "accepts a workspaceTrust push from a role holding only trust:push", and "refuses a workspaceTrust push from a role holding only trust:get".
- [x] A test: the group still covers the operation. `users-gate-dispatch.test.ts`, "accepts a workspaceTrust push from a member" and "keeps the trust a connection had when a push is refused".
- [x] A test: a role with no trust grant is still refused. `users-gate-dispatch.test.ts`, "refuses a workspaceTrust push from a role holding no trust grant".
- [x] A test: the built-in roles are unchanged. `users.test.ts` holds them, and `proxy-listener.test.ts` serves the call to the built-in `member` and `admin`.
- [x] A test: only `proxy:call` may call. `proxy-listener.test.ts`, "calls for a role holding only proxy:call, and refuses a list to it".
- [x] A test: only `proxy:models` may list. `proxy-listener.test.ts`, "lists for a role holding only proxy:models, and refuses a call to it".
- [x] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [x] `plans/index.md` updated.
