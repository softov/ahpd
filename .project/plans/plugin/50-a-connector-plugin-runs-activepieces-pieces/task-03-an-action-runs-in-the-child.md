---
title: An action runs in the child
status: done
depends:
  - task-02-a-piece-is-an-adapter.md
layer: "activepieces"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L101-L120](../../../../packages/sdk/src/types/connectors.ts#L101-L120) - `Adapter.run`, which host/118 adds"
  - "[code://packages/sdk/src/connectors/channel.ts#L312-L323](../../../../packages/sdk/src/connectors/channel.ts#L312-L323) - `resolved`, so the connector's config holds the secret values"
  - npm://@activepieces/pieces-framework@0.32.0 - `ActionContext`, the shape the child builds
---

## Objective

Each adapter answers `run(connector, action, input)`.
The child calls the piece's `action.run(context)` with the connector's auth and the input, and answers the result.

## Files

- `UPDATE: packages/activepieces/src/mapping.ts` - `authOf(connector)`, the auth value a piece reads.
- `UPDATE: packages/activepieces/src/plugin.ts` - each adapter's `run`, the call ids and the timeout.
- `UPDATE: packages/activepieces/src/child.ts` - the `run` message and the context.
- `UPDATE: packages/activepieces/src/wire.ts` - the `run` request and its answer.
- `CREATE: packages/activepieces/test/run.test.ts` - the cases below.

## Steps

1. Build `{ type: 'SECRET_TEXT', secret_text }` for a secret-text piece, from the connector's config.
2. Build `{ type: 'CUSTOM_AUTH', props }` for a custom-auth piece, from the connector's config.
3. In `run`, send `{ id, piece, action, auth, input }` to the child, and wait for the answer with that id.
4. Fail a call that takes more than 60 seconds, and drop its late answer.
5. Start the child again on the next call when it exited.
6. In the child, build a context with `auth`, `propsValue`, `store`, `run`, `step`, `project` and `executionType`.
7. Keep one in-memory `store` for each connector id.
8. Make `files`, `connections` and `server` calls throw an error that says the plugin does not offer them.
9. Answer the result as JSON, and answer an error with its message only.
10. Add the tests, and run the package tests.

## Validation

- `run.test.ts`: a test piece's action gets the auth and the input, and its result comes back.
- `run.test.ts`: an action that throws answers its message, and no stack or auth.
- `run.test.ts`: an action that takes too long fails, and the next call works.
- `run.test.ts`: a child that exits starts again on the next call.
- `run.test.ts`: a `store` value from one call reaches the next call on that connector, and no other connector.
- `pnpm -s typecheck` passes.

## Resume

- **Done so far:** `mapping.ts` builds the auth a piece reads, `{ type: 'SECRET_TEXT', secret_text }` or `{ type: 'CUSTOM_AUTH', props }`, from the connector's config.
  `adapterOf` takes a `RunCall` and gives the adapter its `run`, so a call is only offered when the plugin has somewhere to send it.
  `plugin.ts` sends `{ type: 'run', piece, connector, action, auth, input }`, fails a call after 60 seconds, and drops the late answer while the child stays up.
  `wire.ts` holds `RunRequest`, `RanAnswer` and the `Question` a caller sends before the channel gives it an id.
  `child.ts` builds the context with `auth`, `propsValue`, `store`, `run`, `step`, `project` and `executionType`, and keeps one in-memory store for each connector id. `files`, `connections` and `server` throw.
  `run.test.ts` passes all five cases, and `pnpm -s typecheck`, `pnpm -s build` and `pnpm -s boundary` pass.
- **Next action:** task 04, which names the three first pieces.
- **Files:** `packages/activepieces/src/mapping.ts`, `packages/activepieces/src/plugin.ts`, `packages/activepieces/src/child.ts`, `packages/activepieces/src/wire.ts`, `packages/activepieces/src/index.ts`, `packages/activepieces/test/run.test.ts`, `packages/activepieces/test/fixtures/piece-run.mjs`.
- **Open questions:** step 3 names `{ id, piece, action, auth, input }`, and step 7 keeps one store for each connector id, so the request also carries `connector`.
  The child keys the store by it, and no other field could.
  A second one: `nameOf` also reads a piece named by a file URL, `piece-<name>.mjs`, so `run.test.ts` can name its fixture through `apply`. The plugin's `pieces` pattern still admits only `@activepieces/piece-*` packages.
- **Departures:** the child also refuses `flows`, waitpoints and agent tools, which step 8 does not name, rather than answering them with a value nothing keeps.
  A test drives the timeout with fake timers, because a real 60-second call would hold the suite for a minute.
- **Watch out for:** the child handles each message as it arrives, so a next call answers while a slow action is still running. That is what lets the timeout case call again without waiting for the slow one.
