---
title: A member reads their team's pool
status: doing
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/scopes.ts#L95-L131](../../../../packages/sdk/src/scopes.ts#L95-L131) - `namesOf` and `poolsFor`"
  - "[code://packages/sdk/src/usage.ts#L520-L540](../../../../packages/sdk/src/usage.ts#L520-L540) - `refused` and `notYours`"
---

## Objective

A person reads `team:<team>` when they hold `team`, `team:*` or `team:<project>`, and `team:*` opens every `project:<team>:<project>`.

## Files

- `UPDATE: packages/sdk/src/scopes.ts` - add `mayRead(principal, pool)`, and say in `poolsFor`'s comment that it is the pools a person names.
- `UPDATE: packages/sdk/src/usage.ts:520-540` - `refused` asks `mayRead`.
- `UPDATE: packages/sdk/test/usage-scheme.test.ts` - the cases below, or the test file that holds the usage scheme's read rule.

## Steps

1. Write `mayRead`: own `user:` pool, `team:<team>` for any membership in that team, `project:<team>:<project>` for `team:*` or `team:<project>`.
2. Make `refused` and the `authorize` hook use `mayRead`.
3. Write a test: `backend:*` reads `team:backend` and `project:backend:ahpc`, and not `project:testing:ahpc`.
4. Write a test: `backend:ahpapp` reads `team:backend` and `project:backend:ahpapp`, and not `project:backend:ahpc`.
5. Write a test: a reader with `usage:read` reads every pool.

## Validation

- The ahpd gates pass.

## Resume

- `packages/sdk/src/scopes.ts`: added `mayRead(principal, pool)`, exported from `packages/sdk/src/index.ts`.
- `mayRead` reads the own `user:` pool, `team:<team>` for any membership in that team, and `project:<team>:<project>` for `team:*` or `team:<project>`.
- A bare `team` reads no project pool, and `root:` pools are never read through `mayRead`.
- `poolsFor`'s comment now says it is the pools a person names.
- `packages/sdk/src/usage.ts`: `refused` asks `mayRead`, so the `authorize` hook and `notYours` use it.
- `packages/sdk/test/usage-scheme.test.ts`: a test for `backend:*`, `backend:ahpapp`, a bare `backend` and a `usage:read` reader.
