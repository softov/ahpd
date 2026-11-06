---
title: The steering after a message with attachments arrives
status: todo
depends: []
layer: "@ahpd/sdk host"
refs:
  - "[code://packages/sdk/test/host-attachments.test.ts#L391-L415](../../../../packages/sdk/test/host-attachments.test.ts#L391-L415) - \"applies a message with attachments before what the client sent behind it\", which waits 15 s for the steering"
  - "[code://packages/sdk/test/host-attachments.test.ts#L355-L389](../../../../packages/sdk/test/host-attachments.test.ts#L355-L389) - \"hands a queued and a steering message their attachments\", the second case of the problem record"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the dispatch that #208 made wait behind a stop"
  - git://bbe4ea34 - "what comes after a waiting stop waits for it", in #208, after which the cases fail
---

## Objective

The cause is known for a steering message that never reaches the session after a turn with attachments.
Softov has the cause and a proposed fix.

## Files

- `UPDATE: packages/sdk/test/host-attachments.test.ts:391-415` - only if the cause is in the case; otherwise unchanged until Softov approves the fix.

## Steps

1. Read `bbe4ea34`, and write down when a dispatch now waits and what ends the wait.
2. Run `packages/sdk/test/host-attachments.test.ts` alone 50 times on Linux, and record the failures.
3. When none fails, run it 50 times under load, with `stress-ng --cpu 0` or a second vitest run of another package.
4. When none fails on Linux, push the branch, and read the Windows job of its PR.
5. With a failure, log the order of the dispatches, the file write and the turn's end.
6. Write the cause in this file's *Resume*, with the log lines that show it.
7. Stop, and give Softov the cause and a proposed fix.
8. Remove the logging before the task ends.

## Validation

- A log of a failing run shows the cause, not a reading of the code alone.
- After the approved fix, `host-attachments.test.ts` passes 50 times in a row on Linux.
- After the approved fix, the PR's Windows jobs pass with no rerun.

## Resume
