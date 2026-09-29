---
title: A chat title survives the session's new name
status: todo
depends: [task-01-a-created-session-is-held-under-its-providers-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions.ts#L42-L52](../../../../packages/sdk/src/sessions.ts#L42-L52) - `chatTitle` and `setChatTitle`, by the exact chat URI"
  - "[code://packages/sdk/src/types/sessions.ts#L84](../../../../packages/sdk/src/types/sessions.ts#L84) - the port's `chatTitle(id, chatUri)`"
  - "[code://packages/sdk/src/host.ts#L3364-L3365](../../../../packages/sdk/src/host.ts#L3364-L3365) - `spawn`, which reads a title back"
  - "[code://packages/sdk/src/host.ts#L1258-L1271](../../../../packages/sdk/src/host.ts#L1258-L1271) - `chatUriFor` and `subagentChatUri`, which embed the session URI"
---

## Objective

A chat renamed while its session was held as `ahp-session:/<uuid>` keeps that title once the session is held as `claude:/<uuid>`, including after a restart.

## Files

- `UPDATE: packages/sdk/src/host.ts:3364-3365` and the writes near 4777, 4867 and 5664 - read a title under the held chat URI, and when there is none, under the same chat built from `uriFor(id)`; write under the held chat URI.
- `UPDATE: packages/sdk/test/host.test.ts` - the case below, next to `brings a renamed peer chat back with its title after a restart on the same file` (3068).

## Steps

1. Add a helper that gives a chat URI in the `ahp-session:/` spelling for the same session id, using `chatUriFor` and `subagentChatUri`.
2. Read the held key first, then that one; on the next write, store under the held key and clear the old one, so the file converges without a migration step.
3. Keep the store's shape; `sessions.json` rows stay by id.

## Validation

- A store holding a title under `ahp-chat://default/<b64 ahp-session:/<uuid>>`: the session resumed as `claude:/<uuid>` shows that title, and renaming it again leaves one entry under the `claude:` chat URI.
- `pnpm -C packages/sdk test` passes.

## Resume

