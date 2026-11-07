---
title: The host answers a tool question from a kept approval
created: 2026-11-03
refs:
  - "[code://.project/decisions/the-host-puts-each-tool-question-and-keeps-the-sessions-answer.md](../decisions/the-host-puts-each-tool-question-and-keeps-the-sessions-answer.md) - the decision that keeps the session's answer in its `permissions`"
  - "[code://packages/sdk/src/host/permissions.ts](../../packages/sdk/src/host/permissions.ts) - the options, and how the session's `permissions` answer a question"
  - "[code://packages/agent-claude/src/session/asking.ts#L383-L387](../../packages/agent-claude/src/session/asking.ts#L383-L387) - Claude's options, with an \"always\" only when the SDK suggests one"
  - "[code://packages/agent-cofold/src/mapping.ts#L576-L581](../../packages/agent-cofold/src/mapping.ts#L576-L581) - cofold's options, with \"for this session\""
---

A tool question has one shape in every backend.
The host answers it from an approval it keeps, so the person is not asked again.
An approval is kept at a scope: the host, a project, a team, a person or a session.
The rule `eligibleForAutoApproval: false` still wins over every kept approval.
Source: Softov, 2026-11-03: "as idea we need to normalize a tool call better.
maybe when it ask we could reply. so no question for user.
the way we could save host, project, team, user, session level or something alike. like scope?"

## Today

The [decision](../decisions/the-host-puts-each-tool-question-and-keeps-the-sessions-answer.md) keeps the session's scope.
An Allow in this Session answer is a rule in the session's `permissions`, which a client reads and can change.
The host answers the next question about that tool from it.
Claude, cofold and an ACP agent each also keep an "always" of their own.
An approval kept at the host, a project, a team or a person has no place yet.

## Related

- [host/101](../plans/host/101-a-rule-makes-a-tool-call-ask-every-time/plan.md) - the rule that makes a tool ask every time.
- [host/100](../plans/host/100-terminal-commands-approved-by-rule/plan.md) - the terminal rules, the one kind of approval the host already reads.
