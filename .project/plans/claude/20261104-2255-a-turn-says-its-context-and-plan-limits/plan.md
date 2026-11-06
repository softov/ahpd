---
title: A turn says its context and its plan limits
domain: claude
status: built
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://0a4d89c7 - the commit of ahpd the facts were checked at
  - https://github.com/ahpio/ahpw/blob/68080e1/.project/briefs/a-session-shows-its-context-and-plan-usage.md - the brief this plan covers, in ahpw, with the client side
  - "[code://packages/agent-claude/src/session/parts.ts#L187-L200](../../../../packages/agent-claude/src/session/parts.ts#L187-L200) - `costOf`, which reads each result's `modelUsage`"
  - "[code://packages/agent-claude/src/session/query.ts#L972](../../../../packages/agent-claude/src/session/query.ts#L972) - each `rate_limit_event` goes to `limited`, which keeps only a refusal"
  - "[code://packages/agent-claude/src/claude.ts#L513-L524](../../../../packages/agent-claude/src/claude.ts#L513-L524) - `probe` and `probeChanged`, how the agent's models reach the host"
  - "[code://packages/sdk/src/types/probe.ts#L44-L52](../../../../packages/sdk/src/types/probe.ts#L44-L52) - a probed model's `maxContextWindow`, which no Claude model fills"
  - "[code://packages/agent-claude/src/logins.ts#L200-L209](../../../../packages/agent-claude/src/logins.ts#L200-L209) - `called`, how a login's call reaches the connector's health"
  - "[code://packages/agent-claude/src/plugin.ts#L180-L184](../../../../packages/agent-claude/src/plugin.ts#L180-L184) - `onCall`, which sends `x-ahpd/connectors/note`"
  - "[code://packages/sdk/src/connectors/channel.ts#L564-L576](../../../../packages/sdk/src/connectors/channel.ts#L564-L576) - `note`, which keeps a call in the connector's health, in memory"
  - "[code://packages/sdk/src/types/connectors.ts#L251-L259](../../../../packages/sdk/src/types/connectors.ts#L251-L259) - `ConnectorHealth`, the pattern for what the host knows of a connector while it runs"
  - "[code://packages/agent-acp/src/mapping.ts#L557-L558](../../../../packages/agent-acp/src/mapping.ts#L557-L558) - `ahpd.context`, the key ACP already puts on a turn's usage"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `Query.getContextUsage()`, `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`, `SDKRateLimitInfo` and `ModelUsage.contextWindow`, in `sdk.d.ts`
  - https://github.com/microsoft/vscode/blob/289eaeb2b9d3eaa4b7f2bcb68acb0f4e22a8d5a9/src/vs/platform/agentHost/common/meta/vscode/agentUsageMeta.ts#L106-L160 - `UsageInfoMeta`: `quotaSnapshots` and `contextAttribution`, the shapes this plan sends
  - https://github.com/microsoft/vscode/blob/289eaeb2b9d3eaa4b7f2bcb68acb0f4e22a8d5a9/src/vs/platform/agentHost/common/state/sessionState.ts#L279-L297 - `IContextAttributionData` and its entries
  - https://github.com/microsoft/vscode/blob/289eaeb2b9d3eaa4b7f2bcb68acb0f4e22a8d5a9/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L964-L1050 - the entry kinds VS Code's context widget reads
---

## Goal

A Claude session says what fills its context window, and how much of its login's plan limits is used.
ahpw then draws a Usage view with both parts, and VS Code draws the context part with its own widget.
Today a Claude turn sends neither, and a Claude model has no context window, so ahpw shows no context figure at all.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "maxContextWindow|contextWindow" packages/agent-claude/src` - nothing; only pi fills a model's window.
- `rg -n "getContextUsage|rate_limit_info|utilization" packages/agent-claude/src` - only `limited`, which keeps a refusal.
- `rg -n "connectors/note" packages` - agent-claude notes each login call in the connector's health.

### Runtime path

```
result.modelUsage.contextWindow -> learned limit by model -> probe -> maxContextWindow
result -> getContextUsage({ detail: 'summary' }) -> turn usage _meta: contextAttribution, ahpd.context
rate_limit_event + usage request -> plan limits by login -> turn usage _meta.quotaSnapshots
                                                          -> connectors/note -> health.quotaSnapshots
