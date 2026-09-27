---
title: cofold records the model each run used, released by Softov
status: implemented
depends: []
layer: "cofold agents"
refs:
  - file:///github/cofold/packages/agents/src/types/store.ts - `RunRecord`
  - file:///github/cofold/packages/agents/src/types/model.ts - `ModelAdapter.id` and `modelId`
  - file:///github/cofold/packages/agents/src/types/agent.ts - the agent definition, which holds the adapter
  - "[code://packages/agent-cofold/src/agent.ts#L333-L355](../../../../packages/agent-cofold/src/agent.ts#L333-L355) - `modelOf`, which builds the adapter from a `<provider>/<model>` reference"
---

## Objective

A run takes the model reference its caller names as an option, and every `RunRecord` cofold writes keeps it as given, per decisions [a-cofold-turns-model-is-kept-in-cofolds-store](../../../decisions/a-cofold-turns-model-is-kept-in-cofolds-store.md) and [a-cofold-run-is-told-the-model-reference-it-runs-on](../../../decisions/a-cofold-run-is-told-the-model-reference-it-runs-on.md).

## Files

- `UPDATE: /github/cofold/packages/agents/src/types/store.ts` - `RunRecord.model?`, a string.
- `UPDATE: /github/cofold/packages/agents/src/` - the run options gain `model?`, and where a run record is created copies it, and each store that persists one.
- `UPDATE: /github/cofold/packages/store-file` - the case that the file store writes and reads the field back; `runs.create` in `src/store.ts` writes the whole record and `runs.update` spreads `...rest` onto the record it reads, so the store may need no code change.
- `UPDATE: /github/cofold/packages/agents/package.json` - the version.

## Steps

1. Read how a run is started and its record created, and which options a run takes.
2. Add `model?: string` to the run options and copy it onto the `RunRecord` as given.
   cofold neither reads nor builds it, and does not derive it from `ModelAdapter.id` or `modelId`.
3. Every store cofold ships writes and reads the field; a record without it still reads.
4. Commit in cofold with a version bump.
   Softov tags and approves the release.

## Validation

- cofold: a run started with `model: 'open_router/x'` writes a `RunRecord` whose `model` is `open_router/x`, read back from each store.
- A run started without the option writes a record with no `model`, and a record written before the field still reads.
  Today no record has one.
- cofold's whole suite green.

## Resume

Implemented 2026-09-27 in `/github/cofold`, committed there as `5f19a07` with `@cofold/agents` at `0.1.2`. No tag and no publish; the release is Softov's.

The agents case was written first and seen to fail: `run({ model: 'open_router/x' })` wrote a record whose `model` was undefined. `RunArgs.model` and `RunRecord.model` are new, and `setupRun` copies the option onto the record as given, conditionally so a run that named none writes no field. The file store's case is a guard, not a failing-first: `runs.create` already writes the whole record and `runs.get` reads it, which the plan expected.

`pnpm test` in cofold: 71 files, 832 tests, no type errors, with `@cofold/agents` built first.

Task 03 waits for the release.
