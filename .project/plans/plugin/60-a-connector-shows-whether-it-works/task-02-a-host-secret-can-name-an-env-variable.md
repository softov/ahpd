---
title: A host secret can name an env variable
status: done
depends: [task-01-the-types-carry-a-check-and-health.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L400-L449](../../../../packages/sdk/src/connectors/channel.ts#L400-L449) - `moveSecrets`, which refuses a reference in a secret field today"
  - "[code://packages/sdk/src/connectors/channel.ts#L329-L340](../../../../packages/sdk/src/connectors/channel.ts#L329-L340) - `resolved`, which reads each `$secret` back"
  - "[code://packages/sdk/src/connectors/channel.ts#L195-L208](../../../../packages/sdk/src/connectors/channel.ts#L195-L208) - the config a client is shown, with `<set>` for a secret"
---

## Objective

A host connector's secret field can hold `{ "fromEnv": "<NAME>" }`, the form a preset's `env` already uses.
The host reads that variable from the daemon's environment when it opens the connector, and keeps nothing in the vault for it.

## Files

- `UPDATE: packages/sdk/src/connectors/channel.ts` - accept a `fromEnv` reference in `moveSecrets` for a host connector, read it in `resolved`, refuse it there for any other owner, and show it in a row.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - cases for each rule below.

## Steps

1. In `moveSecrets`, keep a `fromEnvRef` value in a `writeOnly` field as it is, when the owner is `host`.
2. Refuse a `fromEnvRef` value for a `team:` or a `user:` owner with `INVALID_PARAMS`.
3. Say in the message that only a host connector may name a variable.
4. Remove the old vault secret of that field when a put changes the field to a `fromEnv` reference.
5. Pass the owner from `openOne` into `resolved`. Refuse a `fromEnv` value there when the owner is not `host`, with the put's message.
6. Answer `process.env[name]` in `resolved` for a `fromEnv` value, after the owner's rule.
7. Throw `the environment holds no <NAME>` when the variable is not set or is empty.
8. Send a `fromEnv` value in a row unchanged, not as `<set>`.
9. Let the schema check pass a `fromEnv` value in a `writeOnly` string field, as `<set>` passes today.
10. Take no `fromEnv` value into the vault on a remove, because it names none.
11. Add the test cases with a variable set for the test and removed after it.

## Validation

- A case shows a host connector that opens with the variable's value.
- A case shows a missing variable makes the connector `invalid`.
- A case shows the channel refuses a `fromEnv` reference for a team or a person.
- A case writes a person's record straight into the collection. It opens `invalid`, and the owner's rule runs before anything reads the variable.
- A case shows the row holds `{ "fromEnv": "<NAME>" }` and never the value.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Resume

- **Done so far:** `moveSecrets` reads a `fromEnvRef` value in a `writeOnly` field before the vault is asked. A host connector keeps `{ "fromEnv": "<NAME>" }` as stored, and forgets the field's old vault secret. A `team:` or `user:` connector is refused, with a message saying only a host connector may name a variable. `resolved` takes the owner, refuses a `fromEnv` value for any owner but `host` with the put's message, and only then answers `process.env[NAME]`. A variable that is unset or empty throws `the environment holds no <NAME>`, so the connector reads `invalid` with that problem. A row carries the reference exactly as stored, and the schema check sees `HELD` in its place. The tests cover an open from a variable and an open with no variable. They refuse a `fromEnv` at a put for a team and for a person, and show a row holding the reference and never the value. One more writes a person's record straight into the collection. The start leaves it `invalid`, opens nothing, and reports the owner's rule although the variable is unset.
- **Next action:** [task-03-the-channel-keeps-health.md](task-03-the-channel-keeps-health.md).
- **Files:** `packages/sdk/src/connectors/channel.ts`, `packages/sdk/test/connectors-channel.test.ts`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** the first build stored `{ "$env": "<NAME>" }` through a reader of its own. Softov's review of 2026-10-23 settled on `{ "fromEnv": "<NAME>" }`, the form presets use, so the stored reference and the reader both changed.
- **Watch out for:** a remove needs no vault call for a `fromEnv` field, because the field names none. The case that sets the variable deletes it after itself, so no other case inherits it. The owner's rule sits in `resolved` before the lookup, so no `fromEnv` of a person's record ever reaches the daemon's environment.

