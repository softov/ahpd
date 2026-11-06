---
title: configure keeps one pi
status: done
depends: []
layer: server
refs:
  - "[code://packages/server/src/commands/configure.ts#L133-L150](../../../../packages/server/src/commands/configure.ts#L133-L150) - `takePreset`, the pattern for a helper that removes a preset"
  - "[code://packages/server/src/commands/configure.ts#L172-L211](../../../../packages/server/src/commands/configure.ts#L172-L211) - the questions to change"
  - "[code://packages/sdk/src/plugins/plugins.ts#L384](../../../../packages/sdk/src/plugins/plugins.ts#L384) - the clash line"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts) - the cases to extend"
---

## Objective

`ahpd configure` sets up the native pi backend or the ACP `pi` preset, never both.
The clash line at start tells the person to run `ahpd configure` to keep one.

## Files

- `UPDATE: packages/server/src/commands/configure.ts` - skip the ACP `pi` question after a yes to native pi, and offer to remove a `pi` preset the file has.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:384` - end the clash line with what to do.
- `UPDATE: packages/server/test/server-configure.test.ts` - cases for each step below.
- `UPDATE: packages/sdk/test/plugin-host.test.ts:647` - the new end of the clash line.

## Steps

1. Add `dropPreset(list, id)` beside `takePreset`, which removes one preset from the `@ahpd/agent-acp` entry and keeps every other option.
2. After the backend questions, note whether the answer for `@ahpd/agent-pi` was yes.
3. In the loop over found ACP agents, skip the agent `pi` when native pi is on, and print `pi-acp: not asked, the pi backend runs pi`.
4. When native pi is on and the file has the `pi` preset, ask `Remove the ACP pi preset? It clashes with the pi backend.` with default yes.
5. On yes, apply `dropPreset(plugins, 'pi')`, and on no, leave the file as it is.
6. When native pi is off, ask about the ACP `pi` preset as now.
7. End the clash line with `; run ahpd configure to keep one`.
8. Add a configure case for a yes to native pi with `pi-acp` on the PATH, and expect no `pi-acp` question.
9. Add a case for a file with both, and expect no preset after yes and the preset after no.
10. Add a configure case for a no to native pi, and expect the ACP `pi` question.
11. Update the clash line in the plugin test.
12. Run the server and sdk tests, and set this task and the plan row to `implemented`.

## Validation

- The server and sdk tests pass from the repository root.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `configure.ts` has `dropPreset` and `hasPreset` beside `takePreset`. A yes to the native pi backend skips the ACP `pi` agent and says `pi-acp: not asked, the pi backend runs pi`. A file that names both gets the question `Remove the ACP pi preset? It clashes with the pi backend.`, and a yes drops the preset while keeping the entry's other options. The clash line ends with `; run ahpd configure to keep one`. `server-configure.test.ts` passed 36 of 36, and `plugin-host.test.ts` passed 22 of 22. From the repository root, `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` passed, and the full suite passed 6474 tests with 29 skipped (387 files passed, 1 skipped).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the native questions come before `findAgents`, so the answer is known when the ACP loop runs. Only `pi` is special-cased, because no other ACP preset has the name of a native backend.
