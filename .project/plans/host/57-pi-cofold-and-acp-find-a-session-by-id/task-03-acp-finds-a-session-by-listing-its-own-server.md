---
title: ACP finds a session by listing its own server
status: todo
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
