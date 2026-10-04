---
title: pi, cofold and ACP find a session by id, and the listing throttle goes
domain: host
status: planned
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires:
  - plans/host/56-the-catalogue-answers-at-once-and-a-summary-is-sent-when-it-changes/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/agent.ts#L475-L490](../../../../packages/sdk/src/types/agent.ts#L475-L490) - `Agent.find`, optional, added by host 56"
  - "[code://packages/sdk/src/host/history.ts#L10-L20](../../../../packages/sdk/src/host/history.ts#L10-L20) - `LISTING_FRESH`, two seconds, which goes"
  - "[code://packages/sdk/src/host/history.ts#L141-L142](../../../../packages/sdk/src/host/history.ts#L141-L142) - `pastAt`, which goes"
  - "[code://packages/sdk/src/host/history.ts#L183-L194](../../../../packages/sdk/src/host/history.ts#L183-L194) - `relist`, which waits out a running listing and starts a new one"
  - "[code://packages/sdk/src/host/history.ts#L218-L225](../../../../packages/sdk/src/host/history.ts#L218-L225) - `someCannotSay`, true for any agent with no `find`"
  - "[code://packages/sdk/src/host/history.ts#L265-L278](../../../../packages/sdk/src/host/history.ts#L265-L278) - the relisting fallback in `past`, throttled by `pastAt`"
  - "[code://packages/agent-claude/src/catalog.ts#L38-L60](../../../../packages/agent-claude/src/catalog.ts#L38-L60) - `findSession`, Claude's `find`, the pattern the other three mirror"
  - "[code://packages/agent-pi/src/replay.ts#L196-L219](../../../../packages/agent-pi/src/replay.ts#L196-L219) - `replayed`, which already finds one pi session with `SessionManager.findById` per directory"
  - "[code://packages/agent-pi/src/catalog.ts#L154-L190](../../../../packages/agent-pi/src/catalog.ts#L154-L190) - pi's `catalogue`, whose row mapping `find` must equal"
  - "[code://packages/agent-cofold/src/agent.ts#L625-L640](../../../../packages/agent-cofold/src/agent.ts#L625-L640) - cofold's `list`, one row per `store.sessions.list` record"
  - "[code://packages/agent-cofold/src/agent.ts#L674-L678](../../../../packages/agent-cofold/src/agent.ts#L674-L678) - cofold's `transcript`, which already reads one record with `store.sessions.get`"
  - "[code://packages/agent-acp/src/catalog.ts#L330-L372](../../../../packages/agent-acp/src/catalog.ts#L330-L372) - ACP's `catalogueOf`, the server's paged `session/list` or the watched records"
  - "[code://packages/agent-acp/src/catalog.ts#L262-L284](../../../../packages/agent-acp/src/catalog.ts#L262-L284) - `loadedSession`, the only per-session call ACP has, which replays the whole conversation"
  - "[code://packages/sdk/test/users-gate.test.ts#L1132-L1146](../../../../packages/sdk/test/users-gate.test.ts#L1132-L1146) - `listingOne`, a `claude` backend with `list` and no `find`"
  - "[code://packages/sdk/test/users-gate.test.ts#L1169-L1175](../../../../packages/sdk/test/users-gate.test.ts#L1169-L1175) - `finds a session a backend wrote to disk after the last listing`"
  - "[code://packages/sdk/test/users-gate.test.ts#L1215-L1229](../../../../packages/sdk/test/users-gate.test.ts#L1215-L1229) - `reads the catalogue once for a run of subscribes to sessions nobody has`, which pins the throttle"
  - "[code://packages/sdk/test/host-past-open.test.ts#L139-L152](../../../../packages/sdk/test/host-past-open.test.ts#L139-L152) - the `find`-less fallback, as host 56 left it"
  - "[code://docs/AGENT.md#L84](../../../../docs/AGENT.md#L84) - the `Agent` table, where `find(id)` is not listed"
  - npm://@earendil-works/pi-coding-agent@0.87.1 - `SessionManager.findById(cwd, id, sessionDir)` reads each file's header in one project folder and answers a path; `buildSessionInfo`, which `list` uses, is not exported
  - npm://@cofold/store-file@0.1.1 - `sessions.get({ sessionId })` reads one `session.json`, looked up on disk on each miss
  - npm://@agentclientprotocol/sdk@1.6.0 - `session/list` filters by `cwd` and `cursor` only; `session/load` replays a session and answers no row; `session/resume` answers modes and config only
