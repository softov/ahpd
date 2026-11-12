---
title: A plugin admits a person by a key in memory
status: implemented
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

Implemented 2026-11-11, uncommitted in the worktree.

- `PluginHost.personKey(person)` answers a key from `randomBytes(32)`, or nothing on a host with no users directory and nothing for a person whose record requires the issuer. A key is a local token, and that record says a local token does not sign the person in.
- `pluginSet` keeps the keys per plugin id, validates the person against `users.list()` before minting, refusing an id the directory does not have, and drops a plugin's keys when it loads, when its load fails, and when it unloads.
- `PluginSet.personOf(key)` answers the person a key names, which is what `run.ts` reads at the door.
- `identifyWith(users, () => pluginHoldings)` is the daemon's `identify`: a held key first, answered from the directory, then `users.verify` as before. No key is ever minted for a person who requires the issuer, so no held key can name them.
- New in the SDK beyond the task's Files list: `Users.principalOf?(id)` in `types/users.ts`, answered by `fileUsers` in `access/users.ts` from the same record `verify` reads. The person's `Principal` has to come from the directory, and `list()` would not re-read the file.
- CASES: `packages/server/test/plugin-person-key.test.ts`, over the fixture `packages/server/test/fixtures/plugin-person-key/`. The fixture leaves the key on `globalThis` and every check compares by reference or asks `personOf`, so no key reaches an output. A case added 2026-11-12 has a person whose record requires the issuer: the plugin loads and no key is minted.
- `pnpm exec tsc -p tsconfig.json --noEmit` passes. The tunnel and server suites were run after the review fixes, and `implemented.md` has the counts.

