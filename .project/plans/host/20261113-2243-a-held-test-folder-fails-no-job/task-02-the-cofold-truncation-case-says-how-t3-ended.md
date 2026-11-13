---
title: The cofold truncation case says how t3 ended
status: implemented
depends: []
layer: "agent-cofold tests"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts#L522-L556](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts#L522-L556) - the case"
  - "[code://.project/problems/a-cofold-truncation-case-ends-its-third-turn-without-completing.md](../../../problems/a-cofold-truncation-case-ends-its-third-turn-without-completing.md) - its problem"
---

## Objective

The case asserts on `t3`'s end action first, with the words of an error, so its next failure says how `t3` ended.

## Files

- `UPDATE: packages/agent-cofold/test/agent-cofold-fork.test.ts` - an assertion on `t3`'s end before the `turnComplete` list.
- `UPDATE: .project/problems/a-cofold-truncation-case-ends-its-third-turn-without-completing.md` - the two new runs, what the print showed, and the fix that does not apply.

## Steps

1. Collect the end actions of `t3`: `chat/turnComplete`, `chat/turnCancelled` and `chat/error`, an error with its `error`.
2. Assert that they are `chat/turnComplete` alone, before the existing assertions.
3. Add the runs of 2026-11-13 and the findings to the problem file.

## Validation

- `npx vitest run packages/agent-cofold/test/agent-cofold-fork.test.ts` passes.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
