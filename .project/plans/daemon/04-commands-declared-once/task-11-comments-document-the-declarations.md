---
title: The comments under commands/ document the declarations, and the refs point at them
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - comment blocks carried over from the old main.ts, some above the wrong property"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - comments that describe the old parser"
  - "[code://.project/decisions/ahpd-commands-are-declared-with-cofold-commands.md](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) - refs to line ranges of main.ts that no longer exist"
---

## Objective

Every comment under `packages/server/src/commands/` and in `main.ts` says what the declaration below it is, sits above the thing it describes, and says nothing about how the code used to be.

## Files

- `UPDATE: packages/server/src/commands/run.ts:1-9` - the header narrates ("has always meant", "nothing a person sees moves").
- `UPDATE: packages/server/src/commands/run.ts:224-237` - "Automations, with a clock" sits above `sessions`; move it to `automations`.
- `UPDATE: packages/server/src/commands/run.ts:282-292` - "The plugins, between the base and the host" is orphaned above "What plugins asked to have said"; move it to the `loadPlugins` call.
- `UPDATE: packages/server/src/commands/run.ts:340-342` - "Whichever runtime this is" sits above the wire tap; move it to the `listen` call or drop it.
- `UPDATE: packages/server/src/commands/run.ts:362-371` - "The door, and what a token presented at it means" is orphaned above "Which transport"; merge it into the comment on `listener`.
- `UPDATE: packages/server/src/commands/run.ts:171` - "the literal it has always been".
- `UPDATE: packages/server/src/commands/options.ts:5-7` and `:267-268` - "What `parse` used to do by hand", "The order is the one `parse` kept".
- `UPDATE: packages/server/src/commands/user.ts:7-9` - "the flags were read out of the whole line before this".
- `UPDATE: packages/server/src/commands/stop.ts:6` - "the way they always were".
- `UPDATE: packages/server/src/main.ts:15`, `:78`, `:107-108` - "has always had", "have always been on", "has always been what no verb means".
- `UPDATE: .project/decisions/ahpd-commands-are-declared-with-cofold-commands.md` - its two `refs` to `main.ts#L255-L310` and `#L430-L660`.

## Steps

1. Rewrite each comment listed to say what the declaration, field or block is and why it has its shape now; history and the migration belong in commits and in this plan.
2. Move each orphaned block to the property or call it describes, or delete it when the comment beside that property already says the same.
3. In the decision's `refs`, replace the two main.ts line ranges with `git://7a7e9d1` (where the hand-written parser was) and `code://packages/server/src/commands/options.ts` (where the flags are declared), leaving its body untouched.
4. The comment rewrites in `options.ts:95-100` belong to task 07; do not change them twice.

## Validation

- `rg -n "always (been|had|meant|were)|used to|before this|\\bparse\\b kept" packages/server/src/commands packages/server/src/main.ts` finds nothing.
- Each moved block is above the property or call it names, checked by reading `run.ts`.
- `pnpm typecheck` and `node_modules/.bin/vitest run test/server-cli.test.ts test/server-commands.test.ts` green, since only comments moved.

## Resume
