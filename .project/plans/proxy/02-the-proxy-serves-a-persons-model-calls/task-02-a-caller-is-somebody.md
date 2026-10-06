---
title: A caller is a person, root or a session, and may call
status: implemented
depends: [task-01-v1-answers-in-each-dialect.md]
layer: "server | sdk"
refs:
  - "[code://packages/server/src/commands/authorize.ts#L41-L84](../../../../packages/server/src/commands/authorize.ts#L41-L84) - `bearer`, `same` and `authorizeOverHttp`, the order copied here"
  - "[code://packages/sdk/src/users.ts#L807-L854](../../../../packages/sdk/src/users.ts#L807-L854) - `verify`"
  - "[code://packages/sdk/src/users.ts#L24-L54](../../../../packages/sdk/src/users.ts#L24-L54) - the built-in roles and `SUBJECTS`, where a `proxy` subject goes"
  - "[code://packages/sdk/src/scopes.ts#L155-L180](../../../../packages/sdk/src/scopes.ts#L155-L180) - `scopeFor`"
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/task-01-a-session-has-a-token.md](../../container/05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/task-01-a-session-has-a-token.md) - the task that fills `whose`"
---

## Objective

A call carries its credential as `Authorization: Bearer <token>` or `x-api-key: <token>` and is answered as root, as a session (through `whose`), or as a person who holds the grant to call, with a team and project; anybody else is refused in the dialect's body.

## Files

- `CREATE: packages/server/src/proxy/caller.ts` - `SessionCaller` (`{ session, chat?, turn?, owner?, principal?, scope? }`), `ProxyCaller` (`{ kind: 'root' } | { kind: 'person', principal, scope? } | { kind: 'session', ...SessionCaller }`) and `callerOf(request, options)`.
- `UPDATE: packages/server/src/proxy/listener.ts` - `ProxyOptions.whose?(token): SessionCaller | undefined`, the hook container/05 p12 task 01 fills; `callerOf` before anything is routed.
- `UPDATE: packages/sdk/src/users.ts:24-54` - `proxy` added to `SUBJECTS` (line 40), and `proxy:read` and `proxy:write` to the built-in `member` (line 29); `guest` gains neither.
- `UPDATE: packages/server/test/proxy-listener.test.ts`.

## Steps

1. The credential is `Bearer` first, `x-api-key` when there is none; both present and different is 400, since one of them is not this caller's.
2. The deployment token with `same` is root; then `whose`, which is in memory and so asked before anything that may ask an issuer; then `users.verify` and `standing`; a host with no users directory accepts only the deployment token and `whose`.
3. A person needs `proxy:write` to call (`proxy:read` for task 07); refused 403 naming the grant, as the API's hook words it.
4. The scope is `X-AHP-Scope`, else `?scope=`, else the primary, through `scopeFor`; its refusal is 403 with `scopeFor`'s sentence. Root and a session are not asked for one; a session's is the one `whose` answers.

## Validation

- Failing first: a call with a member's token as `x-api-key` gets the task 01 stub's 501 instead of being checked; then each case below.
- No credential 401; an unknown one 401; a removed person 401; the deployment token is root; a person without `proxy:write` 403; a `member` allowed; a `guest` 403; `X-AHP-Scope` naming a team they are not in 403; `?scope=` honoured; no header uses the primary.
- A fake `whose` answering one token makes it a session caller, and `users.verify` is not called for it (a counting fake directory).
- Each refusal is in the dialect's body for both paths.

## Resume

Implemented 2026-10-06.
`callerOf`, `SessionCaller` and `ProxyCaller` in `packages/server/src/proxy/caller.ts`; `ProxyOptions.whose` in `listener.ts`; `proxy` in `SUBJECTS` and `proxy:read`, `proxy:write` on `member`; `same` exported from `authorize.ts`.
The body is read only after the caller is known, so an unauthenticated request never has its body read.
A person in no team on a host that names teams is refused 403 with `scopeFor`'s sentence, as a session is.
`docs/USERS.md` gained the `proxy` row here, since `users.test.ts` holds every subject to a row.
Tests: `proxy-listener.test.ts` second describe, `users.test.ts`.
