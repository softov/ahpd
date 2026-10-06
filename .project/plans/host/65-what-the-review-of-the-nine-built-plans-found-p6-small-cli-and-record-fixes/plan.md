---
title: Each verb takes only what it reads, and the records name the right things
domain: host
status: built
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
  - plans/daemon/15-a-verb-declares-only-its-own-flags/plan.md
  - plans/daemon/12-a-plugin-option-is-set-from-the-command-line/plan.md
  - plans/host/48-host-is-split-by-area-p10-action-dispatch/plan.md
refs:
  - "[code://packages/server/src/commands/options.ts#L490-L495](../../../../packages/server/src/commands/options.ts#L490-L495) - `userAt`, with `host` and `port`"
  - "[code://packages/server/src/commands/user.ts#L104](../../../../packages/server/src/commands/user.ts#L104) - every `user` verb takes `userAt`"
  - "[code://packages/server/src/commands/user.ts#L227](../../../../packages/server/src/commands/user.ts#L227) - the one read of `host` and `port`, `user token --url`"
  - "[code://packages/server/src/commands/vault.ts#L139-L141](../../../../packages/server/src/commands/vault.ts#L139-L141) - every vault verb takes `vaultAt`"
  - "[code://packages/server/src/commands/options.ts#L231-L247](../../../../packages/server/src/commands/options.ts#L231-L247) - `setAt`"
  - "[code://packages/sdk/src/vault.ts#L62-L68](../../../../packages/sdk/src/vault.ts#L62-L68) - `secretRef`"
  - "[code://packages/sdk/src/host/actions.ts#L31-L40](../../../../packages/sdk/src/host/actions.ts#L31-L40) - `createActions` destructures `ctx`"
  - "[code://packages/server/test/server-commands.test.ts#L607-L633](../../../../packages/server/test/server-commands.test.ts#L607-L633) - the flag test, which pins `--host` and `--port` on four verbs"
---

## Goal

Every `user` verb but `user token` refuses `--host` and `--port`, `vault set` and `vault delete` refuse `--config-file`, a `--plugin-option` path refuses without printing a value, never sets inside a `$secret` reference and reads only keys the options hold.
`createActions` holds no stale copy of host state, and the plan records the review found wrong name the right commits, functions and next actions.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "where\.(host|port)|personalUrl" packages/server/src/commands/user.ts` - one read, `user token` at 227.
- `rg -nw "advancedTools|contributed|contributing|restartNeeded" packages/sdk/src/host/actions.ts` - destructured at 35-37 and read nowhere bare; every read and write is `ctx.<name>`.
- `rg -n "onDue" .project/plans` - host/44 p2 task 02's ref names `onDue` at `automations.ts:233`, where the function is `due`.

### Gaps

- daemon/15's test asserts the wrong flags on `user list`, `rm`, `member`, `primary` (findings H1).
- daemon/15's `implemented.md` says taking `--config-file` off `vault set` and `delete` needs a behaviour change; it is a declaration (H2).
- daemon/12's refusal quotes the value it ran into, which may be a secret (I1).

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `--host` and `--port` are `user token`'s alone | daemon/15's own rule, "a verb declares only the flags it reads"; the review | 01 |
| `vault set` and `vault delete` do not declare `--config-file` | the same rule; `(defaulted: refusing over honouring, since neither verb reads a configuration)` | 02 |
| A `--plugin-option` path names the key it stopped at, reads own keys only, and refuses a step into a `$secret` reference | the review, daemon/12 | 03 |

## Proposed architecture

- **Layer responsibilities** - server: 01-03 · sdk: 04 · `.project`: 05.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Only user token takes --host and --port](task-01-only-user-token-takes-host-and-port.md) | done | - |
| [02 - vault set and delete refuse --config-file](task-02-vault-set-and-delete-refuse-config-file.md) | done | - |
| [03 - A plugin option path refuses by key, own keys only, never into a secret](task-03-a-plugin-option-path-refuses-by-key.md) | done | - |
| [04 - Action dispatch reads host state through ctx](task-04-action-dispatch-reads-host-state-through-ctx.md) | done | - |
| [05 - The reviewed plans' records name the right things](task-05-the-reviewed-plans-records-name-the-right-things.md) | done | - |

## Risks and tradeoffs

- Tasks 01 and 02 refuse a flag a script may pass today; each was read by nothing, and the refusal names it.
- Task 04 has no behaviour to fail first: the stale bindings are read by nothing today. It is there so the next reader cannot read one.

## Resume state

- **Done so far:** all five tasks. 01-03 each with a case failing first and passing after; 04 as the plan's Risks says, by the grep alone; 05 with both validation greps. [implemented.md](implemented.md) is written.
- **Next action:** Softov's review. Nothing is left to build.
- **Open questions:** none.
- **Watch out for:** task 05 edits other plans' records; it changes no task status, which waits on host/65's review.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after, task 04 and 05 excepted.
- [ ] `pnpm exec vitest run packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts` passes.
- [ ] `plans/index.md` updated.
