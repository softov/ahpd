---
title: A disposable-alone machine refuses another session
status: done
depends: [task-07-a-daemon-adopts-only-its-own-leftovers.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L118-L130](../../../../packages/sdk/src/types/computers.ts#L118-L130) - `ComputerPort`, which answers a machine's agents and nothing about who it is kept for"
  - "[code://packages/sdk/src/computers.ts#L103-L130](../../../../packages/sdk/src/computers.ts#L103-L130) - `computersFor`, which wraps `how` and `nested` and takes only the provider"
  - "[code://packages/sdk/src/host.ts#L3667](../../../../packages/sdk/src/host.ts#L3667) - where `spawn` wraps the port, with the session's URI at hand"
  - "[code://packages/computer/src/plugin.ts#L648-L662](../../../../packages/computer/src/plugin.ts#L648-L662) - the registered port and its `agents` answer"
  - "[code://packages/computer/src/runtime.ts#L506-L511](../../../../packages/computer/src/runtime.ts#L506-L511) - `disposableOf`, the alone flag read from `inspect`"
  - "[code://packages/computer/src/plugin.ts#L919-L922](../../../../packages/computer/src/plugin.ts#L919-L922) - the picker filter, today the only enforcement"
---

## Objective

A session that is not the one a `disposableAlone` machine was made for is refused when it names that machine, including by a hand-typed `computer://<id>`, at creation and when it enters the machine.
This applies [A disposableAlone machine refuses every session but the one that made it](../../../decisions/a-disposable-alone-machine-refuses-another-session.md).

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:118-130` - `ComputerPort.keptFor?(id): Promise<string | undefined>`, documented: the session a machine belongs to alone, or nothing when any session may run in it.
- `UPDATE: packages/computer/src/plugin.ts:648-662` - the port answers it from `inspect`: the session label when `disposableOf` says alone, else nothing.
- `UPDATE: packages/sdk/src/computers.ts` - `plugin/15` task 11's `machineRefusal` takes the session URI too and refuses a machine kept for another session, with a sentence that names neither session's content, only that the machine belongs to another session; `computersFor(computers, provider, session)` passes it.
- `UPDATE: packages/sdk/src/host.ts:3667` - `spawn` passes its `uri` to `computersFor`.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. The refusal reads the session label written in task 07, so it holds after a restart.
2. The host's create-time calls from `plugin/15` task 11 (`createSession`, the pre-turn config change, `beginAutomation`) pass the session URI, so the rule fails at creation as the agents rule does.
3. A machine with the alone flag and no session label was made before task 07; `keptFor` answers nothing for it, so its own session can still be resumed into it and the picker filter stays its only guard.

## Validation

- Session B setting `computer` to session A's `disposableAlone` machine by id is refused at creation; today it runs there, so the case fails.
- Session A's own pre-turn restart and a resume of session A after a daemon restart still enter it.
- A machine made from a profile without `disposableAlone` is open to any session.

## Resume
