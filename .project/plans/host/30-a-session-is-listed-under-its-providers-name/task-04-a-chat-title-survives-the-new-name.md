---
title: A chat title survives the session's new name
status: done
depends: [task-01-a-created-session-is-held-under-its-providers-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions.ts#L42-L52](../../../../packages/sdk/src/sessions.ts#L42-L52) - `chatTitle` and `setChatTitle`, by the exact chat URI"
  - "[code://packages/sdk/src/types/sessions.ts#L84](../../../../packages/sdk/src/types/sessions.ts#L84) - the port's `chatTitle(id, chatUri)`"
  - "[code://packages/sdk/src/host/spawn.ts#L693-L694](../../../../packages/sdk/src/host/spawn.ts#L693-L694) - `spawn`, which reads a title back"
  - "[code://packages/sdk/src/host/channels.ts#L109-L122](../../../../packages/sdk/src/host/channels.ts#L109-L122) - `chatUriFor` and `subagentChatUri`, which embed the session URI"
---

## Objective

A chat renamed while its session was held as `ahp-session:/<uuid>` keeps that title once the session is held as `claude:/<uuid>`, including after a restart.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:693-694` and the writes near `packages/sdk/src/host/tooling.ts:209`, `packages/sdk/src/host/lifecycle.ts:754` and `packages/sdk/src/host/tooling.ts:304` - read a title under the held chat URI, and when there is none, under the same chat built from `uriFor(id)`; write under the held chat URI.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - the case below, next to `brings a renamed peer chat back with its title after a restart on the same file` (89).

## Steps

1. Add a helper that gives a chat URI in the `ahp-session:/` spelling for the same session id, using `chatUriFor` and `subagentChatUri`.
2. Read the held key first, then that one; on the next write, store under the held key and clear the old one, so the file converges without a migration step.
3. Keep the store's shape; `sessions.json` rows stay by id.

## Validation

- A store holding a title under `ahp-chat://default/<b64 ahp-session:/<uuid>>`: the session resumed as `claude:/<uuid>` shows that title, and renaming it again leaves one entry under the `claude:` chat URI.
- `pnpm -C packages/sdk test` passes.

## Resume

`titleOf(uri, chatUri)` reads the title under the chat URI and, when there is none, under the same chat respelled to `uriFor(id)` with `respell`; `keepTitle` writes under the chat URI and clears the old key when one is there.
`spawn` reads through `titleOf`, and `renameChat`, the session tools' `createChat` and `openSession`'s first name write through `keepTitle`; a chat a client named keeps one key, since its URI does not carry the session.
Test: `host-snapshots.test.ts`, `keeps a title written under the session's old name once it is held under its provider's`: a store with `Paging` under the `ahp-session:/<uuid>` chat resumes as `claude:/<uuid>` with that title, and renaming it leaves one entry under the `claude:` chat URI.
It failed first with the derived title, `carry on`.
