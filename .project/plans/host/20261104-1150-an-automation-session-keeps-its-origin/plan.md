---
title: An automation session keeps its origin after a restart
domain: host
status: planned
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://736aa129 - the commit of ahpd the facts were checked at
  - git://42cc7f65 - the last commit that holds the brief `an-automation-session-keeps-its-origin`
  - "[code://packages/sdk/src/host/context.ts#L188-L189](../../../../packages/sdk/src/host/context.ts#L188-L189) - `origins`, each session's automation origin, held only in memory"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1822](../../../../packages/sdk/src/host/lifecycle.ts#L1822) - a new session's automation origin goes into `origins`"
  - "[code://packages/sdk/src/host/automations.ts#L930](../../../../packages/sdk/src/host/automations.ts#L930) - a run that reuses a session sets its origin"
  - "[code://packages/sdk/src/host/lifecycle.ts#L404-L416](../../../../packages/sdk/src/host/lifecycle.ts#L404-L416) - a disposed session's origin is removed"
  - "[code://packages/sdk/src/sessions/sessions.ts#L138-L141](../../../../packages/sdk/src/sessions/sessions.ts#L138-L141) - `remoteOrigin` and `createdBy`, the stored fields to copy"
  - "[code://packages/sdk/src/sessions/sessions.ts#L820-L827](../../../../packages/sdk/src/sessions/sessions.ts#L820-L827) - how a stored field is read back at start"
  - "[code://packages/sdk/src/types/sessions.ts#L374-L409](../../../../packages/sdk/src/types/sessions.ts#L374-L409) - the store's optional getters and setters"
  - "[code://packages/sdk/src/host/localturns.ts#L125-L139](../../../../packages/sdk/src/host/localturns.ts#L125-L139) - `Recorded`, one file of a chat's record of the turns it began"
  - "[code://packages/sdk/src/host/localturns.ts#L289-L294](../../../../packages/sdk/src/host/localturns.ts#L289-L294) - `turnRecordedAs`, which writes that record"
  - "[code://packages/sdk/src/host/localturns.ts#L387-L426](../../../../packages/sdk/src/host/localturns.ts#L387-L426) - `asBegun` and `transcriptOf`, the read after a restart"
  - "[code://packages/sdk/src/host/spawn.ts#L1279](../../../../packages/sdk/src/host/spawn.ts#L1279) - each `chat/turnStarted` records its turn"
  - "[code://packages/sdk/src/host/spawn.ts#L1697-L1699](../../../../packages/sdk/src/host/spawn.ts#L1697-L1699) - `onTurnRecorded`, a turn recorded again under the backend's id"
  - "[code://packages/agent-claude/src/transcript.ts#L436-L443](../../../../packages/agent-claude/src/transcript.ts#L436-L443) - a restored Claude turn has origin `user`"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L93-L131 - `AutomationSessionOrigin`, which the protocol calls durable
---

## Goal

A session that an automation started still says so after ahpd restarts.
Its summary names the automation, and its turns keep the message origin they ran with.
ahpw then draws "From an automation" on the first message after a restart, as it does before one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "origins\.(set|delete)" packages/sdk/src/host` - `lifecycle.ts` and `automations.ts` write the map, and nothing writes the store.
- `rg -n "remoteOrigin|createdBy" packages/sdk/src/sessions/sessions.ts` - two stored fields of a session, each with a getter, a setter and a reader at start.
- `rg -n "turnRecordedAs\(" packages/sdk/src` - every `chat/turnStarted` records its turn, and `onTurnRecorded` records it again under the backend's id.

### Runtime path

```
session made by a run -> origins + store -> summary.origin, after a restart too
chat/turnStarted with message.origin -> turnRecordedAs(..., origin) -> recorded/<hash>.json
restart -> transcriptOf -> asBegun -> the turn's message gets its recorded origin
```

### Gaps

- The store keeps no automation origin, so `origins` is empty after a restart.
- The record of the turns a chat began keeps no message origin, and a restored Claude turn says `user`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A restored turn gets its message origin from the host's per-turn record | Softov, 2026-11-04, "Store it per turn in that record" | 02 |
| The store keeps a session's automation origin beside its record, as it keeps `remoteOrigin` | (defaulted: the pattern the store already has) | 01 |
| `origins` reads the store for a session it does not hold | (defaulted: the store is what outlives the process) | 01 |
| Only a message origin that is not `user` is recorded | (defaulted: `user` is what a restore says already) | 02 |
| A record file without an origin reads as it does today | (defaulted: records written before this change stay valid) | 02 |

## Proposed architecture

- **Data flow** - the store row gains `automationOrigin`, and a `Recorded` file gains an optional `origin`.
- **State flow** - `origins` stays the map the host reads, filled from the store when a session is not in it.
- **Layer responsibilities** - sdk store: keep and read the session origin · sdk host: write it, record turn origins, put them back on read · backends: no change.
- **Source-of-truth files** - [`code://packages/sdk/src/host/localturns.ts`](../../../../packages/sdk/src/host/localturns.ts) · [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the store keeps the automation origin](task-01-the-store-keeps-the-origin.md) | implemented | - |
| [02 - a restored turn keeps its message origin](task-02-a-turn-keeps-its-origin.md) | todo | - |

## Risks and tradeoffs

- A session made before this change has no stored origin, and stays as today after a restart.
- `claude/20261104-1150-a-background-task-end-is-a-notice` builds on this branch and changes `asBegun` too. Keep the origin step apart from the fold.

## Resume state

- **Done so far:** [task-01](task-01-the-store-keeps-the-origin.md) is implemented.
The store keeps a session's automation origin beside its record, the host writes and clears it with `origins`, and the catalogue reads the store for a session `origins` does not hold.
- **Next action:** [task-02-a-turn-keeps-its-origin.md](task-02-a-turn-keeps-its-origin.md).
- **Watch out for:** `onTurnRecorded` records a turn again under a new id; carry the origin to that record.

## Final verification checklist

- [ ] After a restart, the summary of a session a run made names the automation and the run.
- [ ] After a restart, the first turn of that session has message origin `automation`.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk and agent-claude tests pass.
