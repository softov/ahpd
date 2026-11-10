---
title: The Claude agent's view follows its record and names its sign-in
created: 2026-11-09
refs:
  - git://408a4b8a2 - the commit of ahpd the facts were checked at
  - "[code://packages/agent-claude/src/logins.ts#L264-L284](../../packages/agent-claude/src/logins.ts#L264-L284) - `agentOpened` draws the view once, and `showAgent` sets its logins"
  - "[code://packages/agent-claude/src/logins.ts#L416-L423](../../packages/agent-claude/src/logins.ts#L416-L423) - `shown`, the only caller of `showAgent`: a login's plan answer"
  - "[code://packages/agent-claude/src/views.ts#L126-L128](../../packages/agent-claude/src/views.ts#L126-L128) - `agentDataOf` lists only the `claude-login` connectors that the record's `logins` names"
  - "[code://packages/sdk/src/agents/channel.ts#L42-L44](../../packages/sdk/src/agents/channel.ts#L42-L44) - an edit updates the record in place, and does not open the agent again"
  - "[code://packages/agent-claude/src/probe.ts#L37-L50](../../packages/agent-claude/src/probe.ts#L37-L50) - `accountOf` reads the CLI's account: `apiKeySource`, `apiProvider`, `email` and `subscriptionType`"
  - "[code://packages/agent-claude/src/logins.ts#L73-L79](../../packages/agent-claude/src/logins.ts#L73-L79) - `BEFORE_TOKEN`, the variables the CLI signs in with before a login's token"
  - https://code.claude.com/docs/en/authentication#authentication-precedence - the order the CLI picks its credential in
---

# The Claude agent's view follows its record and names its sign-in

Softov checked the Claude resume on 2026-11-09, and found two gaps in the Claude agent's view in ahpw. After he saves the agent's settings, the view does not show the account again, as it does when the agent starts. The view also does not say what the agent signs in with: the CLI's own login, a key in its environment, or a `claude-login` connector.

## What others do

- The Claude CLI picks one credential in a fixed order, and reports the one it took. A cloud provider and the environment's key and token come first, then the login ([authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)).
- The devtunnel plugin shows its account on its connector, with the same view structure as agent-claude.

## What ahpd has today

- `agentOpened` draws the agent's view when the agent opens ([`code://packages/agent-claude/src/logins.ts`](../../packages/agent-claude/src/logins.ts#L264-L284)).
- An edit of the record does not open the agent again. The host updates the record in place, and the next turn reads it ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L42-L44)).
- The view's logins change only when a login's plan answer arrives ([`code://packages/agent-claude/src/logins.ts`](../../packages/agent-claude/src/logins.ts#L416-L423)). So a login added in an edit does not show, and a removed one stays, until that answer.
- The view lists only the `claude-login` connectors that `logins` names ([`code://packages/agent-claude/src/views.ts`](../../packages/agent-claude/src/views.ts#L126-L128)). An agent on the CLI's own login or on `ANTHROPIC_API_KEY` shows an empty view.
- The probe already reads what the CLI reports: `apiKeySource`, `apiProvider`, `email` and `subscriptionType` ([`code://packages/agent-claude/src/probe.ts`](../../packages/agent-claude/src/probe.ts#L37-L50)).

## Who writes

- PR #268, a Claude folder that is watched once, changes `packages/agent-claude/src/session/watch.ts` and its test. It does not touch `logins.ts`, `views.ts` or `probe.ts`.
- No other open PR or plan touches the Claude agent's view.

## The change

- An edit of a Claude agent's record draws the agent's view again, with the logins the record names now.
- The view says what the agent signs in with, as one of these:
  - the CLI's own login, with its email and plan;
  - a key or a token in the environment;
  - a cloud provider;
  - its `claude-login` connectors.

## Open points

- How agent-claude hears an edit: a call from the agents channel on each put, or a check of the record at the next turn.
- Whether the source is read from the probe at the agent's start, or from the account of each turn.
