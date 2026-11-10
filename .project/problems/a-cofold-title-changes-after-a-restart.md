---
title: A cofold session's title changes after a restart when its first turn failed before a run
status: open
date: 2026-11-10
severity: minor
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L841-L851](../../packages/agent-cofold/src/agent.ts#L841-L851) - `recordRow` titles a row by the first user message in cofold's store"
  - "[code://packages/sdk/src/host/spawn.ts#L815](../../packages/sdk/src/host/spawn.ts#L815) - `persistSessionTitle`, which keeps a title the host was given"
  - git://a09a278a4 - the commit of ahpd the cause was read at
---

## Symptom

Softov saw this on 2026-11-10 in ahpw, in a cofold session.

1. The first message, "testing", failed with "no model is configured", before cofold ran.
2. The second message, "hi", reached the model.
3. The session was titled "testing" while the daemon ran, and "hi" after a restart.

## Cause

Read from the code, not confirmed by a test.

- cofold keeps no title. After a restart, the catalogue titles a row by the first user message in cofold's store ([`code://packages/agent-cofold/src/agent.ts`](../../packages/agent-cofold/src/agent.ts#L841-L851)).
- A turn that fails before cofold starts its run writes no message to the store. So "testing" is not there, and "hi" is the first message.
- While the daemon runs, the host titles the session by the first message the person sent.

## Impact

A session's title changes after a restart, and does not match its first turn. Only a session whose first turn failed before a run shows it.

## Workaround

Rename the session. A title a person gives is kept.

## Fix

No fix is chosen.

- The host keeps the title it showed, with `persistSessionTitle`, so a restart reads it back.
- cofold writes the message of a turn that fails before its run, so the store holds it.
