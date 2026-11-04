---
title: An automation session keeps its origin after a restart
created: 2026-11-04
refs:
  - git://285a50ae - the commit of this repository the facts were checked at
  - "[code://packages/sdk/src/host/context.ts#L188-L189](../../packages/sdk/src/host/context.ts#L188-L189) - `origins`, the automation origin of each session, held only in memory"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1822](../../packages/sdk/src/host/lifecycle.ts#L1822) - a new session's automation origin goes into `origins` and nowhere else"
  - "[code://packages/sdk/src/host/automations.ts#L930](../../packages/sdk/src/host/automations.ts#L930) - a run that reuses a session sets its origin in `origins`"
  - "[code://packages/sdk/src/host/catalogue.ts#L1260-L1277](../../packages/sdk/src/host/catalogue.ts#L1260-L1277) - a session's summary takes its `origin` from `origins`"
  - "[code://packages/sdk/src/sessions/sessions.ts#L824-L825](../../packages/sdk/src/sessions/sessions.ts#L824-L825) - the store keeps a session's `remoteOrigin`, the pattern for a stored origin"
  - "[code://packages/agent-claude/src/transcript.ts#L436-L443](../../packages/agent-claude/src/transcript.ts#L436-L443) - a restored Claude turn opens with a message of origin `user`, whatever started it"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L93-L131 - `AutomationSessionOrigin`, which the protocol calls durable
---

# An automation session keeps its origin after a restart

Softov wants a session that an automation started to say so after ahpd restarts.
ahpw draws a "From an automation" chip over such a session's first message.
The chip shows while the daemon runs, and is gone after a restart.
Softov saw this on 2026-11-04 with ahpw's `sessions/20261104-0807-a-message-names-who-sent-it` branch.

## What others do

The protocol is the reference.
`SessionSummary.origin` holds an `AutomationSessionOrigin`: the automation and the run that created the session.
The protocol calls it durable, so it is expected to outlive the process that created the session.

## What ahpd has today

- The host holds each session's automation origin in `origins`, a map in memory.
- A new session's origin is set in `origins` only. The store does not write it, so the map is empty after a restart.
- A session's summary takes `origin` from `origins`, so after a restart no summary names an automation.
- The store already keeps a session's `remoteOrigin` beside its record, and loads it at start.
- A restored Claude turn opens with a message of origin `user`. The live turn of an automation run has origin `automation`, so a restart changes it.
- ahpw draws the chip from both facts: the message origin `automation`, and the session's automation origin for the click.

## Who writes

- No open branch on `origin` changes `context.ts`, `lifecycle.ts`, `automations.ts`, `catalogue.ts`, `sessions/sessions.ts` or `agent-claude/src/transcript.ts`.
- The worktree `bgrow` builds `claude/20261104-0745`, which changes `agent-claude/src/session/workers.ts` only.

## The change

- The store keeps a session's automation origin beside its record, as it keeps `remoteOrigin`.
- The host loads the stored origins into `origins` when it starts.
- A restored turn that an automation started keeps the message origin `automation`.

## Open points

- How a restored turn knows its origin: a stored origin per turn id, or the first turn of a session whose origin is an automation. The second misses a later run that reuses the session.
- The restore of pi, cofold and ACP sessions was not checked for message origins.
