---
title: A disposable-alone machine refuses another session
status: todo
depends: [task-07-a-daemon-adopts-only-its-own-leftovers.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/computers.ts#L103](../../../../packages/sdk/src/computers.ts#L103) - `computersFor`, where the agents check already is"
  - "[code://packages/computer/src/plugin.ts#L662-L665](../../../../packages/computer/src/plugin.ts#L662-L665) - the picker filter, today the only enforcement"
---

## Objective

A session that is not the one a `disposableAlone` machine was made for is refused when it names that machine, including by a hand-typed `computer://<id>`.
This applies [A disposable-alone machine refuses another session](../../../decisions/a-disposable-alone-machine-refuses-another-session.md).

## Files

- `UPDATE: packages/sdk/src/computers.ts` - `computersFor` reads the `alone` and session labels and refuses another session with a sentence.
- `UPDATE: packages/sdk/src/host.ts` - the create-time check from plugin/15 task 11 applies the same rule.
- `UPDATE: test/computer-disposable.test.ts` - the case below.

## Steps

1. The refusal uses the session label written in task 07, so it holds after a restart.

## Validation

- Session B setting `computer` to session A's `disposableAlone` machine by id is refused; today it runs there, so the case fails.

## Resume
