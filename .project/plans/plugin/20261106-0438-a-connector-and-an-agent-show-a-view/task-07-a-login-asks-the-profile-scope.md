---
title: A login asks the profile scope
status: done
depends: [task-04-claude-shows-plan-usage.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/adapter.ts#L14-L30](../../../../packages/agent-claude/src/adapter.ts#L14-L30) - the sign-in's URLs, client and scope"
  - git://ed4a9105 - the brief `a-claude-login-shows-its-account-and-plan.md`, whose first change this task builds
---

## Objective

The `claude-login` sign-in asks `user:profile` beside `user:inference`.
When a login opens, the connector reads the token's profile once, and shows the masked email and the plan type before any session.
A session on a login whose profile answered sets `CLAUDE_CODE_OAUTH_SCOPES`, so its CLI reads the account and the plan limits.

## Files

- `UPDATE: packages/agent-claude/src/adapter.ts:14-30` - `SCOPE` is `PROFILE_SCOPES`, and `profileOf` reads `GET /api/oauth/profile` at each open.
- `UPDATE: packages/agent-claude/src/logins.ts` - `PROFILE_SCOPES`, `profiled`, `scopesOf`, and `Login.scopes`.
- `UPDATE: packages/agent-claude/src/session/query.ts:208-215` - `signedIn` sets `CLAUDE_CODE_OAUTH_SCOPES` from the login.
- `UPDATE: packages/agent-claude/test/agent-claude-login-adapter.test.ts` - the scopes, the profile at open, and a refused profile.
- `UPDATE: packages/agent-claude/test/agent-claude-logins.test.ts` - the CLI's scopes, and the profile calls at open.
- `UPDATE: packages/agent-claude/README.md` - the sign-in's scopes and the profile at open.

## Steps

1. Set `SCOPE` to `PROFILE_SCOPES`, `user:profile user:inference`.
2. Add `profileOf`, which reads the profile with the token as a bearer and maps `organization_type` to a plan type.
3. Call `profileOf` at each open, and hand its answer to `OpenLogins.profiled`.
4. Keep the profile's email masked and its plan type, for the token that read it.
5. Merge the profile into the login's data where a session's answer names no email or plan.
6. Give `Login` the scopes of a token whose profile answered.
7. Set `CLAUDE_CODE_OAUTH_SCOPES` in `signedIn` from the login, and never from the base environment.

## Validation

- `agent-claude-login-adapter.test.ts`: the authorize URL asks `user:profile user:inference`.
- `agent-claude-login-adapter.test.ts`: an open asks the profile, and the view shows the masked email and the plan.
- `agent-claude-login-adapter.test.ts`: a refused, empty or failed profile shows nothing and gives no scopes.
- `agent-claude-logins.test.ts`: a CLI on a profiled login gets `CLAUDE_CODE_OAUTH_SCOPES`, and one on another login does not.
- `pnpm typecheck` passes, and `pnpm exec vitest run packages/agent-claude/` passes.
- By hand, Softov signs in again and opens the login.
- By hand: the view shows the masked email and the plan before a session, and the percentages after one.
- By hand: the token the exchange answers still lasts one year.

## Resume

Done. The sign-in asks both scopes, and an open reads the profile once.
The CLI ignores a token's own scopes: with `CLAUDE_CODE_OAUTH_TOKEN`, it takes `CLAUDE_CODE_OAUTH_SCOPES`, and `user:inference` when that is unset. So a session sets it from the login.
`pnpm exec vitest run packages/agent-claude/` passes 604 tests.

Left: Softov's checks by hand.
A login made before this change keeps its old token, which reads no profile, so it needs a new sign-in.
For these scopes, the token URL may give a short token and a refresh token. The login then needs a refresh step, in a new task.
