---
title: The picker and the host keep an agent to its machines
status: implemented
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

Done 2026-09-26. The `computer` answerer in `packages/computer/src/plugin.ts` filters `made.list()` by `ask.provider`, and `Machine.agents` is read from the `Labels` column of `docker ps`. `ComputerPort.agents?` and `runtime.preparedFor` read the label back from an inspect, and the registered port answers it. `computersFor` in `packages/sdk/src/computers.ts` wraps the port the host hands a backend, so `how` refuses a machine prepared for another agent; `packages/sdk/src/host.ts` uses it where `Start.computers` is built, and it is exported from the SDK.

Found: the check is in the wrapped port rather than in `createSession`, because a backend asks for its machine lazily and that is the one path every session - a client's, an automation's, a tool's - takes. `packages/computer/test/computer-needs.test.ts` covers the answerer (two labelled machines, one unlabelled, each agent seeing its own and the unlabelled one); `packages/computer/test/computer-session.test.ts` covers the refusal and the unlabelled machine that still runs.
