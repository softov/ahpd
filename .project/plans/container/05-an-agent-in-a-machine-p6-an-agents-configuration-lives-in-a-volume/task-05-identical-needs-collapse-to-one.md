---
title: Two identical needs collapse to one, and only differing needs at one target are refused
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L574-L606](../../../../packages/computer/src/manifest.ts#L574-L606) - every agent's needs resolved into one list, then refused on the first shared target"
  - "[code://packages/agent-claude/src/claude.ts#L373-L397](../../../../packages/agent-claude/src/claude.ts#L373-L397) - Claude's `machine()`, which every variant of one load answers identically"
  - "[code://packages/sdk/src/types/machine.ts#L18-L94](../../../../packages/sdk/src/types/machine.ts#L18-L94) - the need kinds and `ResolvedNeed`"
---

## Objective

A profile that names two agents declaring the same need, such as the built-in Claude and a Claude variant, makes one machine with that need once.
Two resolved needs with the same kind, source, target and `readOnly` are one need; two needs at one target that differ in any of those are refused as today, with both named.

## Files

- `UPDATE: packages/computer/src/manifest.ts:594-606` - before the target check, `sameNeed(a, b)` compares kind, source, target and `readOnly`; a need equal to one already landed at its target is dropped, and only a differing one is refused.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the cases below.

## Steps

1. `sameNeed` is one function, so what counts as the same need can widen or narrow later; it ignores the need's name and description, which differ between agents that ask for one thing.
2. The first need's name is the one kept, so a later refusal or log names it.
3. An env need compares its value too, as its source, and the comparison never prints it.
4. `plugin/15` task 09 rewrites this check into one list of every mount with its origin; whichever lands second keeps the collapse, so identical needs are one entry in that list.

## Validation

- A profile with `agents: ["claude", "claude-openrouter"]` makes a machine, and the fake Docker sees each Claude mount once; today create refuses it with "machine needs claudeConfigDirectory and claudeConfigDirectory both land at /ahpd/claude".
- Two needs at one target with different sources are refused, both named, as today.
- Two needs equal but for `readOnly` are refused.
- `pnpm --filter @ahpd/computer test` green.

## Resume
