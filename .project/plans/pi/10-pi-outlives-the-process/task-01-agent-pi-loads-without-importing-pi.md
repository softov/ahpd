---
title: agent-pi loads without importing pi
status: implemented
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L16-L30](../../../../packages/agent-pi/src/backend.ts#L16-L30) - runtime imports of `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`"
  - "[code://packages/agent-pi/src/catalog.ts#L15](../../../../packages/agent-pi/src/catalog.ts#L15) - `SessionManager` at module load"
  - "[code://packages/agent-pi/src/tools.ts#L14-L16](../../../../packages/agent-pi/src/tools.ts#L14-L16) - `defineTool` and `Type` at module load"
  - "[code://packages/sdk/src/types/agent.ts#L392](../../../../packages/sdk/src/types/agent.ts#L392) - `stateFile` is synchronous"
  - "[code://packages/agent-pi/src/index.ts](../../../../packages/agent-pi/src/index.ts) - the plugin's entry, what the daemon imports"
---

## Objective

Importing and applying the agent-pi plugin takes no runtime import of pi's packages; pi's SDK is imported once, on the first call that needs it, and every later call reuses it.

## Files

- `CREATE: packages/agent-pi/src/pi.ts` - one memoised loader that imports `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` and returns the values agent-pi uses.
- `UPDATE: packages/agent-pi/src/backend.ts` - `openPi`, `resumeOrCreate` and `wrap` take their pi values from the loader.
- `UPDATE: packages/agent-pi/src/catalog.ts` - `catalogue` and `stateFile` take `SessionManager` from the loader.
- `UPDATE: packages/agent-pi/src/tools.ts` - `toPiTool` takes `defineTool` and `Type` from the loader, or is called with them.
- `UPDATE: packages/agent-pi/src/plugin.ts` - `apply` starts the loader without awaiting it.
- `UPDATE: packages/agent-pi/test/` - the case below.

## Steps

1. Put every runtime value agent-pi takes from pi behind one memoised `import()`; type-only imports stay static.
2. Make each caller await the loader; a function that was synchronous and now needs pi becomes async only where its callers already can wait.
3. The plugin's `apply` starts the loader in the background without awaiting it, so pi is usually loaded a few seconds after boot and the daemon's start does not wait for it.
4. `Agent.stateFile` is synchronous in the SDK contract, so it stays synchronous: it uses the loaded `SessionManager` once the loader has resolved, and answers `undefined` before that, as for a session with no file.
5. Keep behaviour identical otherwise.

## Validation

- A case that imports the plugin entry and applies it with a fake host while pi's import is held unresolved: `apply` resolves anyway, and once the import resolves, the first `list` and a session open share that one import.
- It must fail first against today's static imports.
- A case: `stateFile` answers `undefined` before the loader resolves and the file's path after.
- By hand: `node --conditions development --import ./scripts/dev.mjs` importing `packages/agent-pi/src/index.ts` takes well under a second.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
`packages/agent-pi/src/pi.ts` holds `loadPi`, one memoised `import()` of `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` that answers the runtime values agent-pi uses, and `loadedPi`, which answers them only once loaded.
A failed import is not kept, so the next caller tries again.
`openPi`, `resumeOrCreate` and `wrap` in `backend.ts` take their pi values from the loader, and only type imports of pi stay static.
`catalogue` awaits the loader, and `stateFile` stays synchronous: it answers `undefined` until `loadedPi()` has pi, then pi's path.
`toPiTool` is now async and takes `defineTool` and `Type` from the loader; `build` in `session.ts` awaits it over the tools it is building with.
`apply` in `plugin.ts` starts the loader without awaiting it and swallows a failure, which the first caller retries.
`packages/agent-pi/test/agent-pi-lazy.test.ts` mocks both pi packages with imports held on a gate and counts each import.
It imports the entry and applies it while pi is held, checks `stateFile` answers `undefined`, starts a `list` and a session turn that both wait, then releases the gate and checks both finish on one import of each package and `stateFile` answers the path.
It was written first and failed on the entry import: `AssertionError: expected 'timed out' not to be 'timed out' // Object.is equality`.
`agent-pi.test.ts` loads pi in a `beforeAll`, and its `toPiTool` cases await the conversion.
By hand, `node --conditions development --import ./scripts/dev.mjs` importing `packages/agent-pi/src/index.ts` took 710 to 728 ms over three runs, of which `@ahpd/sdk` is 704 ms and agent-pi after it 61 ms.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1458 tests passed.
