---
title: cofold and pi take the connectors that serve models
created: 2026-11-05
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L418](../../packages/sdk/src/types/connectors.ts#L418) - `provider(connector)`: a connector that serves models hands the host its endpoint and key"
  - "[code://packages/agent-claude/src/plugin.ts#L125-L135](../../packages/agent-claude/src/plugin.ts#L125-L135) - Claude's `logins`, which take claude-login connectors by id"
---

A Claude record has `logins`: the claude-login connectors it runs on, in the order a turn tries them.
cofold and pi could take the same kind of list, of the connectors that serve models: openai, anthropic, openrouter and openai-compatible.
A connector already holds the endpoint, the key in the vault and the model list.
So a record would name a connector in place of a `baseUrl`, an `apiKey` and a model list of its own.
A connector with a sign-in, as OpenRouter's has and [the Anthropic login brief](../briefs/the-anthropic-connector-signs-in-like-claude-login.md) proposes, gives them a login with no key typed.
Softov asked for it on 2026-11-09, for the anthropic, openrouter, openai and openai-compatible connectors.
This covers the blue circles of pi's `baseUrl`, `apiKey` and `models` in [the agent settings brief](../briefs/agent-settings-at-plugin-and-record.md).
