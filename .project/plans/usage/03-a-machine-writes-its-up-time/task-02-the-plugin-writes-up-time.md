---
title: The computer plugin writes up time
status: done
depends: [task-01-a-machine-knows-its-creator.md]
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts) - the plugin API, where the recorder goes"
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - `ComputerTime`"
---

## Objective

The plugin API gains a way to write a usage record that goes to the host's `usage` port, or nowhere when there is none, shaped like the API's other host-provided members.
The computer plugin keeps an open stretch per running machine: opened when it starts (or, at daemon start, for each machine already running), closed when it stops, is removed, or the plugin is stopped.
Closing writes `{ kind: 'computer', source: 'computer', at: <stretch start>, seconds, computer: <id>, owner, team, project, pools }`, with `owner` from the machine's label or `root:<host>`, and pools as decision `agent-usage-is-charged-to-owner-team-and-project-pools` says.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts`, `packages/sdk/src/plugins.ts` - the recorder.
- `UPDATE: packages/computer/src/plugin.ts` (and the runtimes) - the stretches.
- `UPDATE: docs/PLUGINS.md` - the recorder, and `registerUsage` which is not listed yet.
- `UPDATE: .project/plans/usage/00-usage.md` - the runtime path.

## Validation

- `packages/computer/test/`: start then stop writes one record with the right seconds, owner and pools; plugin stop closes open stretches; a running machine at start opens one and a stopped one does not; a relay container is charged to whoever connected; an unowned machine is `root:<host>`; no usage port writes nothing.

## Resume
