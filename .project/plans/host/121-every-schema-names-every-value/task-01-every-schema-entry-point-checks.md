---
title: Every schema entry point checks for gaps
status: done
depends: []
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/plugins/validate.ts#L88](../../../../packages/sdk/src/plugins/validate.ts#L88) - `checkAgent`"
  - "[code://packages/sdk/src/plugins/validate.ts#L549](../../../../packages/sdk/src/plugins/validate.ts#L549) - `checkTriggerType`"
  - "[code://packages/sdk/src/plugins/validate.ts#L609](../../../../packages/sdk/src/plugins/validate.ts#L609) - `checkAdapter`"
  - "[code://packages/sdk/src/plugins/validate.ts#L664](../../../../packages/sdk/src/plugins/validate.ts#L664) - `checkEngine`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1347](../../../../packages/sdk/src/plugins/plugins.ts#L1347) - `registerSessionConfig`"
  - "[code://packages/server/src/plugins.ts#L1987](../../../../packages/server/src/plugins.ts#L1987) - where a manifest's `optionsSchema` is kept"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1500](../../../../packages/sdk/src/host/sessionmethods.ts#L1500) - a backend's session config schema on its way to a client"
---

## Objective

The host finds each gap in a schema that a plugin gives it, at every place a plugin can give one.
Each gap is a problem line that names the plugin and the path, and the load continues.

## Files

- `CREATE: packages/sdk/src/plugins/schemagaps.ts` - `schemaGaps(schema)`, which returns each gap as a path and a reason.
- `UPDATE: packages/sdk/src/plugins/validate.ts:88` - check the schema that `checkAgent` takes.
- `UPDATE: packages/sdk/src/plugins/validate.ts:549` - check `configSchema` in `checkTriggerType`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:609` - check the adapter's `schema` and each capability's `input` in `checkAdapter`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:664` - check the engine's `schema` in `checkEngine`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1347` - check the property that `registerSessionConfig` takes.
- `UPDATE: packages/server/src/plugins.ts:1987` - check a manifest's `optionsSchema` before the host keeps it.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1500` - check each backend's session config schema the first time a client asks for it.
- `CREATE: packages/sdk/test/schema-gaps.test.ts` - cases for each gap, for each union, and for `{}`.
- `UPDATE: docs/plugins/PLUGINS.md` - say what a schema must name, and that a gap is a problem line.
- `UPDATE: CHANGELOG.md` - the new problem line.

## Steps

1. Write `schemaGaps` to walk `properties`, `additionalProperties`, `items` and each branch of `oneOf` and `anyOf`.
2. Report an object with neither `properties` nor an `additionalProperties` schema.
3. Report an array with no `items`.
4. Report a field with keywords and no `type`, `enum`, `const` or union.
5. Accept `{}` as a value of any JSON shape.
6. Make each check return its gaps beside its result, so that the caller writes the problem line.
7. Write each problem line as `<plugin>: <where> <path>: <gap>`, such as `agent-claude: engine claude env: object with no properties`.
8. Report the gaps of a backend's session config schema once for each backend, not at each call.
9. Never refuse a load, a registration or a call because of a gap.
10. Write the test cases, the docs and the changelog line.

## Validation

- The cases in `schema-gaps.test.ts` pass.
- A test plugin that registers `{ type: 'object' }` as an engine schema loads, and its problem line names the path.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Resume

- **Done so far:** `schemaGaps(schema)` and `gapLine(by, where, gap)` are in `packages/sdk/src/plugins/schemagaps.ts`, and the sdk's index exports them. `checkAgent`, `checkTriggerType`, `checkAdapter` and `checkEngine` return the gaps beside what they checked. `pluginHost` reports each gap through `reportGaps`, and `registerSessionConfig` walks the property it is given. The host keeps a manifest's `optionsSchema` only after it walks it, in `packages/server/src/plugins.ts`. `sessionmethods.ts` walks a backend's session config schema once for each backend, the first time a client asks for it. `packages/sdk/test/schema-gaps.test.ts` covers each gap, each union and `{}`.
- **Next action:** Softov reads the report.
- **Files:** `packages/sdk/src/plugins/schemagaps.ts` (new), `packages/sdk/src/plugins/validate.ts`, `packages/sdk/src/plugins/plugins.ts`, `packages/sdk/src/index.ts`, `packages/sdk/src/host/sessionmethods.ts`, `packages/server/src/plugins.ts`, `packages/sdk/test/schema-gaps.test.ts` (new), `docs/plugins/PLUGINS.md`.
- **Open questions:** none.
- **Departures:** a gap reaches the daemon as a warning alert, not as a `problem`. A `problem` is a line that can refuse a load, and a gap never refuses one. The line's text is the `<plugin>: <where> <path>: <gap>` that the plan names. `checkAdapter` and `checkEngine` now return `{ name, checked }`, and `checkAgent` and `checkTriggerType` return their gaps, so the caller writes the line. The walk does not enter a node again inside itself, so a schema that holds itself ends. A node that two fields share is still reported at each field.
- **Watch out for:** the first-party plugins had gaps until tasks 02, 03 and 04 were done. The walk test of task 05 now holds them at none.
