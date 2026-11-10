---
title: The Anthropic connector signs in as a Claude login does
created: 2026-11-09
refs:
  - git://cb74ca9c2 - the commit of ahpd the facts were checked at
  - "[code://packages/agent-claude/src/adapter.ts#L150-L256](../../packages/agent-claude/src/adapter.ts#L150-L256) - the `claude-login` adapter: a `token`, a check, and a sign-in on claude.ai"
  - "[code://packages/agent-claude/src/adapter.ts#L28-L33](../../packages/agent-claude/src/adapter.ts#L28-L33) - the sign-in's URLs and client id, which are Claude Code's own"
  - "[code://packages/agent-claude/src/adapter.ts#L102](../../packages/agent-claude/src/adapter.ts#L102) - `OAUTH_BETA`, the beta header a call with the token names"
  - "[code://packages/server/src/proxy/adapters.ts#L364-L390](../../packages/server/src/proxy/adapters.ts#L364-L390) - the `anthropic` adapter: a `key` sent as `x-api-key`, and no sign-in"
  - "[code://packages/server/src/proxy/adapters.ts#L291-L362](../../packages/server/src/proxy/adapters.ts#L291-L362) - the `openrouter` adapter, the first with a `signIn`"
  - "[code://packages/server/src/proxy/listener.ts#L158-L172](../../packages/server/src/proxy/listener.ts#L158-L172) - `upstreamHeaders`, which sets the key header of the dialect"
  - "[code://packages/agent-claude/src/logins.ts#L1-L14](../../packages/agent-claude/src/logins.ts#L1-L14) - a login signs the CLI in as `CLAUDE_CODE_OAUTH_TOKEN`"
  - npm://@earendil-works/pi-ai@1.3.0 - `dist/api/anthropic-messages.js` L783-L817, L871-L876 and L930-L936, a Messages call with a Claude OAuth token
  - https://code.claude.com/docs/en/authentication#generate-a-long-lived-token - `claude setup-token`, the token a login holds
---

# The Anthropic connector signs in as a Claude login does

Softov wants one Anthropic connector in place of two: `claude-login` and `anthropic`. First, the `anthropic` connector signs in to a Claude account, as `claude-login` does. Before that, a check shows that a login's token can make the API calls the `anthropic` connector makes.

## What others do

- pi calls Anthropic's Messages API with a Claude OAuth token. It sends the token as `Authorization: Bearer`, with the betas `claude-code-20250219` and `oauth-2025-04-20` (`anthropic-messages.js` L803-L817, L875).
- pi also sends Claude Code's identity with such a token. Its user agent is `claude-cli/2.1.280`, with `x-app: cli`. Its system prompt starts with "You are Claude Code, Anthropic's official CLI for Claude.", and a comment says it must (L930-L936).
- pi tells a token apart from a key by its prefix, `sk-ant-oat` (L783-L784).
- The Claude CLI takes the token as `CLAUDE_CODE_OAUTH_TOKEN` ([authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)).

## What ahpd has today

- `claude-login` holds a `token` in the vault. Its sign-in is Claude Code's own, on claude.ai, with Claude Code's client id ([`code://packages/agent-claude/src/adapter.ts`](../../packages/agent-claude/src/adapter.ts#L150-L256)).
- agent-claude registers `claude-login`, and only a Claude agent's `logins` uses it. The token reaches the CLI, not the model proxy.
- The check of `claude-login` already makes one API call with the token: `POST /v1/messages/count_tokens`, as `Authorization: Bearer`, with `anthropic-beta: oauth-2025-04-20`.
- The host registers `anthropic`, with a `key` and no sign-in. The model proxy calls it, and its check reads `/v1/models` ([`code://packages/server/src/proxy/adapters.ts`](../../packages/server/src/proxy/adapters.ts#L364-L390)).
- The proxy sends a connector's key in the header of the dialect, which is `x-api-key` for Anthropic ([`code://packages/server/src/proxy/listener.ts`](../../packages/server/src/proxy/listener.ts#L158-L172)). It has no path for a Bearer token and a beta header.
- `openrouter` is the host adapter with a `signIn` today, so a host adapter can take one ([`code://packages/server/src/proxy/adapters.ts`](../../packages/server/src/proxy/adapters.ts#L291-L362)).

## Who writes

- No open PR on `softov/ahpd` touches `adapter.ts`, `logins.ts` or the proxy.
- [the-claude-agent-view-follows-its-record.md](the-claude-agent-view-follows-its-record.md) changes the Claude agent's view, which reads `claude-login` connectors. A unified adapter changes which connectors that view lists.
- The idea [cofold-and-pi-take-model-connectors.md](../ideas/cofold-and-pi-take-model-connectors.md) wants cofold and pi to take the `anthropic` connector, so a login would reach them too.

## The change

1. A check by hand shows what a login's token can call: a `/v1/messages` call with no Claude Code identity, then one with it, and `/v1/models`.
2. The `anthropic` connector takes a key or a login. Its sign-in is the one `claude-login` has.
3. The proxy sends a login's token as `Authorization: Bearer`, with the beta header, and a key as `x-api-key`.
4. A Claude agent's `logins` takes an `anthropic` connector that holds a login, and `claude-login` goes.

## Open points

- Whether the API takes a login's token for a call with no Claude Code identity. pi's comment says no; this is not checked here.
- Whether Anthropic's terms allow a Claude plan's token in a tool other than Claude Code. If a call needs Claude Code's identity, the proxy would send it for every client. That is Softov's call.
- Where the one adapter lives: in the host, as `anthropic` is, or in agent-claude, as `claude-login` is.
- What happens to the existing `claude-login` connectors: a move at start, as the agent records had, or both adapters for a time.
