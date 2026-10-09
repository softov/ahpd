---
title: Each optionsSchema declares every field the code reads
domain: plugin
status: active
priority: medium
created: 2026-10-09
revalidated: 2026-10-09
requires:
  - plans/documentation/04-each-package-readme-says-how-to-use-it/plan.md
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L58-L82](../../../../packages/agent-claude/src/plugin.ts#L58-L82) - `presets` declares `name`, `models`, `keepCliModels` and `env`, and no other preset field"
  - "[code://packages/agent-claude/src/options.ts#L157](../../../../packages/agent-claude/src/options.ts#L157) - `DECLARED`, the preset fields `optionsOf` checks: `sandbox`, `thinking`, `outputStyle`, `env`, `extraArgs`"
  - "[code://packages/agent-claude/src/plugin.ts#L159-L168](../../../../packages/agent-claude/src/plugin.ts#L159-L168) - a preset is checked in `optionsOf`, so a wrong preset costs that preset and not the load"
  - "[code://packages/agent-acp/src/plugin.ts#L77-L87](../../../../packages/agent-acp/src/plugin.ts#L77-L87) - `machine` declares `env` and `copy` with a description and no type: the pattern to mirror"
  - "[code://packages/agent-acp/src/plugin.ts#L209](../../../../packages/agent-acp/src/plugin.ts#L209) - `MACHINE_KEYS`, the five fields `machineOf` accepts: `env`, `copy`, `part`, `state`, `seed`"
  - "[code://packages/computer/src/plugin.ts#L98-L133](../../../../packages/computer/src/plugin.ts#L98-L133) - `profiles` declares `needs`, `parts`, `secretUnreadable`, `state`, `stateScope`, `gitGuard`, `nestedDelete`"
  - "[code://packages/computer/src/plugin.ts#L179-L240](../../../../packages/computer/src/plugin.ts#L179-L240) - `profilesOf` reads 16 more fields, and a wrong one costs its own setting"
  - "[code://packages/agent-claude/README.md](../../../../packages/agent-claude/README.md) - the `presets.<id>` table already has a row for each field"
  - "[code://packages/agent-acp/README.md](../../../../packages/agent-acp/README.md) - the `presets.<id>.machine` table already has a row for each field"
  - "[code://packages/computer/README.md](../../../../packages/computer/README.md) - the `profiles.<name>` table already has a row for each field"
---

## Goal

A person or a client that reads a plugin's `optionsSchema` sees every option the plugin accepts.
Today three schemas leave out fields that the code reads, and only the READMEs list them.
After this plan, each schema declares those fields with a description, and the READMEs and the schemas agree.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- documentation/04 [implemented.md](../../documentation/04-each-package-readme-says-how-to-use-it/implemented.md) - lists the fields under "Departures from the plan".
- `rg -n "DECLARED" packages/agent-claude/src/options.ts` - the Claude preset fields, each with a `schema` of its own.
- `rg -n "MACHINE_KEYS" packages/agent-acp/src/plugin.ts` - the acp `machine` fields.
- `rg -n "said\." packages/computer/src/plugin.ts` - the computer profile fields that `profilesOf` reads.

### Gaps

- Claude preset: `sandbox`, `thinking`, `outputStyle`, `extraArgs` are not in `presets.additionalProperties.properties`.
- acp `machine`: `part`, `state`, `seed` are not in `machine.properties`.
- computer profile: `title`, `description`, `image`, `cpus`, `memory`, `workdir`, `mounts`, `agents`, `folder`, `host`, `disposable`, `disposableDelay`, `disposableAlone`, `sessionFolder`, `sessionRepository`, `sessionTree` are not in `profiles.additionalProperties.properties`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each schema declares every field its code reads | Softov, 2026-10-09, asked "the computer, Claude and acp schemas leave out fields that the code accepts; must the schemas declare them?" and answered "Plan: schemas declare them" | 01-03 |
| A new property has a description and no `type` or `enum`, so a wrong value costs its own preset or setting and not the load | Softov, 2026-10-09, asked "The new preset and profile fields: keep them description-only, or add their type and enum too?" and answered "Description only" | 01-03 |
| A Claude preset property takes its description from the `schema` of its declaration in `DECLARED` | (defaulted: one text for one option) | 01 |
| No test checks the README rows against the schema | Softov, 2026-10-09, in documentation/04: "No, not now" | - |

## Proposed architecture

- **Data flow** - no change. The daemon checks the options against the schema, and `optionsOf`, `machineOf` and `profilesOf` check the fields as they do today.
- **Layer responsibilities** - `agent-claude`, `agent-acp`, `computer`: each schema declares its fields · the READMEs: unchanged, unless a description and a row disagree.
- **Source-of-truth files** - [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts), [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The Claude preset schema declares every preset field](task-01-the-claude-preset-schema-declares-every-preset-field.md) | implemented | - |
| [02 - The acp machine schema declares part, state and seed](task-02-the-acp-machine-schema-declares-part-state-and-seed.md) | implemented | - |
| [03 - The computer profile schema declares every profile field](task-03-the-computer-profile-schema-declares-every-profile-field.md) | implemented | - |

## Risks and tradeoffs

- The daemon check does not read `additionalProperties`, so a typed property would not fail a load today. A later validator that reads it would fail the whole load, so the new properties carry no type.
- A schema with no type tells a client less than a typed one. The description says the type in words, as the acp `machine` block does.

## Resume state

- **Done so far:** tasks 01-03 are implemented and wait for review. [implemented.md](implemented.md) lists the files, the gate results and the departures.
- **Next action:** review the diff in `build/agents/p39`.
- **Open questions:** none.
- **Watch out for:** the daemon check does not read into a preset or a profile. So a typed property there would not fail a load today. The properties carry no type so that this stays true if the check ever reads deeper.

## Final verification checklist

- [ ] Every field that `DECLARED`, `MACHINE_KEYS` and `profilesOf` read is a property in its schema.
- [ ] Every row in the three README tables names a schema property.
- [ ] A load with a wrongly typed value in one preset or profile still registers the others.
- [ ] `pnpm build`, `pnpm typecheck` and the suite pass.
- [ ] `plans/index.md` updated.
