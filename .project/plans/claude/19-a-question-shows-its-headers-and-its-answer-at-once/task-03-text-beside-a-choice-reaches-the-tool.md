---
title: Text typed beside a choice reaches the tool with the choice
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/asking.ts#L413-L436](../../../../packages/agent-claude/src/session/asking.ts#L413-L436) - where each answer becomes the word the tool reads"
---

## Objective

An answer of kind `selected` or `selected-many` with `freeformValues` reaches the tool as the choice and the typed text joined with `, `, as VS Code joins them; a `text` answer is unchanged.

## Files

- `UPDATE: packages/agent-claude/src/session/asking.ts:413-436` - read `freeformValues` beside `value`; today `said[question] = inner.value ?? answer.value ?? value` drops them.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.

## Steps

1. Test first: `{ kind: 'selected', value: 'Blue', freeformValues: ['teal'] }` gives `Blue, teal`; `{ kind: 'selected-many', value: ['A', 'B'], freeformValues: ['c'] }` gives `A, B, c`; `{ kind: 'text', value: 'teal' }` gives `teal`.
2. Build the word from the value and the free text as VS Code's `claudeInteractiveTools.ts` L135-L153 does, from the same inner value the answer already reads.
3. Keep the answers recorded in `answeredInputs` in the same shape, so a restored question reads them back.

## Validation

- `packages/agent-claude/test/agent-claude-tool-input.test.ts`: the three cases above, through a synced answer and through a completion's own answers.
- `pnpm test` in `packages/agent-claude`.

## Resume

Implemented. A selection with no `freeformValues` keeps its shape, so a multi-select without text is still an array.