```

### Gaps

- No Claude model has a `maxContextWindow`, though each result names the model's `contextWindow`.
- A turn's usage has no breakdown of its context.
- No plan limit leaves agent-claude, and a connector's health has no place for one.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The breakdown and the plan limits ride `_meta` with VS Code's keys, `contextAttribution` and `quotaSnapshots` | Softov, 2026-11-04, brief Answers | 01, 02 |
| `getContextUsage` runs with `detail: 'summary'` after each turn | Softov, 2026-11-04, "Summary" | 01 |
| The free space, the autocompact buffer and the deferred tools go in `ahpd.context` | Softov, 2026-11-04, brief Answers | 01 |
| The plan limits come from `rate_limit_event`, and from the usage request after a turn at most once a minute for each login, with `skip_behaviors` | Softov, 2026-11-04, brief Answers | 02 |
| A model's limit is learned from `modelUsage.contextWindow` and kept in memory | (defaulted: the SDK's model list has no limit, and every result has it) | 01 |
| The bar's size is the autocompact window, `raw_max_tokens`; the model's limit is apart from it | Softov, 2026-11-04, "that 500k was the /autocompact" | 01 |
| The plan limits are kept in the connector's health, in memory, as the last call is | (defaulted: the sibling pattern) | 02 |
| An empty `quotaSnapshots` means the account has no plan limits, as `accountInfo()` says; an absent one means unknown | Softov, 2026-11-04, review: a `claude-login` showed `{}` | 02, 03 |
| A session's `_meta` holds its context, plan limits and plan from the handshake, before any turn | Softov, 2026-11-04, "Add it to this branch" | 03 |
| `ahpd.account` holds only `subscriptionType` and `apiProvider`; no email or organization leaves the host | Softov, 2026-11-04, "Plan type and provider only" | 03 |
| A `claude-login`'s limits still come with its first response; its token has no profile scope | Softov, 2026-11-04, no choice taken on the alternatives | - |
| A late or failed breakdown leaves the turn's usage without it | (defaulted: a turn never waits on a figure) | 01 |
| A session on the CLI's own sign-in keeps its plan limits for itself; only a login's limits reach the connector's health | (defaulted in review: the CLI's own account has no id the host holds) | 02 |
| A note with only `quotaSnapshots` records no call | (defaulted in review: a call that never happened is not a last call) | 02 |
| `extra_usage` rides the weekly snapshot, or the session one when there is no week | (defaulted in build: VS Code's shape has no window for credits) | 02 |
| The plan limits of Codex and Copilot wait for a later brief | Softov, 2026-11-04, brief Answers | - |

## Proposed architecture

- **Data flow** - a turn's usage `_meta` gains `contextAttribution`, `ahpd.context` and `quotaSnapshots`. A connector's health gains `quotaSnapshots`.
- **State flow** - agent-claude keeps the learned limit of each model and the last plan limits of each login, in memory.
- **Layer responsibilities** - agent-claude: read the CLI and map to the keys · sdk: keep a login's limits in the connector's health · clients: draw them.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) · [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a turn says its context](task-01-a-turn-says-its-context.md) | done | - |
| [02 - a login says its plan limits](task-02-a-login-says-its-plan-limits.md) | done | - |
| [03 - a session says them before a turn](task-03-a-session-says-them-before-a-turn.md) | done | 01, 02 |

## Risks and tradeoffs

- The usage request is experimental, and its method name will change. One function reads it, and a missing method means no full answer, not a failure.
- `modelUsage` is keyed by the model string the CLI used, which can differ from a model row's id. Match on `resolvedModel` and `canonicalModel`.
- A restart clears the plan limits, as it clears a connector's health. The next turn on the login fills them again.

## Resume state

- **Done so far:** tasks 01, 02 and 03: a turn says its context, a login its plan limits, and a session both before a turn.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Watch out for:** a turn must not wait on `getContextUsage`; put a short time limit on it.

## Final verification checklist

- [ ] A Claude model row has a `maxContextWindow` after a turn on that model.
- [x] A Claude turn's usage has `contextAttribution` with entries, and `ahpd.context` with the window, the limit, the free space, the buffer and the deferred tools.
- [x] A Claude turn on a login with a plan has `quotaSnapshots` with `session` and `weekly`, and the connector's health has the same.
- [x] A Claude session's `_meta` has its context, plan limits and plan before its first turn, and a login's health has its `account`.
- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk and agent-claude tests pass.
