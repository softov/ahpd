---
title: ahpd runs on the current cofold release, and keeps no copy of what cofold now ships - implemented
date: 2026-10-09
refs:
  - npm://@cofold/agents@^0.2.1 - the run handle that answers its own pause
  - npm://@cofold/tools@^0.4.0 - `subject`, `writes`, `standardCapabilities`, `TOOLS_SCHEMA` and `requireRead`
  - "[code://packages/agent-cofold/src/pauses.ts](../../../../packages/agent-cofold/src/pauses.ts)"
  - "[code://packages/agent-cofold/src/capabilities.ts](../../../../packages/agent-cofold/src/capabilities.ts)"
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts)"
---

The cofold agent runs on `@cofold/agents` 0.2.1, `@cofold/tools` 0.4.0, `@cofold/store-file` 0.2.1, `@cofold/model-openai-compat` 0.2.0 and `@cofold/commands` 0.3.0, all from the registry.
A paused run is answered and stopped on its own handle, so the pause workaround is gone.
Modes, effort, tool titles, the edited file, the capabilities and the provider config come from cofold, and ahpd keeps no copy of them.
The `tools` option checks against `TOOLS_SCHEMA`, and `strictTools: false` keeps the loose check.
`tools: { files: { requireRead: false } }` turns off cofold's rule that a file is read before it is written.

## What was built

- [`code://packages/agent-cofold/src/pauses.ts`](../../../../packages/agent-cofold/src/pauses.ts) - a pause is answered with the run handle's own `answer`, and a stop goes to the same handle.
- [`code://packages/agent-cofold/src/runs.ts`](../../../../packages/agent-cofold/src/runs.ts) - the run is read to its own `run.finished`, with no synthesized end at a pause.
- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - the modes, their descriptions and the effort levels are cofold's lists.
- [`code://packages/agent-cofold/src/tools.ts`](../../../../packages/agent-cofold/src/tools.ts) - a tool row is titled by the `subject` on `tool.proposed`.
- [`code://packages/agent-cofold/src/turnagent.ts`](../../../../packages/agent-cofold/src/turnagent.ts) - the edited file is `tool.writes(input)`, kept only inside the workspace.
- [`code://packages/agent-cofold/src/capabilities.ts`](../../../../packages/agent-cofold/src/capabilities.ts) - `standardCapabilities` with `exclude`, and `toolsOf` reads `files` as a boolean or `{ requireRead }`.
- [`code://packages/agent-cofold/src/config.ts`](../../../../packages/agent-cofold/src/config.ts) - `HarnessProvider`, `SearchConfig`, `ToolsConfig` and `splitModel` come from cofold.
- [`code://packages/agent-cofold/src/plugin.ts`](../../../../packages/agent-cofold/src/plugin.ts) - the `tools` option is checked against `TOOLS_SCHEMA`, and `strictTools` is the bypass.
- [`code://packages/agent-cofold/README.md`](../../../../packages/agent-cofold/README.md) - the exports, `strictTools` and `requireRead`.

## Verified

- In the review worktree on main `069ea13`: install, schema, build, typecheck and boundary pass, and the suite passes 4648 tests in 263 files.
- The agent-cofold suite is 15 files and 212 cases, and the 25 cases that failed on the new release pass.
- A case edits an unread file with `requireRead: false`, and the edit reports `before` and `after`.
- `rg "owePause|payPause|rejoin|pausing|liveAgent|EDITS|searchProviders|withoutTaken" packages/agent-cofold/src` finds nothing.

## Departures from the plan

- none.

## Left for later

- `apply` records no `endPoint` for a paused run.
- A run stored by cofold 0.1 has no `subject`, so a reopened old session titles its rows by the tool name.
