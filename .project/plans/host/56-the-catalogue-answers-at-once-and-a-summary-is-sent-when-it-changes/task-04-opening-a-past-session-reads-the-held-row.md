---
title: Opening a past session reads the held row
status: done
depends: [task-03-the-catalogue-is-held.md]
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/host/history.ts#L10-L20](../../../../packages/sdk/src/host/history.ts#L10-L20) - `LISTING_FRESH`, which goes"
  - "[code://packages/sdk/src/host/history.ts#L163-L176](../../../../packages/sdk/src/host/history.ts#L163-L176) - `past` lists before it reads, and relists for a missing id"
  - "[code://packages/sdk/src/types/agent.ts#L474](../../../../packages/sdk/src/types/agent.ts#L474) - `list`, beside which `find` goes"
  - "[code://packages/sdk/src/host/catalogue.ts#L333-L348](../../../../packages/sdk/src/host/catalogue.ts#L333-L348) - how a listed row's owner, name and dates are recorded"
  - "[code://packages/agent-claude/src/claude.ts#L435-L460](../../../../packages/agent-claude/src/claude.ts#L435-L460) - `transcript` and `subagents`, which list to find a path"
  - "[code://packages/agent-claude/src/catalog.ts#L23-L32](../../../../packages/agent-claude/src/catalog.ts#L23-L32) - `catalogue`, whose row mapping `find` reuses"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `getSessionInfo(id, { dir })`
---

## Objective

Opening a past session reads its row from the held catalogue, a row that is not there yet is asked for by id rather than by listing everything, and Claude finds a session's directory without a listing.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:474` - `find?(id: string): Promise<Listed | undefined>` after `list`, documented: this backend's row for one session, read without listing the rest; undefined when it has none.
- `UPDATE: packages/sdk/src/validate.ts` - `find` checked as a function when present, as `list` is.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - `adopt(agent, row)`: the per-row recording `listing` does at 333-361, taken out so `listing` and `past` share it.
- `UPDATE: packages/sdk/src/host/history.ts:10-20, 123-197` - `past` reads `rows`; a missing row goes through `find`; `LISTING_FRESH` and `pastAt` are deleted.
- `UPDATE: packages/agent-claude/src/catalog.ts` - `findSession(dirs, id)`: `getSessionInfo(id, { dir })` per path, mapped as `catalogue` maps a row, with the path it was found under.
- `UPDATE: packages/agent-claude/src/claude.ts:435-460` - `find` added; `transcript` and `subagents` take the path from `findSession` instead of `catalogue(served)`.
- `UPDATE: packages/sdk/test/support/claude-sdk.ts` - a fake `getSessionInfo` over `sdk.sessions`.
- `CREATE: packages/sdk/test/host-past-open.test.ts`.

## Steps

1. Add `find` to `Agent` and to `validate.ts`.
2. Move the recording of one listed row (`names`, `owners`, `wheres`, `births`, `moves`, and the recorded-provider choice) into `adopt`, and call it from `listing`.
3. In `past`, after the `history` and `reading` checks: look the id up in `await held()`; when it is missing, ask `find` of the agent `kept.provider(id)` names first and then of every other agent that has `find`, in load order; the first row found is adopted, added to `rows`, and sent as `root/sessionAdded`.
4. When no agent with `find` has it and some agent has no `find`, await `refresh()` (the running one or a new one) and look again; otherwise answer undefined.
5. `LISTING_FRESH` and `pastAt` stay for an agent without `find`, as the plan's second table records.
6. In Claude, `findSession` answers `{ row, dir }` or undefined; `transcript(id)` calls `turnsOf(id, dir)` with its `dir`, and `subagents` the same; `find` answers the row.

## Validation

- `host-past-open.test.ts`: opening a listed past session calls no agent's `list`; opening an id the held rows lack calls `find` once on the recorded provider and no `list`; the found row is broadcast as `root/sessionAdded` and a second open uses it; with an agent that has no `find`, a missing id waits for one refresh and opens when the refresh has it; an id nobody has answers as today.
- `agent-claude-transcript.test.ts` or a sibling: `transcript` and `subagents` call `getSessionInfo` and not `listSessions`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume

