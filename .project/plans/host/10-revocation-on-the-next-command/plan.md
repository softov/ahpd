---
title: A role is read on every command
domain: host
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/06-users-and-permissions/plan.md
changes: []
creates: []
decisions:
  - decisions/a-role-is-read-on-every-command.md
refs:
  - "[code://packages/sdk/src/users.ts#L177-L205](../../../../packages/sdk/src/users.ts#L177-L205) - `principalOf`, frozen at verification and now resolved per question"
  - "[code://packages/sdk/src/types/users.ts#L34-L60](../../../../packages/sdk/src/types/users.ts#L34-L60) - `Principal`, which gains `standing`"
  - "[code://packages/sdk/src/host.ts#L7553-L7580](../../../../packages/sdk/src/host.ts#L7553-L7580) - the command gate"
  - "[code://packages/sdk/src/host.ts#L6346-L6365](../../../../packages/sdk/src/host.ts#L6346-L6365) - the dispatch gate"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the prose that already claimed this"
---

## Goal

Editing the user file takes effect on the next command: a person who has been removed is told to sign in again, and a person whose roles changed may do what the file says now rather than what it said when they signed in.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "principalOf|grantsOf" packages/sdk/src/users.ts` - one place makes a principal and one place resolves roles, so the change is bounded to them.
- `rg -n "connection.principal" packages/sdk/src/host.ts` - two gates, `authenticate` and the expiry path; only the gates decide anything from it per command.
- `rg -n "next command" docs .project` - the page claimed it; the deferred row in `host/07` said it was not done.

### Runtime path

```
any command -> the gate -> connection.principal.standing()  false -> -32007
                        -> connection.principal.can(grant)  false -> -32009
                        -> the handler
```

### Gaps

- `principalOf` computed the grants once, so the file was read at sign-in and never again for that person.
- The gate had no way to tell "no longer a person" from "role does not cover it", which is why the two answer different codes.
- `Not found: a per-command credential check - searched "verify(" in packages/sdk/src/host.ts; there is one call, in `authenticate`, and this plan does not add another.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A role is read on every command, not once at sign-in](../../../decisions/a-role-is-read-on-every-command.md) | The user, 2026-09-23: named this deferred item as the next thing to do, after the page was found to describe a behaviour the code did not have. |

| What | Source | Task |
| --- | --- | --- |
| Removal refuses `-32007`, a role that does not cover it refuses `-32009` | decision 1 | 01 |
| A principal built without `standing` is still standing | decision 1 | 01 |
| Root is unaffected | decision 1 | 01 |

## Proposed architecture

- **Data flow** - `principalOf` returns a principal that reads the file: `standing` looks for the record's id and `can` resolves its roles as they are now. Both gates ask `standing` and then `can`.
- **Event flow** - unchanged. Nothing is raised when a role moves; a client learns from the refusal, the way it learns about any other denial.
- **State flow** - nothing is cached. The file is the state, which is what the directory's own comment already promised.
- **Layer responsibilities** - packages/sdk: `Principal.standing`, the live resolution and the two gates · docs: the removal paragraph · test/: the gate cases.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The gate asks the file again](task-01-the-gate-asks-the-file-again.md) | done | - |

## Risks and tradeoffs

- A file read per grant question. The mitigation is that the file is small, the read is synchronous and the host already re-reads it for every other question the directory answers.
- A role that nothing defines now resolves to nothing on every command instead of being reported. The mitigation is that it is still reported once, when the principal is made.
- Two questions in each gate that can drift apart. The mitigation is one comment at each saying which code belongs to which question.

## Resume state

- **Done so far:** the task, 2026-09-23. The gate asks the file again, removal answers `-32007` and a changed role answers `-32009`. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Is the credential checked again too? - answered by decision 1: no, the roles are; the credential is deliberately not kept.
- **Watch out for:** `standing` is optional on purpose, so a principal built by hand answers yes. Making it required would break every test that builds one.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] A removed person is refused `-32007` on the next command and not on the next connection.
- [x] A changed role is in force on the next command.
- [x] A directory with no file is unaffected, and root is unaffected.
- [x] `plans/index.md`, `docs/USERS.md` and `HANDOFF.md` updated.
