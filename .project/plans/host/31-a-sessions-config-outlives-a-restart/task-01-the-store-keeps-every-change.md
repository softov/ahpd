---
title: The store keeps what a session was made with and every change
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L107-L112](../../../../packages/sdk/src/host/chatactions.ts#L107-L112) - the only write today"
  - "[code://packages/sdk/src/host/chatactions.ts#L372-L452](../../../../packages/sdk/src/host/chatactions.ts#L372-L452) - the live change path"
---

## Objective

A created session's config and every change the backend accepts are in the session store, as the JSON values they are, and a resume after a restart spawns with them.

## Files

- `UPDATE: packages/sdk/src/host.ts` - write `kept.setConfig` where a session is created and after a live `session/configChanged` is accepted; drop the `String()` at 8388.
- `UPDATE: packages/sdk/src/sessions.ts` - the stored `config` holds JSON values.
- `UPDATE:` the host's session store tests.

## Steps

1. Tests first with `fileSessions` in a temp folder: a session created with a config, then a new host over the same file, resumes with that config; a live change is kept the same way; an array value comes back as an array.
2. Write the store on create and on an accepted live change; keep the browsed-row path.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

`openSession` writes the config a session was made with to the store when it has any, so a client's `createSession` and every other creation path keep it.
The live `session/configChanged` path writes each key the backend accepted, and each fixed key taken by a restart, through one `remember(key, value)`; a refused key and this host's own keys (`isolation` and its companions) are not written.
The no-agent path now merges the action's values as they arrived, without `String()`.
`fileSessions` no longer loads an array as a session's config.
Tests in `host-sessionconfig.test.ts`, `a session's config across a restart`: created with `permissionMode: plan` and `thinking: disabled` resumes with both; a live change resumes; a refused change stays out of the store; `shellInitScripts` stays an array on a live session and on a row, and a browsed row shows it.
All four failed first: the resumed CLI got `default`, and the store file was never written for a live session.
Not known to the plan: a session placed in a `disposable:<profile>` machine stores the `computer://<id>` it was made into, since that is its config; a resume after a restart hands that machine back even if it is gone, since a plugin's `computer` key is `enumDynamic` and task 02's check does not hold a dynamic enum to its listed values.
After the review of 2026-09-30, `remember` does not write a key whose property says `scope: 'chat'` when it was set on a peer chat, since that is the chat's and not the session's, and writes nothing once the session is no longer held, since the backend answers `setConfig` a turn later and a disposed session's row has been forgotten.
Tests in `host-sessionconfig.test.ts`, `a session's config across a restart`: `keeps a key the schema scopes to one chat out of the session's store` (`effortLevel: low` set on a peer chat reaches the CLI and not the store) and `writes nothing for a session disposed before its backend took the change` (a backend whose `setConfig` answers after `disposeSession`); both failed first, with `effortLevel` in the stored config and with `voice: shouty` written back after the dispose.
A chat-scoped key set on the session's lead chat is stored, since a resume applies the store to the lead chat; test: `keeps a key the schema scopes to one chat when it was set on the lead chat` (`effortLevel: low` on `ahp-chat:/lead`), which fails when every chat-scoped key is skipped.
`remember` writes only while the session is the one the change was made to: `lives` holds one token per session, made the first time a `session/configChanged` for it is applied and dropped by `removeSession` or by a restart of it that fails; a restart that succeeds keeps it, and a session disposed and created again under the same name gets a new one, so a late answer from a disposed backend writes nothing, not even into its successor.
Tests: `session-fixed-key.test.ts` `keeps a change the backend took while the session was being started again` (the old backend answers a pending `setConfig` as it is closed for a fixed-key restart), which failed first with the old value stored, and `host-sessionconfig.test.ts` `writes nothing for a session disposed before its backend took the change, even under its name again`; both fail with a `sessions.has` check in place of the token.
The no-agent `session/configChanged` path stores only for a channel that names a session this host runs or lists, or one `past` finds in the catalogue, and refuses any other with `<channel> is not a session here`; it stores neither this host's own keys (`isolation` and its companions) nor anything for a refused channel.
A config change it has to look up this way is returned into the connection's `waiting` queue, so the connection's later dispatches wait for it.
Test: `users-gate.test.ts` `keeps config for a channel that names no session out of the store` (`zzz:/nothing` refused with no row, `zzz:/disk` stored as `{ voice: shouty }` without `isolation`).
`past` reads the catalogue through `catalogue`, which reuses a listing started within `LISTING_FRESH` (2 s), running or finished, so subscribes to ids that name nothing list once per window rather than once each; test: `users-gate.test.ts` `reads the catalogue once for a run of subscribes to sessions nobody has`, which fails with the window at zero.
`listSessions` lists through `listNow`, which records its listing as the one `catalogue` answers with, and the listing refills `owners`.
An id missing from a listing that `listSessions` started, which is the only listing `catalogue` answers `past` with that `past` did not start itself, is listed for once more, and `pastAt` bounds that to once per `LISTING_FRESH`, so made-up ids still cost at most one listing of `past`'s own per window; the window is a defaulted row in the plan.
Test: `users-gate.test.ts` `finds a session a backend wrote to disk after the last listing` (`listSessions`, then the backend adds `late`, then `subscribe claude:/late` is answered), which fails with the second listing taken out.
The no-agent config path's wait on `past` is bounded by `WAIT_LIMIT` (60 s, a defaulted row in host/30), after which the change is refused with `reading the catalogue took longer than 60s` and nothing is stored; test: `session-fixed-key.test.ts` `refuses a config change that waited too long on the catalogue`.
That path also refuses a session spelt as a `file:` URI, a terminal or a watch before it reads anything, since `applyDispatch` refuses every `session/`, `chat/`, `annotations/` and `changeset/` action on a channel `channelKind` does not read as a session's (host/30 task 08).
