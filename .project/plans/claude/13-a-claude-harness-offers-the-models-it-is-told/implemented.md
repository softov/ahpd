---
title: A Claude harness offers the models it is told - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-claude/src/models.ts](../../../../packages/agent-claude/src/models.ts)"
---

agent-claude takes `models`, a list of model ids, named models and fetches from an endpoint's model list filtered by a pattern, offered in place of the CLI's list, or beside it with `keepCliModels`; without it the CLI's list is offered as before.

## What was built

- [`code://packages/agent-claude/src/models.ts`](../../../../packages/agent-claude/src/models.ts) - the entry shapes and their check, the fetch (OpenAI-shaped `data`, an optional bearer from a daemon variable), and the merge.
- `claude.ts` runs the probe's list through it and hands sessions the same merge, which a session applies to the list its handshake reports; the named models are fetched once per harness.
- `plugin.ts` and the manifest take `models` and `keepCliModels`; a malformed entry fails the load. The README documents both, with the OpenRouter example.

## Verified

- `packages/agent-claude/test/agent-claude-models.test.ts` (written ids, a filtered fetch with its key, a failed fetch, replace and add, malformed entries) and a session case in `agent-claude-presets.test.ts`.
- OpenRouter's public list (464 models) has `stealth/space-bunny-alpha` under `stealth/*`.
- `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm test` 139 files, 2076 tests passed.

## Departures from the plan

- None.
