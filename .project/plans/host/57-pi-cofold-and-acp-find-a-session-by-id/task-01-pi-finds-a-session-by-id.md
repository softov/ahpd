---
title: pi finds a session by id
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/replay.ts#L196-L219](../../../../packages/agent-pi/src/replay.ts#L196-L219) - `replayed`: `findById` per directory, then `SessionManager.open`"
  - "[code://packages/agent-pi/src/catalog.ts#L154-L190](../../../../packages/agent-pi/src/catalog.ts#L154-L190) - `catalogue`, the row `find` must equal, and the watched records that win over disk"
  - "[code://packages/agent-pi/src/catalog.ts#L60-L67](../../../../packages/agent-pi/src/catalog.ts#L60-L67) - `stateFile`, the same `findById` lookup"
  - "[code://packages/agent-pi/src/agent.ts#L135](../../../../packages/agent-pi/src/agent.ts#L135) - `list`, beside which `find` goes"
  - "[code://packages/agent-claude/src/catalog.ts#L38-L60](../../../../packages/agent-claude/src/catalog.ts#L38-L60) - Claude's `findSession`, the shape to mirror"
  - "[code://packages/agent-pi/test/agent-pi-disk.test.ts#L18](../../../../packages/agent-pi/test/agent-pi-disk.test.ts#L18) - `sessionOnDisk`, a real pi session file written by pi's own `SessionManager`"
  - npm://@earendil-works/pi-coding-agent@0.87.1 - `SessionManager.findById`, `SessionManager.open`, `getHeader`, `getSessionName`, `getEntries`; `list` derives its rows in the unexported `buildSessionInfo`
---

## Objective

pi's agent answers `find(id)` with the row `list` would have answered for that session, reading one session file and never listing a project folder.

## Files

- `UPDATE: packages/agent-pi/src/catalog.ts` - `findSession(options, provider, id, directories)`: the watched record when there is one, else the first directory whose `SessionManager.findById` names a file, opened and mapped to a `Listed`; the watched-record mapping in `catalogue` taken out so both use it.
- `UPDATE: packages/agent-pi/src/agent.ts:135` - `find: (id) => findSession(options, provider, id, paths)` after `list`.
- `CREATE: packages/agent-pi/test/agent-pi-find.test.ts` - the cases below.

## Steps

1. pi's `find` opens the one file `findById` names, as the plan's second table records.
2. In `findSession`, answer the watched record first, mapped as `catalogue` maps it.
3. Otherwise, for each served directory in turn, `findById(directory, id, options.sessionDir)`; a throw or `undefined` moves to the next directory.
4. Open the file with `SessionManager.open(file)` and build the row as pi 0.87.1's `buildSessionInfo` does: `title` is the last `session_info` name, else `firstLine` of the first user message's text; `createdAt` is the header's `timestamp`; `modifiedAt` is the latest user or assistant message's `timestamp`, else the header's; `workingDirectories` is the header's `cwd`, or the directory asked when it is empty.
5. A file pi cannot open answers `undefined`, as `replayed` does.

## Validation

- `agent-pi-find.test.ts`, written first and failing because `find` is undefined:
  - a session written by `sessionOnDisk` is answered by `find` with a row equal to the one `list()` answers for it, for a named session and for one with no name;
  - an id no directory has answers `undefined`;
  - a session this process is watching answers its watched row, with the title a client set;
  - `find` never calls `SessionManager.list` (a spy on it counts zero).
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-pi`.

## Resume
