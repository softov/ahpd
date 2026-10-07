---
title: The schema has one Partial per type, and SessionStatus as bit flags
status: done
depends: []
layer: "tools"
refs:
  - "[code://tools/schema.mjs#L88-L102](../../../../tools/schema.mjs#L88-L102) - `nameOf`, which names `Partial<SessionSummary>` and `Partial<ChatSummary>` alike"
  - "[code://tools/schema.mjs#L248-L255](../../../../tools/schema.mjs#L248-L255) - where a named object becomes a `$ref`"
  - "[code://tools/schema.mjs#L178-L183](../../../../tools/schema.mjs#L178-L183) - a union of literals becomes an `enum`, and `flagValues` at `:136-L146` is where the flags are closed"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionSummaryChangedParams.changes: Partial<SessionSummary>` (`channels-root/notifications.ts:147`), `SessionChatUpdatedAction.changes: Partial<ChatSummary>` (`channels-session/actions.ts:104`), `SessionStatus` (`channels-session/state.ts:58-71`), `SessionChatSummary.status` (`:559`)"
---

## Objective

`tools/ahp.strict.schema.json` has a definition per instantiated `Partial<T>`, each checking `T`'s fields with none required, and `SessionStatus` accepts any combination of its flags and nothing else.

## Files

- `UPDATE: tools/schema.mjs:88-102` - `nameOf` names a mapped or generic alias by its alias and its type arguments: `Partial<SessionSummary>` is `PartialSessionSummary`.
- `UPDATE: tools/schema.mjs:136-146` - a numeric enum whose members are bit flags is emitted as the `enum` of every OR of its members.
- `UPDATE: tools/ahp.strict.schema.json` - regenerated.
- `CREATE: packages/sdk/test/support/wire.ts` - `undeclaredIn`, the protocol's check over a host's frames, minus the one departure this host keeps.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - `defectsOf` goes through `undeclaredIn`.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - the whole-wire check goes through `undeclaredIn`.

## Steps

1. In `nameOf`, append each argument's own name when `type.aliasSymbol` has `aliasTypeArguments`. Fall back to inlining when an argument has no name.
2. In `schemaOf`, a union of number literals becomes every OR-combination of its members, 64 values at most. Do that when every member is a power of two or an OR of other members. Name the rule in a comment for the next flag enum.
3. Regenerate and check the output: `PartialSessionSummary.properties.origin` is the session's and `PartialChatSummary.properties.origin` the chat's. `PartialSessionSummary` carries `chats` (items `SessionChatSummary`) and `defaultChat`. No `Partial` entry remains.
4. The flag rule applies to the type, so `SessionChatSummary.status` gets it with the rest; the validation asserts it there too.
5. The schema checks a summary row's `activity` now. This host sends `null` there on purpose, so the whole-wire suites drop that finding through `undeclaredIn`.

## Validation

- In `packages/sdk/test/wire.test.ts`, use the `a capture line` block or one beside it. `root/sessionSummaryChanged` with `changes: { project: {...}, _meta: {...} }` passes, and with `changes: { invented: 1 }` fails. `session/chatUpdated` with a chat-only field passes. A session state with `status: 33` passes and `status: 4` fails. `root/sessionSummaryChanged` with `changes: { chats: [{ resource, title, status: 33 }], defaultChat }` passes. A chat `status: 4` or an undeclared key on a chat entry fails.
- `node tools/schema.mjs` prints no `Partial` among the definitions, and `pnpm test` passes.

## Resume

Built. `node tools/schema.mjs` emits `PartialSessionSummary` and `PartialChatSummary` with no `Partial` left. The `the generated schema` and the `the protocol’s maps` blocks in `packages/sdk/test/wire.test.ts` prove the rest. The stricter partial newly flagged a summary row's `activity: null` in two more suites, which now drop that one kept departure.