Implemented 2026-10-04.

- `Agent.find?(id): Promise<Listed | undefined>` is in `types/agent.ts` beside `list`, with the comment saying what it is for: this backend's row for one session, read without listing the rest. `validate.ts` checks it as a function when present, as `list` is.
- `catalogue.ts` has `adopt(agent, row, waiting?)`, the per-row recording `listing` did inline - `names`, `owners` (only when no `waiting` names one), `wheres`, `births`, `moves` and the built `Summary` - and `rowAdded(summary)`, which clears the last-sent record for the resource and broadcasts `root/sessionAdded`. `listing` now pushes `adopt(one.agent, one.row, waiting)` per row, so a listing and a single row found by id record the same things.
- `history.ts`: `past` reads the held `rows` directly for the id, asks `findOf(id)` when it is not there, adopts the row it is given, sends it with `rowAdded`, and keeps it in `rows` so the next opening asks nobody anything. `findOf` asks the agent `kept.provider(id)` records first and then the rest in load order; a backend that throws is a backend with nothing to say and the others are still asked.
- When no agent with `find` has it and some agent has no `find`, `past` falls back to one listing for the whole catalogue and looks again. That is the store this worked before it could be: a listing is all a backend without `find` has.
- In Claude, `findSession(dirs, id)` answers `{ row, dir }` or undefined by calling `getSessionInfo(id, { dir })` per configured path; `listed(info, dir)` is the row mapping, shared with `catalogue`. `find` answers the row, and `transcript` and `subagents` take the path from `findSession` instead of walking `catalogue(served)` for it.
- `packages/sdk/test/support/claude-sdk.ts` has a fake `getSessionInfo` over the same `sdk.sessions` `listSessions` reads, with an `asked` counter beside `listed` so a test can see the cost of one id against a whole listing.

Departures from the plan:

- **`LISTING_FRESH` and `pastAt` stay.** Step 5 says they go, and the second listing they throttle is gone from the common path - a backend that can answer by id is never listed for. But the fallback above exists for a backend that cannot, and for that one the throttle is still the whole point: `users-gate > reads the catalogue once for a run of subscribes to sessions nobody has` opens five sessions no backend has and expects one listing, and `users-gate > finds a session a backend wrote to disk after the last listing` needs the retry. Both are in `packages/sdk/test`. The comment above `LISTING_FRESH` now says it guards the `find`-less fallback.
- **The fallback waits out a running listing rather than joining it** (step 4 says "the running one or a new one"). `relist()` awaits `refreshing` and then starts a fresh one. A session written to disk while a pass was in flight is the case the fallback is here for, and joining that pass answers the same way it always does - which is what `users-gate > finds a session a backend wrote to disk after the last listing` was written about. This is the same `relist` task 03 left in place for the same test.
- `packages/agent-claude/test/agent-claude-subagent-restore.test.ts` is not in the plan's Files. Its `vi.mock` of the agent SDK listed four exports and the import of `claude.ts` now pulls in `getSessionInfo`, so the whole file failed to load. The mock gained `getSessionInfo` answering out of the same `sdk.sessions` it already built.
- The plan's validation names `agent-claude-transcript.test.ts` or a sibling; it is `packages/agent-claude/test/agent-claude-find.test.ts`, which asserts that `transcript` and `subagents` call `getSessionInfo` and never `listSessions`, and that `list` still lists.

Both new test files bite. In `host-past-open.test.ts`, disabling the `find` branch fails three of five, dropping the recorded-provider-first ordering fails the one that counts `asked`, and removing the `someCannotSay()` guard fails the `find`-less fallback. In `agent-claude-find.test.ts`, the transcript and subagents tests assert `sdk.listed` is zero.

Gates: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (207 files, 2866 tests) all pass.
