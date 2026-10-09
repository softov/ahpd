---
title: The agent packages use the shared value readers
status: todo
depends: [task-05-the-plugins-sdk-peer-range-names-the-sdk-that-exports-the-helpers.md]
layer: "agent-acp, agent-claude, agent-cofold, agent-pi"
refs:
  - "[code://packages/agent-acp/src/session/common.ts#L1-L10](../../../../packages/agent-acp/src/session/common.ts#L1-L10) - `bag` and `messageOf`, exported to the package"
  - "[code://packages/agent-acp/src/mapping.ts#L22](../../../../packages/agent-acp/src/mapping.ts#L22) - `bag`"
  - "[code://packages/agent-acp/src/plugin.ts#L94-L95](../../../../packages/agent-acp/src/plugin.ts#L94-L95) - `bagOf`, refusing arrays"
  - "[code://packages/agent-claude/src/session/common.ts#L3-L5](../../../../packages/agent-claude/src/session/common.ts#L3-L5) - `bag` and `str`, exported to the package"
  - "[code://packages/agent-claude/src/options.ts#L241](../../../../packages/agent-claude/src/options.ts#L241) - `bagOf`, refusing arrays"
  - "[code://packages/agent-claude/src/plugin.ts#L107-L108](../../../../packages/agent-claude/src/plugin.ts#L107-L108) - `bagOf`, refusing arrays"
  - "[code://packages/agent-cofold/src/capabilities.ts#L121-L122](../../../../packages/agent-cofold/src/capabilities.ts#L121-L122) - a `bag` answering `undefined`"
  - "[code://packages/agent-pi/src/session.ts#L44](../../../../packages/agent-pi/src/session.ts#L44) - `bag`"
---

## Objective

No agent package defines `bag`, `bagOf`, `str` or an error-message reader of its own; each imports them from `@ahpd/sdk`, and no answer changes.

## Files

- `UPDATE: packages/agent-acp/src/session/common.ts:3,8`, `mapping.ts:22`, `plugin.ts:94-95` - import `bag` and `reason`; `bagOf` becomes `isRecord(value) ? value : {}` at its call sites or one local line over `isRecord`.
- `UPDATE: packages/agent-claude/src/probe.ts:14,16`, `transcript.ts:26,28`, `session/common.ts:3,5`, `input.ts:11-12`, `options.ts:241`, `plugin.ts:107-108` - the same.
- `UPDATE: packages/agent-cofold/src/session.ts:35-36`, `turns.ts:10-11`, `runs.ts:10-11`, `transcript.ts:43-44`, `pauses.ts:6`, `mapping.ts:133`, `turnagent.ts:68`, `capabilities.ts:121-122` - the same; `capabilities.ts`'s `bag` is `isRecord`.
- `UPDATE: packages/agent-pi/src/session.ts:44`, `mapping.ts:30` - the same.

## Steps

1. Replace definitions and keep every call site's name, so the diff is imports and deletions.
2. The three array-refusing `bagOf` keep refusing arrays, as the plan's second table records.
3. The non-empty readers (`text`, `word`) stay.

## Validation

- A pure refactor: every agent package's tests stay green unchanged; `values.test.ts` from task 01 covers the helpers.
- `rg -n "^(export )?const (bag|bagOf|str) =" packages/agent-*/src` finds nothing.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume

Not started, and it cannot be: this task's Files name `packages/agent-cofold/src/session.ts`, `runs.ts` and `pauses.ts`, and the build's own rule is that those three (and `context.ts`) are being changed by another build right now - "if a task needs them, stop and report". Three of the eight `agent-cofold` files it would edit are those, and the task is one sweep whose validation (`rg -n "^(export )?const (bag|bagOf|str) =" packages/agent-*/src` finding nothing) only holds when all of it is done, so a partial pass over the other three packages would leave the sweep half-applied rather than closer.

The status stays `todo`. What is left is exactly what the task says: the four agent packages' `bag`, `bagOf`, `str` and error-message copies, replaced by imports from `@ahpd/sdk`, with the three array-refusing `bagOf` (agent-acp `plugin.ts:94`, agent-claude `options.ts:241` and `plugin.ts:107`) keeping their refusal. The `rg` agrees with the task's scope: it matches `bag`/`bagOf`/`str` definitions only under `packages/agent-claude`, `packages/agent-acp`, `packages/agent-pi` and `packages/agent-cofold`, so nothing outside those four is left over from task 01.
