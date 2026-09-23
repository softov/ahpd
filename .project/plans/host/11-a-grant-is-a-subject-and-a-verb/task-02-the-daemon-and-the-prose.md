---
title: The daemon and the prose
status: done
depends:
  - task-01-the-grammar-the-matcher-and-the-gate.md
layer: packages/server
refs:
  - "[code://packages/server/src/main.ts#L477-L505](../../../../packages/server/src/main.ts#L477-L505) - the `user` verbs"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the roles section, which is the grammar"
  - "[code://.project/working/HANDOFF.md](../../../working/HANDOFF.md) - the constraint about a capability being scoped by scheme"
---

## Objective

`ahpd user add` defaults to `guest`, refuses a role nothing defines with the verb's own sentence, and `ahpd user list` prints what each role resolved to. The page describes the grammar rather than the six names.

## Files

- `UPDATE: packages/server/src/main.ts` - the `guest` default, the refusal caught and said as the verb's own, and the grants in `user list`.
- `UPDATE: docs/USERS.md` - the grammar, the subject table, the built-ins, the worked example, and the dispatch paragraph.
- `UPDATE: .project/plans/index.md`, `.project/plans/host/00-host.md`, `HANDOFF.md` - the plan, and the constraint that said a capability is scoped by scheme.

## Steps

1. Default `--role` to `guest`, and say so in the line that prints what was added.
2. Catch the directory's refusal in `add` and pass it to `stop`, so an unknown role reads as the verb refusing rather than a stack trace.
3. Print `id (roles) grants` in `user list`, and say `(no roles)` and `nothing` rather than an empty column.
4. Rewrite the roles section of `docs/USERS.md`: the grammar, the subject and verb table, the built-ins, the wildcard, and the scheme rule.
5. Correct the handoff's constraint about capabilities, and add the plan's row.

## Validation

- By hand: `ahpd user add normal` adds a `guest`, `ahpd user list` prints its two grants, and a made-up role is refused with the roles this host has.
- By hand: a daemon with that directory, connected with the guest's own token, lists sessions and automations and is refused a file read, a shell, a session write and an automation write.
- `plans/index.md` has the row; every link resolves.

## Resume

Done 2026-09-23.
`user add` defaults to `guest` and catches the directory's refusal; `user list` prints the resolved grants; `docs/USERS.md` describes the grammar with the subject table and the worked example.
Verified by hand against a daemon with a `guest`: sessions and automations listed, and a file read, a terminal, a session write and an automation write each refused with the grant named.