---

## Goal

Opening a past session that the held catalogue does not have yet asks only the backend that may have it, for every backend ahpd ships, so no subscribe ever lists the whole catalogue again for a bundled agent and the two-second throttle that guarded that listing goes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "find" packages/agent-{pi,cofold,acp}/src` - none of the three has a `find`.
- `rg -n "LISTING_FRESH|pastAt" packages docs` - only `packages/sdk/src/host/history.ts`.
- `rg -n "past\(" packages/sdk/src/host` - `past` is called from `chatactions.ts`, `sessionmethods.ts` and `snapshots.ts`, every one a subscribe, a fetch of turns or a config change to a session the host is not running.
- `rg -n "findById" packages/agent-pi/src` - `replayed` and `stateFile` already find one pi session by id; neither builds a row.
- `rg -n "export (type )?\{" node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` - `SessionManager` is exported, `buildSessionInfo` and `getMessageActivityTime` are not.
- `rg -n "async get" node_modules/@cofold/store-file/dist/store.js` - `sessions.get` finds the session folder on disk and reads its record; a miss is not cached.
- `rg -o '"session/[a-z_]+"' node_modules/@agentclientprotocol/sdk/dist/schema/index.js` - ACP 1.6.0 has `cancel`, `close`, `delete`, `fork`, `list`, `load`, `new`, `prompt`, `request_permission`, `resume`, `set_config_option`, `set_mode` and `update`; nothing that describes one session.
- `rg -n "ListSessionsRequest = " -A 20 node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` - the only filters are `cwd` and `cursor`; there is no `sessionId` filter.
- `rg -n "list:" examples/echo/agent.ts` - the echo example lists and has no `find`, and most host tests run on it.

### Runtime path

```
subscribe to a session the host is not running -> past(id)
  -> the held rows -> findOf(id): the recorded provider's find, then every other agent's find, in load order
  -> nobody found it, and some agent lists without find -> one listing (today throttled to one in two seconds)
  -> owner.transcript(id) -> turns
