---
title: VS Code shows the Claude context figure
created: 2026-11-14
refs:
  - git://a8378a171 - the commit of ahpd the facts were checked at, before #331
  - "[code://packages/agent-claude/src/session/query.ts#L953-L961](../../packages/agent-claude/src/session/query.ts#L953-L961) - `usageMeta`: the session's `_meta` carries `contextAttribution` and `ahpd.context`"
  - "[code://packages/agent-claude/src/session/query.ts#L1376-L1390](../../packages/agent-claude/src/session/query.ts#L1376-L1390) - a turn's usage carries `contextAttribution` and `ahpd.context` too"
  - "[code://packages/agent-claude/src/session/contextusage.ts#L105-L180](../../packages/agent-claude/src/session/contextusage.ts#L105-L180) - `contextOf`: the figure from the CLI's `getContextUsage` answer"
  - "[code://packages/agent-claude/test/agent-claude-context.test.ts#L280-L300](../../packages/agent-claude/test/agent-claude-context.test.ts#L280-L300) - the case that expects the breakdown on a turn's usage"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatContextUsageWidget.ts#L422-L428 - the widget's figure is the reported total, or the turn's input plus output tokens
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L945-L966 - `promptTokens` is the turn's `inputTokens`, and the breakdown comes from the turn's `contextAttribution`
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/meta/agentUsageMeta.ts#L37-L58 - `readAgentContextUsage`: no reported total while the turn's usage has `contextAttribution`
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/meta/copilotd/copilotdMetadataReader.ts#L101-L148 - `readCopilotContextUsage`: the session's `_meta['copilot.usageInfo']` and its rules
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts - VS Code's own Claude agent sends the result's `input_tokens` and no total
---

# VS Code shows the Claude context figure

Softov's goal: VS Code, as a client of ahpd, shows the same context figure for a Claude session as ahpw does.

## What Softov saw on 2026-11-14

- In a Claude session on ahpd, ahpw showed 35k of 200k after a compaction. VS Code showed 5 of 1M for the same session.
- Before the compaction, ahpw showed 302k and VS Code showed 7.1K.
- The turn line in ahpw said `↑2 ↓3`. VS Code's 5 is 2 plus 3.

## What others do

- VS Code's widget takes `copilot.usageInfo.currentTokens` from the session's `_meta` when a host sends it. Without it, the figure is the last turn's `inputTokens` plus `outputTokens`.
- The Copilot daemon's sessions send `copilot.usageInfo`: `currentTokens`, `tokenLimit` and `messagesLength`, and optionally `conversationTokens`, `systemTokens` and `toolDefinitionsTokens`.
- VS Code reads it only where the last turn's usage has no `contextAttribution`. It reads it again when the session's state changes.
- VS Code's own Claude agent sends neither key. Its turn's `inputTokens` is the result's `input_tokens`, which leaves out cache reads and cache writes. So it shows the same small figure.
- VS Code uses `messagesLength` only to check the key. It shows the three optional counts only in its debug view.

## What ahpd has today

- agent-claude asks the CLI with `getContextUsage` and keeps the answer as `contextAttribution` and `ahpd.context`.
- It puts both keys on the session's `_meta` and on each turn's usage.
- `inputTokens` on a turn is Anthropic's `input_tokens`, as in VS Code's own Claude agent.
- Only agent-claude writes `contextAttribution` in ahpd. ahpc and ahpapp do not read it.
- ahpw lays the session's `_meta` over the last turn's (`sessionUsage` in `src/bridges/usage-meta.ts` at ahpw `c9120aa`). So ahpw reads both keys from the session.

## Who writes

- #331 changes `query.ts` near `usageMeta` and adds the asks during a turn. This change goes after #331, and both use `usageMeta` and `sayMeta`.
- No other branch or open PR changes agent-claude's usage keys.

## Answers

| Question | Answer | Date |
| --- | --- | --- |
| How VS Code gets the total | agent-claude sends `copilot.usageInfo` on the session's `_meta`, and puts `contextAttribution` only on the session's `_meta`, not on a turn's usage | 2026-11-14 |
| `tokenLimit` | (defaulted: the figure's `size`, so VS Code shows the window ahpw shows) | 2026-11-14 |
| `messagesLength` | (defaulted: the number of turns the session holds, because VS Code shows it nowhere) | 2026-11-14 |

## The change

- The session's `_meta` carries `copilot.usageInfo` beside `contextAttribution` and `ahpd.context`.
- `currentTokens` is the figure's `used`. `tokenLimit` and `messagesLength` are as *Answers* says.
- A turn's usage keeps `ahpd.context`, the cost and the plan limits, and no longer carries `contextAttribution`.
- VS Code then shows the CLI's total and the same window as ahpw, and it shows no breakdown lines.
- The case that expects `contextAttribution` on a turn's usage changes to expect it on the session.
