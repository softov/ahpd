---
title: The picker and the host keep an agent to its machines
status: done
depends: [task-03-docker-applies-needs.md]
layer: "computer | sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L914-L922](../../../../packages/computer/src/plugin.ts#L914-L922) - the answerer's filter by `ask.provider`"
  - "[code://packages/sdk/src/computers.ts#L103-L130](../../../../packages/sdk/src/computers.ts#L103-L130) - `computersFor`, the check on `how` and `nested`"
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
