---
title: A plugin admits a person by a key in memory
status: todo
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L960](../../../../packages/sdk/src/types/plugin.ts#L960) - `PluginHost`, which gains the call"
  - "[code://packages/sdk/src/listen.ts#L152-L190](../../../../packages/sdk/src/listen.ts#L152-L190) - `doorOf`, which reads `identify`"
  - "[code://packages/server/src/commands/run.ts#L743-L760](../../../../packages/server/src/commands/run.ts#L743-L760) - the daemon's `identify`, which checks the key map before the directory"
---

## Objective

A plugin asks the host for a key that names one person. A connection that presents the key is admitted as that person. The key lives only in the daemon's memory.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:960` - `PluginHost` gains a call that takes a person id and answers a key, or nothing on a host with no users.
- `UPDATE: packages/server/src/commands/run.ts:743-760` - `identify` admits a held key as the person's `Principal`.
- `UPDATE: packages/server/src/plugins.ts` - the plugin host serves the call, and drops the plugin's keys on unload.
- `CREATE: packages/server/test/plugin-person-key.test.ts` - the key's cases.

## Steps

1. Name the call after the sibling calls on `PluginHost`, and document it in the `PluginHost` comment.
2. Make the key with `randomBytes(32)`, as the daemon makes its own token.
3. Keep each key in a map from key to person id, in the daemon's memory only.
4. Refuse a person id that the users directory does not have, with the id in the error.
5. In `identify`, answer a held key with the person's `Principal` from the users directory, before `users.verify`.
6. Drop every key of a plugin when the plugin unloads.
7. Never log a key, and never write it to a file.

## Validation

- A test where a key admits its person, with the person's grants.
- Test an unknown person id. Expect a refusal.
- Test the key of an unloaded plugin. Expect a refusal.
- `pnpm typecheck` passes, and the server suite passes.

## Resume

