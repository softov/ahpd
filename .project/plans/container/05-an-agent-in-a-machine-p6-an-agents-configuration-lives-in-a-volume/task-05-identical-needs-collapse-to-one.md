---
title: Two identical needs collapse to one, and only differing needs at one target are refused
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L408-L419](../../../../packages/computer/src/manifest.ts#L408-L419) - `oneMountEach`, which already makes one entry of identical mounts and refuses differing ones"
  - "[code://packages/computer/src/manifest.ts#L689-L691](../../../../packages/computer/src/manifest.ts#L689-L691) - env needs become one object, so two at one name are last-one-wins with no refusal"
  - "[code://packages/computer/src/manifest.ts#L695](../../../../packages/computer/src/manifest.ts#L695) - mounts deduped with a `Set`"
  - "[code://packages/agent-claude/src/claude.ts#L373-L397](../../../../packages/agent-claude/src/claude.ts#L373-L397) - Claude's `machine()`, which every variant of one load answers identically"
  - "[code://packages/sdk/src/types/machine.ts#L18-L94](../../../../packages/sdk/src/types/machine.ts#L18-L94) - the need kinds and `ResolvedNeed`"
---

## Objective

Main already makes one mount of identical directory and file needs (`oneMountEach`, `manifest.ts:408-419`, and the `Set` at `:695`), so a profile naming the built-in Claude and a Claude variant is made today.
What is left is env needs and state needs: two env needs at one variable with the same value are one need, and two with different values are refused with both named, where today the last one wins silently; two state needs (task 02) at one target with the same seeds are one volume, and differing ones are refused.

## Files

- `UPDATE: packages/computer/src/manifest.ts:689-691` - env needs pass through `sameNeed(a, b)` before they become one object: an equal one is dropped, a differing one at the same variable is refused with both named.
- `UPDATE: packages/computer/src/manifest.ts:408-419` - state needs join `oneMountEach` through the same `sameNeed`, comparing state directory and seeds.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the cases below.

## Steps

1. `sameNeed` is one function, so what counts as the same need can widen or narrow later; it ignores the need's name and description, which differ between agents that ask for one thing.
2. The first need's name is the one kept, so a later refusal or log names it.
3. An env need compares its value too, as its source, and the comparison never prints it.

## Validation

- Two agents declaring one env need with one value make a machine with one `-e` for it.
- Two agents declaring one env variable with different values are refused, both needs named and neither value printed; today the last one wins.
- Two state needs at one directory with the same seeds mount one volume; with different seeds they are refused.
- A profile with `agents: ["claude", "claude-openrouter"]` still makes a machine with each Claude mount once, as today.
- `pnpm --filter @ahpd/computer test` green.

## Resume

- Built 2026-10-05 on cecc459.
- `sameNeed` in `packages/computer/src/manifest.ts` compares kind, target, source, read-only, provider and seeds, never name or description; `oneNeedEach` keeps the first of two equal env or state needs and refuses two that differ, naming both needs and no value.
- A state need also joins `oneMountEach`, so a state directory at a bind's or a part's target is refused like any other shared target.
- Tests in `packages/computer/test/computer-needs.test.ts`: the differing env case failed before the change; the one `-e` case and the two-variant mounts case already passed, as the objective says; the state cases are task 02's "mounts two identical state needs as one volume, and refuses two with different seeds", built once the state need existed.
