---
title: ACP approvals list the known modes
status: done
depends: []
layer: agent-acp
refs:
  - "[code://packages/agent-acp/src/presets.ts#L29-L71](../../../../packages/agent-acp/src/presets.ts#L29-L71) - `AcpPreset`, which gains the modes"
  - "[code://packages/agent-acp/src/agent.ts#L60-L87](../../../../packages/agent-acp/src/agent.ts#L60-L87) - the schema, whose `permissionMode` has no `enum`"
  - "[code://packages/agent-acp/src/session/config.ts#L42-L45](../../../../packages/agent-acp/src/session/config.ts#L42-L45) - where a session hears the server's modes"
  - "[code://packages/agent-acp/src/session/config.ts#L185-L200](../../../../packages/agent-acp/src/session/config.ts#L185-L200) - the `enum` and `enumLabels` a running session draws, the shape to copy"
---

## Objective

An ACP harness lists approval modes before its first session.
The list is the preset's, until a session of that harness names the server's own modes.

## Files

- `UPDATE: packages/agent-acp/src/presets.ts:29-71` - `AcpPreset` gains `modes?: { id: string; name: string }[]`, filled for each agent whose modes are found.
- `UPDATE: packages/agent-acp/src/agent.ts:60-87` - the schema gives `permissionMode` an `enum` and `enumLabels` from the known modes.
- `UPDATE: packages/agent-acp/src/session/config.ts:42-45` - a session that hears modes tells its agent.
- `UPDATE: packages/agent-acp/test/agent-acp-presets.test.ts` - the cases below.
- `UPDATE: docs/plugins/agent-acp.md` - where the Approvals list comes from.

## Steps

1. Find each preset agent's ACP modes in its own source or documentation, and note the URL in a code comment.
2. Add `modes` to each preset whose modes you found, with the server's ids and names.
3. Leave out `modes` for an agent whose modes you did not find.
4. Keep `lastModes` in the agent, set from `options.modes` at the start.
5. Give the agent a callback that a session calls with `availableModes` when it hears them.
6. In `schema()`, add `enum` and `enumLabels` to `permissionMode` when `lastModes` has any.
7. Give `permissionMode` no `enum` when the agent knows no modes.
8. Document the source of the list in `docs/plugins/agent-acp.md`.

## Validation

- A harness with preset modes gives `permissionMode` an `enum` before any session.
- A session that hears other modes changes the next `schema()` to those modes.
- A harness with no preset modes gives `permissionMode` with no `enum`.
- `pnpm -s typecheck` passes, and the agent-acp tests pass.

## Resume

Implemented 2026-10-30.
`AcpPreset` has `modes`, filled for the three agents whose own source lists their modes.
Codex reads from its adapter's `AgentMode` class, and Gemini from `buildAvailableModes` without the conditional `plan`.
Qwen reads from its `APPROVAL_MODE_INFO`.
Each row names its URL in a comment on the list.
`AcpOptions.modes` carries the row's list through `optionsOfRecord`, and `acpAgent` keeps it in `lastModes`. `schema()` draws `lastModes` as the `enum` and `enumLabels` of `permissionMode`, and no `enum` when it has none.
A session calls the callback `acpSession` was given with the `availableModes` its server named, and the next `schema()` lists those instead. The list lives in memory, as *Answers* says, so a restart is back to the row's list.
Every other preset carries no `modes`, because no source for its modes was found.
Its `permissionMode` stays a text box until a session of that agent hears the server's own list.
`packages/agent-acp/test/agent-acp-presets.test.ts` covers the row's list, the text box where a row has none, and the replacement by a session's modes. `docs/plugins/agent-acp.md` says where the list comes from.
