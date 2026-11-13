---
title: Two attachment cases time out on Windows
status: open
date: 2026-11-03
severity: minor
refs:
  - "[code://packages/sdk/test/host-attachments.test.ts#L352-L383](../../packages/sdk/test/host-attachments.test.ts#L352-L383) - \"hands a queued and a steering message their attachments\""
  - "[code://packages/sdk/test/host-attachments.test.ts#L385-L410](../../packages/sdk/test/host-attachments.test.ts#L385-L410) - \"applies a message with attachments before what the client sent behind it\""
  - git://bbe4ea34 - "what comes after a waiting stop waits for it", in #208, the first merge after which the cases failed
---

## Symptom

On the Windows CI runners, the two cases wait 15 seconds for the steering message to be taken.
They fail with "still waiting after 15000 ms".
They failed in main's run 41679128167 after #208, and in two of the three runs of #209 (41685279459, 41687848622).
They passed in main's run after #210, in #210's run, and in #209's last run.
They pass on Linux.

## Cause

Unknown.
The failures start with #208. Its change makes a dispatch wait behind a stop that waits for its turn to start, and these cases send no stop.
The comment in the second case says a slow file write can outlast a 60 ms turn, which then refuses the steering.

## Impact

A Windows CI job fails at random, about one run in two, and a PR waits for a rerun.

## Workaround

None. Running the job again is not a fix.

## Fix

- Find which change in #208 makes the steering wait on Windows, with timings in the two cases.
- Hold the first case's turn, as the second case does, if the cause is the 60 ms turn ending first.
