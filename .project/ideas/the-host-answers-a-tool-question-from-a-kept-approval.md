---
title: The host answers a tool question from a kept approval
created: 2026-11-03
refs:
  - "[code://.project/decisions/each-backend-offers-its-options-unless-a-rule-asks.md](../decisions/each-backend-offers-its-options-unless-a-rule-asks.md) - the decision this would change: the host remembers no approval"
  - "[code://packages/sdk/src/host/spawn.ts#L929-L981](../../packages/sdk/src/host/spawn.ts#L929-L981) - `getAutoApproval`, the one check every backend asks before a tool call"
  - "[code://packages/agent-claude/src/session/asking.ts#L383-L387](../../packages/agent-claude/src/session/asking.ts#L383-L387) - Claude's options, with an \"always\" only when the SDK suggests one"
  - "[code://packages/agent-cofold/src/mapping.ts#L576-L581](../../packages/agent-cofold/src/mapping.ts#L576-L581) - cofold's options, with \"for this session\""
---

A tool question has one shape in every backend.
The host answers it from an approval it keeps, so the person is not asked again.
An approval is kept at a scope: the host, a project, a team, a person or a session.
Today each backend has its own "always".
Claude keeps the SDK's suggestion, cofold keeps a session choice, an ACP agent keeps its own, and pi has none.
So the same tool asks again when the backend changes, and the person cannot see or remove what was allowed.
The rule `eligibleForAutoApproval: false` still wins over every kept approval.
Source: Softov, 2026-11-03: "as idea we need to normalize a tool call better. maybe when it ask we could reply. so no question for user. the way we could save host, project, team, user, session level or something alike. like scope?"

## Today

The [decision](../decisions/each-backend-offers-its-options-unless-a-rule-asks.md) says the host remembers no approval, and that a host-kept approval waits for a store for workspace state.
`getAutoApproval` already runs before every tool call in every backend, so it is where a kept approval would answer.

## Related

- [host/101](../plans/host/101-a-rule-makes-a-tool-call-ask-every-time/plan.md) - the rule that makes a tool ask every time.
- [host/100](../plans/host/100-terminal-commands-approved-by-rule/plan.md) - the terminal rules, the one kind of approval the host already reads.
