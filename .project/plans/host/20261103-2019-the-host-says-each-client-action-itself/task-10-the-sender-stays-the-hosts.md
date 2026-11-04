---
title: The sender stays the host's
status: done
depends: [task-01-the-host-says-the-clients-action.md]
layer: host
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L1291-L1360](../../../../packages/sdk/src/host/spawn.ts#L1291-L1360) - `ahpd.sender` added to a start and its message"
  - "[code://packages/sdk/src/host/spawn.ts#L325-L340](../../../../packages/sdk/src/host/spawn.ts#L325-L340) - `withSender`, a turn read back with its sender"
  - "[code://packages/sdk/src/sessions/sessions.ts#L105-L112](../../../../packages/sdk/src/sessions/sessions.ts#L105-L112) - the record's senders by turn, read only by `withSender`"
---

## Objective

Who sent a turn is the host's own record, used for what the host runs and charges.
VS Code's host keeps a pending message's sender the same way.
No action and no state a client reads carries it.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts` - `ahpd.sender` goes from the start, its message and the turns read back; `withSender` goes.
- `UPDATE: packages/sdk/src/sessions/sessions.ts`, `packages/sdk/src/types/sessions.ts` - the record's senders by turn go, with their only reader.
- `UPDATE: docs/sdk/AHP.md`, `docs/sdk/BUILD-A-HOST.md` - the rows that name `ahpd.sender`.

## Steps

1. Remove `ahpd.sender` from every start the host says (row 28).
2. Remove it from the turns a snapshot and `chat/turnsLoaded` read back (row 28).
3. Remove the record's senders by turn, which only those two read (row 28).
4. Keep the sender in memory for metering and a client's calls, as VS Code keeps it (row 21).

## Validation

- Run `packages/sdk/test/host-senders.test.ts`: no action and no turn carries a sender.
- Run it again: the usage record still names who sent the work.

## Resume

- **Done:** steps 1 to 4, at the commit that closes this task, the two validation items in one host-senders case.
- **The store:** `sender`, `setSender` and `moveChat`'s turns go; a row's `senders` is read past and written back without it.
- **Kept in memory:** the meter's owner, the plugin events' `sender` and the queue drain's sender of a message.
- **Deleted with their subject:** two sessions cases on the stored sender, and their `naming` helper.

