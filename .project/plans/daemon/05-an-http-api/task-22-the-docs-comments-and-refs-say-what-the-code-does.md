---
title: The docs, comments and task refs for the API say what the code does
status: done
depends: [task-17-a-caller-gives-only-what-it-holds.md, task-18-the-guards-have-no-gaps.md, task-19-the-tests-prove-their-validation.md, task-20-served-config-reads-the-daemons-file-or-says-it-is-gone.md, task-21-npm-runs-without-holding-the-daemon.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L449-L453](../../../../docs/DAEMON.md#L449-L453) - the served-commands paragraph: the daemon's own options, and the fields absent from the manifest"
  - "[code://docs/USERS.md#L371](../../../../docs/USERS.md#L371) - `users` listed with a `read` verb no command uses"
  - "[code://packages/server/src/commands/registry.ts#L62-L65](../../../../packages/server/src/commands/registry.ts#L62-L65) - the cache comment, citing `remote-reads-its-token-from-a-file-too`"
  - "[code://packages/server/src/commands/options.ts#L246-L250](../../../../packages/server/src/commands/options.ts#L246-L250) - `servedUserFields`, citing `the-user-commands-need-users-write` for why paths are absent"
---

## Objective

`docs/DAEMON.md` and `docs/USERS.md` describe the served commands and the `users` grants as they are after tasks 17 to 21, no comment cites a decision that does not say what the comment claims, and every ref in tasks 07 to 21 names the lines it describes.

## Files

- `UPDATE: docs/DAEMON.md:449-453` - the served commands' fields.
- `UPDATE: docs/DAEMON.md` - the scope table: `users:write` gives and removes only what the caller holds.
- `UPDATE: docs/DAEMON.md:409-410` - served `config` masks each plugin option value as well as `connectionToken`.
- `UPDATE: docs/USERS.md:371` - the `users` row.
- `UPDATE: packages/server/src/commands/registry.ts:62-65`, `packages/server/src/commands/options.ts:246-250` - the cited decisions.
- `UPDATE: task-07` to `task-21` in this folder - refs.

## Steps

1. DAEMON.md: served `status` and `config` take no fields, and `configFile`, `users`, `plugins` and `paths` are absent from every served command; say so where the paragraph now says "the same flags".
2. DAEMON.md and USERS.md: `users` has one verb in use, `write`, and it is bounded by what the caller holds, per [a-caller-gives-only-the-grants-it-holds](../../../decisions/a-caller-gives-only-the-grants-it-holds.md). Drop `read` from the row, or say no command needs it yet.
3. DAEMON.md's served `config` sentence: `connectionToken` and every plugin option value are reported as `<set>`, per [the-config-command-hides-its-secrets](../../../decisions/the-config-command-hides-its-secrets.md).
4. `registry.ts`: the private cache is Softov's call recorded in the plan's second table ("The `--remote` manifest cache is per user, mode 0700"), not the token-file decision; cite nothing or cite the plan row's rationale in the comment's own words.
5. `options.ts`: the served fields leave the paths out because a served command acts on the daemon's own options (the plan's task 08 row); change the cited decision to that reason.
6. Refs in tasks 07 to 21: the review found task 07 (`http.ts` `guarded`, `pathOf`, `run.ts`, test), task 08 (`scopes.ts` hook at 34-43, test 452-515), task 09 (test), task 10 (`run.ts`, `authorize.ts` 59-85, test), task 11 (`run.ts`, test) and task 12 (`options.ts`, `run.ts`, test) wrong. Move each and check the rest.
7. Prose one sentence per line where the file is already written that way; match the file where it is wrapped.

## Validation

- Each claim in the touched paragraphs checked against the code by reading it.
- Every `code://...#L<n>-L<m>` in tasks 07 to 21 opens on the lines its note names.
- Every relative link in the touched files resolves; no em dash added.

## Resume

Every claim in the touched paragraphs was checked against the code: `config.ts` takes no `input` when it is served and neither does `status.ts`, `servedUserFields` holds `issuer`, `role` and `url`, `servedPluginWriteFields` holds `noEnable` and `keep`, all four `user` verbs declare `users:write` and task 17 bounds them, a served install answers `restart: true`, and `withoutSecrets` masks the token and every plugin option value.

Changed: `DAEMON.md`'s grant table and the paragraph under it gained the `users:write` bound and the served install's `restart: true`; its `config` sentence says `connectionToken` and every plugin option value are reported as present and never as what they are; its `--remote` paragraph dropped "flags" and now says a served `status` and `config` take no fields. `USERS.md`'s `users` row says write is bounded by what the caller holds and that no command needs `read` yet. The `remoteCache` comment cites no decision, and the `servedUserFields` comment gives its reason in its own words. No relative link in the touched files is broken and no em dash was added.

Refs: all 65 `code://` refs in tasks 07 to 21 were re-checked against the tree and every stale one re-pointed, including the two docs refs, which were measured last.
