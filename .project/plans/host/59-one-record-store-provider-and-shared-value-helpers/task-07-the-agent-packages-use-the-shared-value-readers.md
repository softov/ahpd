---
title: The agent packages use the shared value readers
status: done
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

Built, awaiting review, in nineteen files: 54 insertions and 98 deletions. Every agent package takes `bag`, `str` and `reason` from `@ahpd/sdk`, and no package defines them any more. Every call site kept its own name, so the diff is imports and deletions. The refs and Files above name definitions that have since moved (`agent-acp/src/plugin.ts`'s `bagOf` was L94-95, and was L112 when this task ran), and the sweep is the same either way.

`agent-acp`: `session/common.ts` imports `bag` and re-exports it, and `messageOf` is the one line `const messageOf = reason;`, so its four importers stay as they are. `mapping.ts` takes `bag` from the sdk. `plugin.ts`'s `bagOf` was the shared `bag` written out (`isRecord(value) ? value : {}`), so its seven call sites read `bag(...)` and the definition went.

`agent-claude`: `probe.ts`, `transcript.ts`, `input.ts` and `session/common.ts` import `bag` and `str`, and the last re-exports both. `options.ts` and `plugin.ts` take `bag` for their `bagOf`. The local `list` stays in each of those four: it answers `unknown[]`, which is what its callers iterate, and `strings` answers `string[]`.

`agent-cofold`: eight files take their readers from the sdk now, seven of them `bag` and five `str` too (`turnagent.ts` had only a `str`). `capabilities.ts`'s `bag` answered `undefined` for a value that is not a plain object, and its callers test for exactly that, so it is `isRecord` there: both guards are `if (!isRecord(value)) return undefined;`, and the two tests are `isRecord(held.files)` and `isRecord(held.web)`. Its two value reads take the shared `bag`.

`agent-pi`: `session.ts` and `mapping.ts` import `bag` for their copies, and `session.ts` `reason` for its three inline readers.

The shared `bag` refuses an array, where sixteen of the copies it replaces admitted one. That is the one behaviour this change can move, so every call site was read first. None passes a list. The only structural uses are five spreads, of `_meta`, a preset's `settings` and a JSON-Schema `permissionMode`, each an object by protocol. `agent-cofold`'s `capabilities.ts` is the one place a non-object answer was tested for, and it tests with `isRecord` now.

The three array-refusing `bagOf` keep that refusal, because the shared `bag` is that refusal written once. The non-empty readers stay where they are, as step 3 and the plan's decision ask: `text` in `agent-cofold`'s `capabilities.ts` and `agent.ts`, `word` in its `config.ts`, and `text` in `agent-pi/src/mapping.ts`.

The plan's risk line about the inline error messages was applied where a file was already open: `agent-acp/src/plugin.ts` twice, `agent-claude/src/plugin.ts` twice, `agent-cofold/src/turns.ts` once and `agent-pi/src/session.ts` three times now read `reason(error)`. The copies in files this task did not open (`agent-claude/src/models.ts`, `session/query.ts`, `session/config.ts`, `session/clienttools.ts`) stay, because a sweep of the rest is not this plan.

This task's own Resume said it could not start: its Files name `packages/agent-cofold/src/session.ts`, `runs.ts` and `pauses.ts`, which plugin/40 held. plugin/40 merged as commit 9c5491e, and the three files are on this branch, so that block is gone and the one sweep holds.

Gates: `pnpm install` answered `Already up to date`, `node tools/schema.mjs` passed, `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` clean (9 packages, none undeclared), `npx vitest run --maxWorkers=2 --testTimeout=10000` 269 files and 4788 tests passed. `rg -n "^(export )?const (bag|bagOf|str) =" packages/agent-*/src` finds nothing, and the plan's checklist grep over `packages/*/src` finds only `packages/sdk/src/values.ts`.