```

### Gaps

- pi, cofold and ACP have no `find`, so with any of them loaded a missing id costs a listing of every agent.
- `LISTING_FRESH` makes a second missing id inside two seconds answer from the old listing, so a session written to disk between two subscribes is refused.
- `someCannotSay` counts an agent with neither `list` nor `find`, which a listing cannot help.
- `docs/AGENT.md` does not tell a third-party backend that `find(id)` exists.
- ACP has no call that answers one session's row: `session/list` cannot filter by id, `session/load` replays the conversation and answers modes and config, and `session/resume` answers the same.

## Decisions locked in

No decision file: every row below is either Softov's answer or a choice anyone would make.

| What | Source | Task |
| --- | --- | --- |
| `LISTING_FRESH` stays until pi, cofold and ACP have a `find`, and then it goes | Softov, 2026-10-04, asked "pi, cofold and ACP have no `find` yet; what do we do with them?": keep the throttle for now and plan `find` for them; once every agent has a `find`, the throttle goes | 04 |
| pi's `find` asks pi's own store for the one session, per served directory, as `replayed` does | Softov's brief for this plan, 2026-10-04 | 01 |
| cofold's `find` reads the one record with `store.sessions.get` and maps it as `list` maps a row | Softov's brief for this plan, 2026-10-04 | 02 |
| ACP's `find` lists that one server with its own `catalogueOf` and picks the id, because ACP 1.6.0 has no call that describes one session: `session/list` filters by `cwd` and `cursor` only, and `session/load` replays the conversation and answers no row | Softov's brief for this plan, 2026-10-04; npm://@agentclientprotocol/sdk@1.6.0 | 03 |
| A session this process is watching is answered from its watched record first, in pi and ACP, without reading anything | (defaulted: `catalogue` and `catalogueOf` already let the watched record win over what is on disk) | 01, 03 |
| A row `find` answers equals the row `list` answers for the same session | (defaulted: otherwise the next refresh sends a `root/sessionSummaryChanged` for a row that did not change) | 01, 02, 03 |
| A third-party agent without `find` gets one refresh of the held catalogue per missing id, with no throttle beyond the refresh's single flight | Softov's brief for this plan, 2026-10-04 | 04 |
| That refresh is one that started after the caller asked: a caller joins a refresh that started after it asked, and waits out one that started before | (defaulted: a refresh that started before the ask may have read the disk before the session was written, and joining it would answer the same way it always did) | 04 |
| A missing id costs a refresh only when some agent has `list` and no `find`; an agent with neither has nothing a listing would find | (defaulted: a listing cannot help an agent that does not list) | 04 |
| The echo example keeps no `find` | (defaulted: it is what most host tests run on, so the suite keeps covering the `find`-less fallback, and it shows a third party the minimum) | 04 |

## Proposed architecture

- **Data flow** - each bundled agent answers `find(id)` from its own store: pi from the one session file, cofold from the one record, ACP from its own server's list; the host asks `find` first and refreshes only for an agent that lists without one.
- **Event flow** - unchanged: a row found by id is adopted and sent as `root/sessionAdded`, and a refresh sends what moved, as host 56 built them.
- **State flow** - `pastAt` and `LISTING_FRESH` go; `history.ts` keeps a count of refreshes started, so a caller can tell a refresh that started after it asked from one that did not.
- **Layer responsibilities** - agent-pi: `findSession` in `catalog.ts` · agent-cofold: a shared row mapping and `find` in `agent.ts` · agent-acp: `findListed` in `catalog.ts` · sdk `host/history.ts`: the fallback without a throttle · docs `AGENT.md`: the `find(id)` row.
- **Source-of-truth files** - [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts), [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi finds a session by id](task-01-pi-finds-a-session-by-id.md) | todo | - |
| [02 - cofold finds a session by id](task-02-cofold-finds-a-session-by-id.md) | todo | - |
| [03 - ACP finds a session by listing its own server](task-03-acp-finds-a-session-by-listing-its-own-server.md) | todo | - |
| [04 - The listing throttle goes](task-04-the-listing-throttle-goes.md) | todo | 01, 02, 03 |

## Risks and tradeoffs

- ACP's `find` costs a full `session/list` of that one server, paged to the end, so an ACP server with many sessions is still a listing per missing id; it is one server rather than every agent, and nothing cheaper exists in ACP 1.6.0.
- pi's row is built by ahpd from the session file, because `buildSessionInfo` is not exported; a pi release that changes how `list` derives a title or a time makes `find` and `list` disagree, and task 01's equality test is what catches it.
- A third-party agent without `find` now pays one listing per missing id when the ids come one after another, where the throttle used to bound that to one in two seconds; ids asked at once still share one.
- `users-gate.test.ts` is split by host 55, which is planned; if it lands first the two tests task 04 changes are in `users-gate-sessions.test.ts`.

## Resume state

- **Done so far:** nothing.
- **Next action:** ask open question 1, then [task-01-pi-finds-a-session-by-id.md](task-01-pi-finds-a-session-by-id.md); tasks 01, 02 and 03 are independent and can run in any order.
- **Open questions:**
  1. Asked before task 01: pi's `find` either opens the one file `findById` names and builds the row itself, or calls `SessionManager.list` for that project folder and picks the id, which gives pi's own row but reads every file in the folder - proposed: open the one file, mirroring `replayed`, with task 01's test holding the row equal to `list`'s.
- **Watch out for:** `find` is optional on `Agent` and stays optional, because a third-party backend may not have one; ACP's `delete` is a getter read off the handshake, and `find` is not, because every ACP server can be listed or answered from the watched records; the throttle's two tests change meaning rather than disappear, so the `find`-less fallback stays covered.

## Final verification checklist

- [ ] pi, cofold and ACP each have a `find` whose row equals their `list` row for the same session.
- [ ] `LISTING_FRESH` and `pastAt` are gone from `packages/sdk/src`.
- [ ] A host whose agents all have `find` lists nothing when a client opens an id nobody has.
- [ ] A session written to disk between two subscribes, or while a listing runs, is found on a backend without `find`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
