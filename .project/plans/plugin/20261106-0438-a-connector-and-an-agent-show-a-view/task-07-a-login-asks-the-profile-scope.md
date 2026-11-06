---
title: A login asks the profile scope
status: implemented
depends: [task-04-claude-shows-plan-usage.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/adapter.ts#L14-L30](../../../../packages/agent-claude/src/adapter.ts#L14-L30) - the sign-in's URLs, client and scope"
  - git://ed4a9105 - the brief `a-claude-login-shows-its-account-and-plan.md`, whose first change this task builds
---

## Objective

The `claude-login` sign-in asks `user:profile` beside `user:inference`.
A session on a login made with it reads the account's email, its plan type and its plan limits, and the login's view shows them.

## Files

- `UPDATE: packages/agent-claude/src/adapter.ts:14-30` - `SCOPE` is `user:profile user:inference`, and the comment says why.
- `UPDATE: packages/agent-claude/test/agent-claude-login-adapter.test.ts` - the authorize URL asks both scopes.
- `UPDATE: packages/agent-claude/README.md` - the sign-in asks the profile scope.

## Steps

1. Set `SCOPE` to `user:profile user:inference`, in the order of the CLI's own login.
2. Write in the comment that the profile scope is what gives the email, the plan type and the plan limits.
3. Change the authorize URL case to expect both scopes.
4. Write the profile scope in the README's sign-in paragraph.

## Validation

- `agent-claude-login-adapter.test.ts`: the authorize URL asks `user:profile user:inference`.
- `pnpm typecheck` passes, and `pnpm exec vitest run packages/agent-claude/` passes.
- By hand, Softov signs in again and runs a session.
- By hand: the login's view shows the masked email, the plan type and the percentages.
- By hand: the token the exchange answers still lasts one year.

## Resume

Done. `SCOPE` is `user:profile user:inference`, and the authorize URL test expects both.
A login made before this change keeps its old token, so it needs a new sign-in to show more.

Left: Softov's two checks by hand.
The exchange keeps only `access_token`. For these scopes, the token URL may give a short token and a refresh token. The login then needs a refresh step, in a new task.
