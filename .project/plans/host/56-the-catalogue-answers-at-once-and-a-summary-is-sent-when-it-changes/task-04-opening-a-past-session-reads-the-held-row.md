---
title: Opening a past session reads the held row
status: todo
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
5. Delete `LISTING_FRESH`, `pastAt`, and the second listing in `past`.
6. In Claude, `findSession` answers `{ row, dir }` or undefined; `transcript(id)` calls `turnsOf(id, dir)` with its `dir`, and `subagents` the same; `find` answers the row.

## Validation

- `host-past-open.test.ts`: opening a listed past session calls no agent's `list`; opening an id the held rows lack calls `find` once on the recorded provider and no `list`; the found row is broadcast as `root/sessionAdded` and a second open uses it; with an agent that has no `find`, a missing id waits for one refresh and opens when the refresh has it; an id nobody has answers as today.
- `agent-claude-transcript.test.ts` or a sibling: `transcript` and `subagents` call `getSessionInfo` and not `listSessions`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume
