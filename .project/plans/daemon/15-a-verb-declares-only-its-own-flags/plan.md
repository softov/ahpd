---
title: A verb declares only the flags it reads
domain: daemon
status: planned
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
refs:
  - "[code://packages/server/src/commands/options.ts#L468-L488](../../../../packages/server/src/commands/options.ts#L468-L488) - `userFields`: where the user file is, plus `issuer`, `role` and `url`, which only `user add` and `user token` read"
  - "[code://packages/server/src/commands/options.ts#L529-L537](../../../../packages/server/src/commands/options.ts#L529-L537) - `teamFields`: where the file is, plus `title`, which only `add` reads"
  - "[code://packages/server/src/commands/options.ts#L559-L563](../../../../packages/server/src/commands/options.ts#L559-L563) - `servedUserFields`, the same three over `/api`"
  - "[code://packages/server/src/commands/options.ts#L429](../../../../packages/server/src/commands/options.ts#L429) - `flagFields`, every daemon flag, which the vault verbs take on a line"
  - "[code://packages/server/src/commands/user.ts#L188-L210](../../../../packages/server/src/commands/user.ts#L188-L210) - `user rm` and `user token`, spreading `fields`"
  - "[code://packages/server/src/commands/teams.ts#L43-L90](../../../../packages/server/src/commands/teams.ts#L43-L90) - the team and project verbs, spreading `fields`"
  - "[code://packages/server/src/commands/vault.ts#L140-L201](../../../../packages/server/src/commands/vault.ts#L140-L201) - the vault verbs, spreading `flagFields`"
---

## Goal

Each `user`, `team`, `project` and `vault` verb declares only the flags it reads, so its help, its `/api` form and `/api/cli-manifest` offer nothing it ignores.
Today `user rm` takes `--issuer`, `--role` and `--url`, `team rm` takes `--title`, and `vault delete` takes every daemon flag.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "\.\.\.fields" packages/server/src/commands` - `user.ts` 192, 210, 239; `teams.ts` 62, 83; `vault.ts` 148, 184.
- `rg -n "flagFields" packages/server/src/commands` - `config.ts`, `proxy.ts` and `vault.ts`; only the vault verbs are in scope here.

### Runtime path

```
registry.action({ input: { ...fields, id } }) -> manifestFrom -> /api/cli-manifest -> the form draws every field
```

### Gaps

- One field set per subject mixes where the file is with flags of single verbs.
- Nothing checks that a declared field is read.

## Decisions locked in

No decision file: this is a fix.

| What | Source | Task |
| --- | --- | --- |
| Each verb declares only the fields it reads; where the file is stays a shared set every verb of that subject spreads | Softov, 2026-10-06, asked why `user rm` takes `issuer`, `role` and `url`, and chose to split the fields now and declare `effect` and `resource` after cofold ships them | 01, 02, 03 |
| Declaring `effect` and `resource` on ahpd's commands is a later plan, after the cofold release that adds them | same answer | - |

## Proposed architecture

- **Data flow** - `options.ts` gets a location set per subject (`userAt`, `teamAt`, and the vault's), and each verb spreads it plus its own fields; the served sets follow the same split.
- **Layer responsibilities** - server `commands/options.ts`: the sets · `commands/user.ts`, `teams.ts`, `vault.ts`: what each verb spreads.
- **Source-of-truth files** - [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The user verbs declare their own flags](task-01-the-user-verbs-declare-their-own-flags.md) | todo | - |
| [02 - The team and project verbs declare their own flags](task-02-the-team-and-project-verbs-declare-their-own-flags.md) | todo | - |
| [03 - The vault verbs declare their own flags](task-03-the-vault-verbs-declare-their-own-flags.md) | todo | - |

## Risks and tradeoffs

- A script that passed an ignored flag, such as `ahpd user rm bob --role admin`, is now refused as an unknown flag; nothing it did changes, and the refusal names the flag.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-user-verbs-declare-their-own-flags.md](task-01-the-user-verbs-declare-their-own-flags.md); the three tasks are independent.
- **Open questions:** none.
- **Watch out for:** the served (`/api`) sets leave the file and the address out on purpose, so a request cannot name another file; keep that when splitting.

## Final verification checklist

- [ ] `/api/cli-manifest` shows `user rm` with `id` alone, and the line form with the location flags alone.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build` green.
- [ ] `plans/index.md` updated.
