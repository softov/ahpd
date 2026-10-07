---
title: ACP finds a session by listing its own server
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/catalog.ts#L330-L372](../../../../packages/agent-acp/src/catalog.ts#L330-L372) - `catalogueOf`: the held listing connection, the paged `session/list`, `placeOf`, and the watched records when the server cannot list"
  - "[code://packages/agent-acp/src/catalog.ts#L183-L186](../../../../packages/agent-acp/src/catalog.ts#L183-L186) - `watchedSession`"
  - "[code://packages/agent-acp/src/catalog.ts#L262-L284](../../../../packages/agent-acp/src/catalog.ts#L262-L284) - `loadedSession`, not used: a load replays the whole conversation and answers no row"
  - "[code://packages/agent-acp/src/agent.ts#L94](../../../../packages/agent-acp/src/agent.ts#L94) - `list`, beside which `find` goes"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L907](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L907) - the test server's `session/list`, which logs every request"
  - "[code://packages/agent-acp/test/agent-acp-catalog.test.ts#L437](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts#L437) - the listing tests, beside which the find tests go"
  - npm://@agentclientprotocol/sdk@1.6.0 - `ListSessionsRequest` has `cwd` and `cursor` and no `sessionId`; `LoadSessionResponse` and `ResumeSessionResponse` carry modes and config, not a title, a time or a folder
---

## Objective

ACP's agent answers `find(id)` from a session it is watching without asking the server, and otherwise from one listing of its own server, so a missing id costs that one server and not every agent the host has.

## Files

- `UPDATE: packages/agent-acp/src/catalog.ts` - `findListed(options, provider, id)`: `listedOf(watchedSession(provider, id))` when there is a record, else `(await catalogueOf(options, provider)).find((row) => row.id === id)`.
- `UPDATE: packages/agent-acp/src/agent.ts:94` - `find: (id) => findListed(options, provider, id)` after `list`.
- `UPDATE: packages/agent-acp/test/agent-acp-catalog.test.ts` - the cases below.

## Steps

1. Add `findListed` beside `catalogueOf`, reusing it whole, so the held connection, the paging, `placeOf` and the fallback to the watched records stay one code path.
2. Add `find` to the agent as a plain property: unlike `delete`, it does not depend on the handshake, because a server that cannot list still has the watched records to answer from.
3. Say in `findListed`'s comment why it lists: ACP 1.6.0's `session/list` cannot filter by id, and `session/load` replays the conversation and answers no row.

## Validation

- In `agent-acp-catalog.test.ts`, written first and failing because `find` is undefined:
  - against the test server, `find` for a listed id answers the same row `list()` answers for it, and the server's log has `session/list` and no `session/load`;
  - `find` for an id the server does not list answers `undefined`;
  - a session this process is watching is answered with no new request in the server's log;
  - against `--pages`, an id on the second page is found;
  - against a command that does not start, `find` answers the watched record or `undefined` and does not throw.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-acp`.

## Resume

- **Done:** implemented 2026-10-06, uncommitted. `findListed(options, provider, id)` in `packages/agent-acp/src/catalog.ts` answers `listedOf(watchedSession(provider, id))` when this process has a record, and otherwise reuses `catalogueOf` whole and picks the id; its comment says why it lists (ACP 1.6.0's `session/list` filters by `cwd` and `cursor` only, and `session/load` replays the conversation and answers no row). `find` sits beside `list` in `packages/agent-acp/src/agent.ts` as a plain property, not a getter, because it does not depend on the handshake. `agent-acp-catalog.test.ts` gains five cases and imports `watchSession`.
- **Gates:** `npx tsc -b` passes; `npx vitest run packages/agent-acp` passes, 13 files, 179 tests. The five new cases were seen failing first (63 of 68 passed, the five new ones failed with `find` undefined).
- **Next action:** [task-04-the-listing-throttle-goes.md](task-04-the-listing-throttle-goes.md).
- **Open questions:** none.
- **Watch out for:** `agent-acp-machine.test.ts > reaches a disposable machine` runs at about 5.0 s against vitest's 5 s default, so a whole-package run under load can time it out; it passes alone and on a second run, and it is untouched by this task. The missing-command case in this file leaves a watched record under the provider `acp-missing-find`, as `agent-acp-failure.test.ts` already does with `acp-missing-list`.
