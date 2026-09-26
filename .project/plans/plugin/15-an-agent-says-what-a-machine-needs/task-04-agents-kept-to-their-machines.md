---
title: The picker and the host keep an agent to its machines
status: todo
depends: [task-03-docker-applies-needs.md]
layer: "computer | sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the answerer"
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - where a session is checked before it starts"
---

## Objective

The `computer` answerer offers only machines whose `ahpd.agents` label includes the asking provider, plus machines with no label (made before this plan), and a session whose agent is not on its machine's label is refused with a sentence.

## Files

- `UPDATE: packages/computer/src/plugin.ts` - the filter.
- `UPDATE: packages/sdk/src/computers.ts` - the check.

## Steps

1. An unlabelled machine stays offered to every agent, so nothing made before this plan disappears.

## Validation

- The answerer test: two machines, two providers, each sees its own and the unlabelled one.
- A session forced onto the wrong machine gets the sentence.

## Resume
