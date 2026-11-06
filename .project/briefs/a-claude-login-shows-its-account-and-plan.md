---
title: A Claude login shows its account and its plan
created: 2026-11-06
refs:
  - git://f37f5e1a - the commit of ahpd the facts were checked at
  - git://723c8dc4 - the head of #249, whose login view shows what a session reports
  - git://29f11690 - the commit that made the `claude-login` sign-in, with the one scope `user:inference`
  - "[code://packages/agent-claude/src/adapter.ts#L14-L30](../../packages/agent-claude/src/adapter.ts#L14-L30) - the sign-in copies `claude setup-token`: one scope, `user:inference`"
  - "[code://packages/agent-claude/src/adapter.ts#L103-L110](../../packages/agent-claude/src/adapter.ts#L103-L110) - the check counts the tokens of one prompt, and reads nothing of the account"
  - "[code://packages/agent-claude/src/session/query.ts#L832-L862](../../packages/agent-claude/src/session/query.ts#L832-L862) - `introduce`: a session asks the account and the usage when its CLI starts"
  - "[code://packages/agent-claude/src/session/limits.ts#L95-L106](../../packages/agent-claude/src/session/limits.ts#L95-L106) - `noteAccount`: the plan type and the email come from the CLI's account answer"
  - "[code://packages/agent-claude/src/session/limits.ts#L242-L270](../../packages/agent-claude/src/session/limits.ts#L242-L270) - `refreshLimits`: the windows come from the CLI's usage answer"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `AccountInfo` has `email` and `subscriptionType` as optional fields, and a rate limit event has `utilization` as optional
  - https://code.claude.com/docs/en/authentication#generate-a-long-lived-token - `claude setup-token`, the flow the connector's sign-in copies
---

# A Claude login shows its account and its plan

Softov wants a `claude-login` connector to show its account and its plan: the email, the plan type, and what is left of each window.
On #249, after a sign-in through the connector and a session, the view shows only the reset time of the Session window.
Softov saw more about the same login before (2026-11-06: "I had seen more information before. Same login using the connector.").
He also wants the information without a session first (2026-11-06: "connector only show information after a session is talked").

## What others do

- Claude Code's claude.ai `/login` asks five scopes: `user:profile`, `user:inference`, `user:sessions:claude_code`, `user:mcp_servers` and `user:file_upload`. This is the list `r` in the CLI 2.1.301 binary that SDK 0.3.301 ships.
- Claude Code's `setup-token` asks only `user:inference`. The binary names this flow `inferenceOnly`, and the scope `CLAUDE_AI_INFERENCE_SCOPE`.
- Claude Code reads the profile at `GET /api/oauth/profile`, with the token as `Bearer`.
- Claude Code reads the plan usage at `GET /api/oauth/usage`.
- The CLI describes `rate_limits_available` in its usage answer as "False when plan rate limits do not apply (API key, Bedrock, Vertex, or missing profile scope)".
- The CLI reads `anthropic-ratelimit-unified-5h-utilization` and `anthropic-ratelimit-unified-7d-utilization` from the headers of a model response. Its rate limit event carries `utilization` only when the headers have it.

## What ahpd has today

- The connector's sign-in asks the one scope `user:inference`, as `setup-token` does ([`code://packages/agent-claude/src/adapter.ts`](../../packages/agent-claude/src/adapter.ts#L14-L30)). The scope has not changed since `29f11690`.
- A token without `user:profile` gives the CLI no profile. So the account answer has no `email` and no `subscriptionType`, and the usage answer has no rate limits.
- The connector's check counts the tokens of one prompt, and reads nothing of the account or the plan ([`code://packages/agent-claude/src/adapter.ts`](../../packages/agent-claude/src/adapter.ts#L103-L110)).
- Only a session reads the account and the usage, when its CLI starts and after each turn ([`code://packages/agent-claude/src/session/query.ts`](../../packages/agent-claude/src/session/query.ts#L832-L862)).
- The plan and the email come from the CLI's account answer ([`code://packages/agent-claude/src/session/limits.ts`](../../packages/agent-claude/src/session/limits.ts#L95-L106)). The windows come from its usage answer and from rate limit events ([`code://packages/agent-claude/src/session/limits.ts`](../../packages/agent-claude/src/session/limits.ts#L242-L270)).
- With this token, the only window data is a rate limit event: a reset time, and a utilization only when the headers have one.
- What a session reports is kept in memory, so a daemon restart clears it.

## Who writes

| Writer | Files | What this change does to it |
| --- | --- | --- |
| #249, `plugin/20261106-0438-a-connector-and-an-agent-show-a-view` | `agent-claude/src/views.ts`, `logins.ts`, `session/limits.ts` | The change builds on its view and its data. #249 merges first. |
| MayCXC's branches | `agent-claude/src/adapter.ts` | He wrote the sign-in. A change to its scope must be checked against his open branches before a plan. |

## The change

- The connector's sign-in asks `user:profile` beside `user:inference`, so the token can read the profile and the plan usage.
- A session on such a token then reports the email, the plan type and the windows with their percentages, and #249's view shows them.
- The connector reads `/api/oauth/profile` and `/api/oauth/usage` itself, at its open and at each check, so its view fills without a session.
- A login made before the change keeps its old token, and shows what it shows today until a person signs in again.

## Open points

- Where Softov saw more about this login before is not known. The scope never had `user:profile`, so a session on the connector's token never had a profile. The agent's own CLI sign-in has every scope, and its account and chat bars may be what he saw. Not checked.
- Not checked: whether the token URL gives a one-year token for `user:profile user:inference`, as it does for `user:inference` alone. If it gives a short token with a refresh token, the connector keeps the refresh token in the vault and refreshes, as devtunnel does.
- Not checked: whether the client id that `setup-token` uses may ask `user:profile` on the code page.
- Not checked: the shape of the `/api/oauth/profile` and `/api/oauth/usage` answers. The CLI's usage answer is its own mapping of them.
