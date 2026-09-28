---
title: A mode says which calls ask
status: implemented
depends: [task-01-a-call-can-wait-on-a-person.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L48-L68](../../../../packages/agent-pi/src/agent.ts#L48-L68) - the schema and defaults, where a session key is added"
  - "[code://packages/agent-pi/src/session.ts#L565-L570](../../../../packages/agent-pi/src/session.ts#L565-L570) - `setConfig`, which only takes `projectTrust`"
  - "[code://packages/agent-claude/src/claude.ts#L166-L189](../../../../packages/agent-claude/src/claude.ts#L166-L189) - the sibling's `permissionMode`"
  - "[code://packages/agent-cofold/src/agent.ts#L115-L135](../../../../packages/agent-cofold/src/agent.ts#L115-L135) - the other sibling's modes and their meanings"
  - "[code://.project/decisions/permission-modes-live-in-the-harness.md](../../../../.project/decisions/permission-modes-live-in-the-harness.md) - what each of the six modes means"
---

## Objective

A pi session advertises `permissionMode`, the same six values Claude and cofold have, defaulting to `default`, and `needsAsking` decides from it.

## Files

- `UPDATE: packages/agent-pi/src/agent.ts:48-68` - `permissionMode` in the schema, with the siblings' values, labels and descriptions, `scope: 'session'`, `sessionMutable: true`, default `default`; the default in `defaults`.
- `UPDATE: packages/agent-pi/src/session.ts` - `needsAsking` from the mode, and `setConfig` taking `permissionMode`.
- `UPDATE: test/agent-pi.test.ts` - one case per mode.

## Steps

1. Judge pi's built-ins by name: `edit` and `write` are edits inside the working directory when their `path` resolves under it; `bash` writes and may destroy; `read`, `grep`, `find` and `ls` only read.
2. Judge a host or client tool by its `BoundTool.effects`, as cofold does; a tool with no effects is treated as one that writes.
3. The modes keep the siblings' meanings: `default` asks on writes, the network or destruction; `acceptEdits` lets an edit inside the working directory through and asks for the rest; `plan` refuses anything that writes or destroys; `auto` asks only about a destructive tool; `bypassPermissions` runs everything; `dontAsk` refuses what `default` would have asked about.
4. A refusal is `{ block: true, reason }` naming the mode, with nobody asked.

## Validation

- `test/agent-pi.test.ts`: for each mode, what `edit` inside and outside the directory, `bash`, `read`, and host tools with `destructive`, `writes` and no effects get: ask, run or refuse.
- The schema shows `permissionMode` with the siblings' six values, and `setConfig` takes it while the session runs.
- `pnpm test`, `pnpm typecheck` green.

## Resume

Built.
`PERMISSION_MODES`, the labels, the descriptions and `modeOf` live in `types.ts`, and `agent.ts` advertises `permissionMode` with them and defaults it to `default`.
`session.ts` decides from the mode: `default` asks on a write, the network or destruction; `acceptEdits` lets a non-destructive write whose `path` resolves under the working directory through; `plan` refuses a write or destruction; `auto` asks only about a destructive tool; `bypassPermissions` runs everything; `dontAsk` refuses what `default` would ask about.
Effects come from the bound tool's `effects`, or from pi's own tools by name, and a tool this session was not told about is treated as one that writes.
A refusal is `{ block: true, reason }` naming the mode, and nobody is asked.
`setConfig` takes a mode and refuses a value that is not one of the six, and `schemaOf` publishes the same control for a session with no host schema.

- `test/agent-pi.test.ts` covers every mode against `edit` inside and outside the directory, `bash`, `read`, and host tools with `destructive`, `writes` and no effects; a refusal naming the mode; the advertised schema and default; and `setConfig` taking a mode.
- `pnpm test` 102 files, 1380 tests; `pnpm typecheck` and `pnpm boundary` green.
