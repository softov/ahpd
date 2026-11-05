---
title: The engine names the template a record runs
status: done
depends: [task-04-an-acp-agent-shows-its-mark.md]
layer: "sdk, agent-acp"
refs:
  - "[code://packages/sdk/src/types/agents.ts](../../../../packages/sdk/src/types/agents.ts) - `Engine`, which gets `templateOf`"
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts) - `iconsOf`, which picks a record's template"
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts) - `optionsOfRecord`, which finds a record's row by its `id` or its `base`"
---

## Objective

A record with no icon shows the icons of the template its engine names.
Softov's ACP records have no `command`, so the match by `command` in task 04 found no template for them.

## Files

- `UPDATE: packages/sdk/src/types/agents.ts` - add `templateOf?(record, templates)` to `Engine`.
- `UPDATE: packages/sdk/src/agents/channel.ts` - ask the engine's `templateOf` first, and match by `command` only when the engine has none.
- `UPDATE: packages/agent-acp/src/plugin.ts` - answer the template of the shipped row for the record's `id`, else for its `base`.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - a case for an engine that names the template whatever the record's command.
- `UPDATE: packages/agent-acp/test/engine.test.ts` - a case for a record by `id`, by `base`, and one that runs no shipped row.
- `UPDATE: docs/plugins/PLUGINS.md` - describe `templateOf` and the agents row's fallback.

## Steps

1. Add `templateOf` to `Engine`, with the record's `id` and `config` and the engine's templates.
2. In `iconsOf`, take the engine's answer when it defines `templateOf`.
3. Match by `config.command` only when the engine has no `templateOf`.
4. In agent-acp, find the shipped row as `optionsOfRecord` does: by `id`, else by `base`.
5. Answer the template whose `name` is that row's name.
6. Add the test cases and the docs.

## Validation

- The new agents channel and agent-acp cases pass.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.
- By hand: Softov's Codex, Gemini and Copilot records show their marks in ahpw, with no edit to the records.

## Resume

- **Done so far:** all steps.
- **Next action:** Softov reviews the PR.
- **Files:** the Files list.
- **Open questions:** none.
- **Departures:** none.
- **Watch out for:** a record whose `id` and `base` name no shipped row shows the engine's icon.
