---
title: create_session names the agents
status: implemented
depends:
  - task-02-list-agents-and-list-models.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L506-L530](../../../../packages/sdk/src/tools/session.ts#L506-L530) - `create_session` and its `agent`"
---

## Objective

`create_session`'s `agent` input is an enum of the agents the caller may start, with each agent's name in its description, built for each caller.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:506-530` - the `agent` input, built per caller.
- `UPDATE: packages/sdk/test` - the case of the enum.

## Steps

1. Build `create_session`'s definition for each caller, as the host builds the sessionless tools for each caller.
2. Set `agent.enum` to the caller's agent ids.
3. Name each agent in the input's description, as `<id>: <name>`, one per line.
4. Say in the description that `list_models` names an agent's models.
5. Keep the refusal of an id that is not in the enum.

## Validation

- Two callers with different agents see different enums.
- `pnpm typecheck`, then the sdk and server suites.

## Resume

Implemented 2026-11-10. `create_session` keeps one base definition (`CREATE_SESSION`) and a `forSession` that, given the caller's agents, replaces its `agent` input with an enum of their ids and a description naming each as `<id>: <name>`, one per line, ending with `list_models` names the models each agent offers. `ToolSession` gains `agents`, which `toolSession(uri)` fills from the session's owner and `sessionlessTools(caller)` from the caller, so a session and a window name the same agents; the run's refusal reads `at.agents()` rather than every provider, so the ids it accepts are the enum's. A case in `packages/sdk/test/sessiontools.test.ts` gives two people who both hold `session:write` one agent each and checks the two enums differ, the daemon's holds both, the lines and the `list_models` sentence, and the refusal of the agent left out; `packages/server/test/mcp.test.ts` now expects nine session tools for a member and four for a viewer. Gates: typecheck clean, sdk suite green but for the eight git/filesystem cases the prescribed `TMPDIR` inside the worktree breaks, the server suite green but for fourteen `control`, `join`, `plugin-live`, `plugins-channel` and `server-cli-start` cases that the same `TMPDIR` breaks (all pass with `TMPDIR` outside the repository), and `mcp.test.ts` 19 passed.

