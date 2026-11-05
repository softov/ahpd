---
title: Every session setting with known values is a picker - implemented
date: 2026-10-30
refs:
  - git://82d7af43
  - "[code://packages/sdk/src/host/sessionconfig.ts](../../../../packages/sdk/src/host/sessionconfig.ts)"
---

A client now draws the Bot chat's bot and an ACP harness's approvals as pickers rather than text boxes. A session's settings come in the order a person fills them in: computer, isolation, branch, then the agent's own. The Bot picker is answered by the backend itself. The ACP list is the one its agent's own source names, until a session hears the server's. One helper orders both folds.

## What was built

- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `Agent.completions`, the answerers for keys of a backend's own schema.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - the `enumDynamic` mark for an answered backend key, the `also` answerers of `seeded`, and `formOrdered`.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the provider's answerer is asked first, and the form comes back in that order.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `completions.bot`, one item per bot, labelled by name.
- [`code://packages/agent-acp/src/presets.ts`](../../../../packages/agent-acp/src/presets.ts) - `AcpPreset.modes`, filled for Codex, Gemini and Qwen with the URL of each agent's own source.
- [`code://packages/agent-acp/src/agent.ts`](../../../../packages/agent-acp/src/agent.ts) - `lastModes`, drawn as the `enum` and `enumLabels` of `permissionMode`.
- [`code://packages/agent-acp/src/session/config.ts`](../../../../packages/agent-acp/src/session/config.ts) - a session that hears its server's modes tells the agent, which replaces the preset's list.

## Verified

- `packages/sdk/test/session-config-answerer.test.ts`, 4 tests: the seed and its mark, the provider match, an answerer that throws, and an undeclared key.
- `packages/bot/test/bot-chat.test.ts`, 17 tests, including the picker's seed, its labels and a query.
- `packages/agent-acp/test/agent-acp-presets.test.ts`, 17 tests, including the row's modes and the text box where a row has none. The whole `packages/agent-acp/test` folder passes, 285 tests.
- `packages/sdk/test/session-config-order.test.ts`, 3 tests. Claude Code's form starts `computer, isolation, branch`, a host with no computer plugin starts `isolation, branch`, and a running session reports the same order.
- `packages/sdk/test/host-sessionconfig.test.ts`, `session-scope.test.ts`, `session-fixed-key.test.ts`, `plugin-host.test.ts`, `host-snapshots.test.ts`, `conformance.test.ts` and `wire.test.ts` pass on the changed folds.
- On 2026-11-04 Softov checked the form in a client: the `Bot` picker lists each bot by its name, and the form order and the ACP approval modes pass.
- `pnpm exec tsc -p tsconfig.json --noEmit` prints nothing.

## Departures from the plan

- Task 03 says to add `modes` only where the agent's own source lists them. Codex, Gemini and Qwen carry one. Every other row carries none, so its approvals stay a text box until a session hears the server's list. Gemini's `plan` is left out, because its server names that mode only where plan mode is enabled.
- The plan's *Final verification checklist* asks for a running host and a client. Those checks are manual and were not run here. The tests cover the same keys without a window.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by the wire suite and left uncommitted, as asked.

## Left for later

- The chat a picked bot opens does nothing. See [the brief](../../../briefs/bot-master-chat.md).
- The remaining ACP rows carry no preset modes: Copilot, OpenCode, Kilo, Goose, Pi, dsh, Devin, Cursor, Amp, Cline and omp.
- Each stays a text box until its first session names its modes.
