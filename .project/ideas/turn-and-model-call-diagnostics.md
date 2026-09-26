---
title: Turn and model-call diagnostics
created: 2026-09-26
---

VS Code's host records two kinds of diagnostics this host does not. The turn tracker (`src/vs/platform/agentHost/node/agentHostTurnTracker.ts`, with `agentSideEffects.ts:852-857,1967-2010` and `agentHostTelemetryReporter.ts`) logs turn ordinals, process age, send-stage durations and time to first substantive progress; it is logged, never sent to a client. `_meta['vscode.modelCall']` (`src/vs/platform/agentHost/common/meta/agentModelCallMeta.ts:9`) stamps per-model-call diagnostics on a response, from the Copilot session only, and no renderer in the tree reads it today.

This host already writes an OTLP log (`test/otlp.test.ts`), which is where the turn timings would go: one span per turn with the send stages as events. The model-call stamp is cheap for the Claude backend, which sees each API call as `message_start` to `message_stop` with usage on `message_delta`, but it has no reader, so it waits until a client draws it.
