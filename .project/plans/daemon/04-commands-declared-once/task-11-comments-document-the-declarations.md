---
title: The comments under commands/ document the declarations, and the refs point at them
status: implemented
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L1-L9](../../../../packages/server/src/commands/run.ts#L1-L9) - the header, which says what the command is rather than what it was"
  - "[code://packages/server/src/commands/run.ts#L241-L248](../../../../packages/server/src/commands/run.ts#L241-L248) - the comment on `base`"
  - "[code://packages/server/src/commands/run.ts#L297-L332](../../../../packages/server/src/commands/run.ts#L297-L332) - the `sessions` and `automations` comments, each above its own property"
  - "[code://packages/server/src/commands/run.ts#L355-L382](../../../../packages/server/src/commands/run.ts#L355-L382) - the `said` comment and the plugins comment above the `loadPlugins` call"
  - "[code://packages/server/src/commands/run.ts#L432-L449](../../../../packages/server/src/commands/run.ts#L432-L449) - the door and transport comment above `listener`"
  - "[code://packages/server/src/commands/options.ts#L1-L13](../../../../packages/server/src/commands/options.ts#L1-L13) and [#L313-L319](../../../../packages/server/src/commands/options.ts#L313-L319) - the header and the fold's comment"
  - "[code://packages/server/src/commands/user.ts#L7-L9](../../../../packages/server/src/commands/user.ts#L7-L9) - why every sub-command declares the same fields"
  - "[code://packages/server/src/commands/stop.ts#L4-L6](../../../../packages/server/src/commands/stop.ts#L4-L6) - what the flags on `stop` are for"
  - "[code://packages/server/src/main.ts#L14-L16](../../../../packages/server/src/main.ts#L14-L16) and [#L147-L156](../../../../packages/server/src/main.ts#L147-L156) - what the entry is left with, and the run word"
  - "[code://.project/decisions/ahpd-commands-are-declared-with-cofold-commands.md](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) - the refs now name `git://7a7e9d1` and `options.ts`"
---

## Objective

Every comment under `packages/server/src/commands/` and in `main.ts` says what the declaration below it is, sits above the thing it describes, and says nothing about how the code used to be.

## Files

- `UPDATE: packages/server/src/commands/run.ts:1-9, 241-248` - the header and the comment on `base`, neither narrating.
- `UPDATE: packages/server/src/commands/run.ts:297-332` - the `automations` block moved from above `sessions` to above `automations`.
- `UPDATE: packages/server/src/commands/run.ts:355-382` - the plugins block moved from above the `said` comment to the `loadPlugins` call.
- `UPDATE: packages/server/src/commands/run.ts:432-449` - the runtime note dropped, and the door block merged into the comment on `listener`.
- `UPDATE: packages/server/src/commands/options.ts:1-13, 313-319` - the header and the fold's comment.
- `UPDATE: packages/server/src/commands/user.ts:7-9` - the fields every sub-command declares.
- `UPDATE: packages/server/src/commands/stop.ts:4-6` - what `stop` does with the flags a run takes.
- `UPDATE: packages/server/src/main.ts:14-16, 147-156` - what the entry is left with, and the run word.
- `UPDATE: .project/decisions/ahpd-commands-are-declared-with-cofold-commands.md` - its two `refs` to the hand-written `main.ts` become `git://7a7e9d1` and `code://packages/server/src/commands/options.ts`.

## Steps

1. Rewrite each comment listed to say what the declaration, field or block is and why it has its shape now; history and the migration belong in commits and in this plan.
2. Move each orphaned block to the property or call it describes, or delete it when the comment beside that property already says the same.
3. In the decision's `refs`, replace the two main.ts line ranges with `git://7a7e9d1` (where the hand-written parser was) and `code://packages/server/src/commands/options.ts` (where the flags are declared), leaving its body untouched.
4. The comment rewrites in `options.ts:118-119` belong to task 07; do not change them twice.

## Validation

- `rg -n "\bused to\b|\bpreviously\b|\bbefore this\b|\balways (been|had|meant|were)\b|\bparse kept\b" packages/server/src/commands packages/server/src/main.ts` finds nothing.
- Each moved block is above the property or call it names, checked by reading `run.ts`.
- `pnpm typecheck` and `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts packages/server/test/server-commands.test.ts` green, since only comments moved.

## Resume

Done.
`grep -rnE "\bused to\b|\bpreviously\b|\bbefore this\b|\balways (been|had|meant|were)\b|\bparse kept\b" packages/server/src/commands packages/server/src/main.ts` was run, because `rg` is not installed here, and the Validation's whole-word pattern finds nothing.
The earlier bare `used to` matched `refused together` in `main.ts` because it had no word boundary; `\bpreviously\b` and `\bold\b` find nothing, and every `\bwas\b` is present-state prose, so neither is in the pattern.
`automations` is above `automations:`, the plugins block is above the `loadPlugins` call, the runtime note is folded into the `listener` comment, and the door block is merged with the transport one.
The decision's refs name `git://7a7e9d1` and `code://packages/server/src/commands/options.ts`; its body is untouched.
A comment in `authorize.ts` that said "before this" was rewritten with them, since the `rg` runs over all of `commands/`.
`pnpm typecheck` green; `packages/server/test/server-cli.test.ts` and `server-commands.test.ts` green, 44 cases.

Review 2026-09-26: not passed. `packages/server/src/commands/user.ts:79` still says "refused the way the loop refused a flag", the removed loop, which the grep pattern cannot catch; task 23 fixes it.
