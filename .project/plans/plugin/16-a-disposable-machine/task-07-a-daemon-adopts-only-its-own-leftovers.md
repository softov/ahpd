---
title: A daemon adopts only the disposable machines whose session it keeps
status: todo
depends: [task-06-a-resumed-session-counts-as-a-user.md]
layer: "computer | sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L308-L323](../../../../packages/computer/src/plugin.ts#L308-L323) - the startup listing that arms every leftover's removal"
  - "[code://packages/computer/src/plugin.ts#L536-L545](../../../../packages/computer/src/plugin.ts#L536-L545) - the create that writes the `disposable` labels"
---

## Objective

A disposable machine carries the session it was made for as a label, and at startup a daemon adopts only leftovers whose session it keeps, counting that session as a user until it is disposed.
This applies [A daemon adopts only the disposable machines whose session it keeps](../../../decisions/a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps.md).

## Files

- `UPDATE: packages/computer/src/plugin.ts:536-545` - the create writes `ahpd.disposable.session=<session uri>`.
- `UPDATE: packages/computer/src/plugin.ts:308-323` - the startup listing asks the host which sessions it keeps, adopts only matching machines with that session counted, and ignores the rest.
- `UPDATE: packages/sdk/src/types/plugin.ts` - if the plugin has no way to ask which sessions the host keeps, a read-only accessor is added, documented.
- `UPDATE: docs/COMPUTER.md` - how to find a leftover no daemon owns, by label.
- `UPDATE: test/computer-disposable.test.ts` - the cases below.

## Steps

1. Write the session label at create; the same label serves the `disposableAlone` refusal (task 08).
2. At startup, a leftover whose session is kept is watched with that session in its set; one whose session is not kept is not watched.

## Validation

- Two hosts over one fake Docker: host B starting does not remove host A's live disposable machine. Today it arms a removal and the fake sees `rm`, so the case fails.
- A kept session's machine survives a restart without the session being resumed, and goes after the session is disposed.

## Resume
