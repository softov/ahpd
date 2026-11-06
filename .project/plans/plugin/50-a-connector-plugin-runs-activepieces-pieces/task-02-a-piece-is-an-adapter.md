---
title: A piece is an adapter
status: done
depends:
  - task-01-the-plugin-loads-pieces-in-a-child.md
layer: "activepieces"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L25-L49](../../../../packages/sdk/src/types/connectors.ts#L25-L49) - `Capability`, with `input`"
  - "[code://packages/sdk/src/types/connectors.ts#L101-L120](../../../../packages/sdk/src/types/connectors.ts#L101-L120) - `Adapter`"
  - "[code://packages/sdk/src/plugins/validate.ts#L535-L565](../../../../packages/sdk/src/plugins/validate.ts#L535-L565) - `checkAdapter`, which each adapter must pass"
---

## Objective

Each piece that loads is one adapter, `ap-<name>`.
Its schema comes from the piece's `auth`, and each action is an `action` capability with an `input` schema.

## Files

- `CREATE: packages/activepieces/src/mapping.ts` - `schemaOf(auth)`, `inputOf(props)` and `adapterOf(piece)`.
- `UPDATE: packages/activepieces/src/plugin.ts` - register one adapter for each described piece.
- `CREATE: packages/activepieces/test/mapping.test.ts` - the cases below.

## Steps

1. Name the adapter `ap-` and the package name after `@activepieces/piece-`.
2. For an array `auth`, use its first entry that is not `OAUTH2`.
3. Map `SECRET_TEXT` to one required `writeOnly` string, `secret_text`, with the auth's `displayName` as its title.
4. Map `CUSTOM_AUTH` to its props, with each `SECRET_TEXT` prop `writeOnly` and each required prop in `required`.
5. Skip a piece with no `SECRET_TEXT` or `CUSTOM_AUTH` entry, and report it.
6. Map `SHORT_TEXT` and `LONG_TEXT` to `string`, `NUMBER` to `number`, and `CHECKBOX` to `boolean`.
7. Map `ARRAY` to `array`, and `OBJECT`, `JSON` and `DYNAMIC` to `object`.
8. Map `STATIC_DROPDOWN` to a `string` with an `enum` of its option values.
9. Map `DROPDOWN` to a `string`, and add "Give the id." to its description.
10. Map `DATE_TIME` to a `string` with `format: date-time`.
11. Leave out each `MARKDOWN` prop and each optional `FILE` prop.
12. Leave out an action with a required `FILE` prop, and report it once for each piece.
13. Use `aiMetadata.description` as the capability's description when it exists, and the action's `description` if not.
14. Use the action's `name` as the capability's `name`, and its `displayName` as the `title`.
15. Add the tests, and run the package tests.

## Validation

- `mapping.test.ts`: a `SECRET_TEXT` auth gives one `writeOnly` field, `secret_text`.
- `mapping.test.ts`: Slack's array auth gives the `CUSTOM_AUTH` fields `botToken` and `userToken`, both `writeOnly`, with `botToken` required.
- `mapping.test.ts`: an `OAUTH2`-only piece gives no adapter.
- `mapping.test.ts`: each prop type gives its JSON type, and a `MARKDOWN` prop is not in the input.
- `mapping.test.ts`: an action with a required `FILE` prop is not a capability.
- `mapping.test.ts`: `checkAdapter` accepts each adapter.
- `pnpm -s typecheck` passes.

## Resume

- **Done so far:** `src/mapping.ts` holds `nameOf`, `entryOf`, `propOf`, `inputOf`, `schemaOf` and `adapterOf`.
  `adapterOf` turns one described piece into an adapter. It answers one note for each action it leaves out, and for a piece whose auth it does not offer.
  `plugin.ts` registers one adapter for each described piece and reports each note through `host.problem`.
  The adapter takes the piece's `displayName` as its title and its `description` as its description.
  `mapping.test.ts` passes all eight cases, including `checkAdapter` over a simple adapter and a Slack-shaped one, and `pnpm -s typecheck`, `pnpm -s build` and `pnpm -s boundary` pass.
- **Next action:** task 03, which gives the adapter its `run`.
- **Files:** `packages/activepieces/src/mapping.ts`, `packages/activepieces/src/plugin.ts`, `packages/activepieces/src/wire.ts`, `packages/activepieces/src/child.ts`, `packages/activepieces/test/mapping.test.ts`, `packages/activepieces/test/child.test.ts`.
- **Open questions:** the Steps say an array auth uses its first entry that is not `OAUTH2`. Step 5 skips a piece with no `SECRET_TEXT` or `CUSTOM_AUTH` entry.
  For a list that holds a basic auth before a custom one, the two rules disagree. `entryOf` takes the first entry this plugin offers, so it never skips a piece that has one.
  No first piece has that shape, and Slack's `[OAUTH2, CUSTOM_AUTH]` answers the same either way.
- **Departures:** `PieceDescription` gained `displayName` and an optional `description`, and `child.ts` answers both. The adapter needs a title and a description, and the plan names neither.
  This touched two files of task 01, and `child.test.ts` now expects the piece name in its answer.
- **Watch out for:** `checkAdapter` is not in the SDK's public export, so `mapping.test.ts` imports it from `../../sdk/src/plugins/validate.js`, as `packages/webhook/test/webhook-kind.test.ts` imports from the SDK source.
