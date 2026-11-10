---
title: A host cannot report how full a chat's context window is
target: https://github.com/microsoft/agent-host-protocol
date: 2026-11-10
refs:
  - file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatContextUsageWidget.ts#L412-L429 - the widget takes `inputTokens + outputTokens` as used and the model's window as total, unless `contextUsage` is set
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/agentUsageMeta.ts#L56-L57 - `contextUsage` comes only from Copilot's `copilot.usageInfo`, and never when the usage carries `contextAttribution`
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/copilotd/copilotdMetadataReader.ts#L128-L148 - the shape of `copilot.usageInfo`
  - file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L928 - `promptTokens` is `UsageInfo.inputTokens`
  - https://github.com/microsoft/agent-host-protocol/blob/0e079ec7/types/common/state.ts#L413-L427 - `UsageInfo` as it is today
  - https://github.com/microsoft/agent-host-protocol/issues/522 - the last usage proposal, closed as not actionable because it named no field
---

Evidence read at VS Code `171e90619c72` and the protocol repository `0e079ec7`.
The issue text starts at *Summary*.
It names one field, because #522 asked for requirements without a field and was closed as not actionable.

**Title:** Proposal: report how full a chat's context window is

## Summary

A host can know how many tokens a chat's context holds, and the window the agent runs it at.
AHP has no field for either.
`UsageInfo` reports what a turn consumed, and `SessionModelInfo.maxContextWindow` reports the model's limit.
Neither is the context fill, so a client that shows a context indicator has to infer it, and the inference is wrong for common providers.

## Scenario

A Claude Code session on a model with a 1M limit, with prompt caching on.
After a short turn:

- The latest model call used 2 uncached input tokens, 32,828 cache-write tokens and 103 output tokens.
- The agent reports 33k tokens in context, in a 200k window. Claude Code runs this chat at 200k although the model allows 1M, and it compacts automatically inside that 200k.

VS Code shows **105 / 1M tokens, 0%**.
It takes `inputTokens + outputTokens` from the turn's usage as the used count ([chatContextUsageWidget.ts#L428](https://github.com/microsoft/vscode/blob/171e90619c72/src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatContextUsageWidget.ts#L428)), and `maxContextWindow` as the window.
Each value is correct for what it measures, but neither is the context fill:

- `inputTokens` follows the provider's convention. Anthropic's count leaves out cached tokens, so a fully cached prompt reads as 2 tokens.
- A turn's usage adds up every model call in the turn. Ten tool calls on a 30k prompt read as about 300k.
- The window the agent runs at can be smaller than the model's limit. Examples: Claude Code at 200k on a 1M model, or Codex with a configured context size.

## AHP today

VS Code has a direct path for this figure (`contextUsage { currentTokens, tokenLimit }`).
It reads it only from Copilot's session key `_meta['copilot.usageInfo']`, and skips it whenever the turn's usage carries `contextAttribution` ([agentUsageMeta.ts#L56-L57](https://github.com/microsoft/vscode/blob/171e90619c72/src/vs/platform/agentHost/common/meta/agentUsageMeta.ts#L56-L57)).
Another host can only use it by writing Copilot's private key and dropping the context breakdown.

## Proposal

Add one optional field to `UsageInfo`:

```ts
export interface UsageInfo {
  // existing fields unchanged
  /** How full the chat's context window is as of this report. */
  context?: ContextUsage;
}

export interface ContextUsage {
  /** Tokens in the context window after the latest model call: its whole prompt, cached or not, plus its output. */
  usedTokens: number;
  /** The window the agent runs this chat at. At most the model's `maxContextWindow`, and can be less. */
  windowTokens: number;
}
```

- `context` is a snapshot. A later report replaces it, and it is never added up across calls or turns.
- If `context` is absent, the fill is unknown, and clients keep their current fallback.
- A host that compacts reports the figure after compaction.

## Compatibility

The field is additive and optional, so it needs no capability flag.
An old client ignores it, and a new client falls back when it is absent.
VS Code could read `usage.context` instead of `copilot.usageInfo`, and Copilot's host could write it too.

## Open questions

- Should `ContextUsage` also say where automatic compaction starts (Claude Code keeps a buffer inside the window), so clients can show it?
- Should `inputTokens` be defined to include cached tokens? That is outside this proposal, but it is why the current fallback misreads Anthropic usage.
