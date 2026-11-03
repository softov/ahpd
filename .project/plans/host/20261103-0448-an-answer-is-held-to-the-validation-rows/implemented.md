---
title: An answer is held to the validation rows - implemented
date: 2026-11-03
refs:
  - git://154a4d75 - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

An acceptance is refused where a required question has no submitted answer, synced or carried.
A draft and a skip are not one.
An answer with no value, or a listed kind missing its payload, is refused, and a kind the protocol does not list is taken.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the two checks, by the rows.
- [`code://examples/notes/agent.ts`](../../../../examples/notes/agent.ts) - the note's name read from the answer's `value` and `freeformValues`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `chat/inputAnswerChanged` row.

## Verified

- On `cde4dd6c`'s source the draft acceptance is taken and the unlisted kind refused: both new cases fail.
- With the change the input-needed file passes 8 of 8, and the protocol's cases 647 of 647.
- The input file passes 29 of 29, conformance 25 of 25, and notes 10 of 10.
- The subagent chat file passes 28 of 28, the nested proxy 66 of 66, and tools 83 of 83.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Three cases accepted a required question with answers the rows refuse: a synced draft, and answers with no `state`.
- Each now sends a submitted answer, and host-input submits its synced draft before accepting.
- The notes example read an `optionId` and a `text` that no answer kind carries, and reads the protocol's fields.
