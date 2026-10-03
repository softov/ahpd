---
title: The schema has one Partial per type, and SessionStatus as bit flags
status: todo
depends: []
layer: "tools"
refs:
  - "[code://tools/schema.mjs#L58-L64](../../../../tools/schema.mjs#L58-L64) - `nameOf`, which names `Partial<SessionSummary>` and `Partial<ChatSummary>` alike"
  - "[code://tools/schema.mjs#L176-L185](../../../../tools/schema.mjs#L176-L185) - where a named object becomes a `$ref`"
  - "[code://tools/schema.mjs#L109-L114](../../../../tools/schema.mjs#L109-L114) - a union of literals becomes an `enum`"
  - "npm://@microsoft/agent-host-protocol@0.9.0 - `SessionSummaryChangedParams.changes: Partial<SessionSummary>` (`channels-root/notifications.ts:146`), `ChatUpdatedAction.changes: Partial<ChatSummary>` (`channels-session/actions.ts:101`), `SessionStatus` (`channels-session/state.ts:56-69`)"
---

## Objective

`tools/ahp.strict.schema.json` has a definition per instantiated `Partial<T>`, each checking `T`'s fields with none required, and `SessionStatus` accepts any combination of its flags and nothing else.

## Files

- `UPDATE: tools/schema.mjs:58-64` - `nameOf` names a mapped or generic alias by its alias and its type arguments: `Partial<SessionSummary>` is `PartialSessionSummary`.
- `UPDATE: tools/schema.mjs:109-114` - a numeric enum whose members are bit flags is emitted as the `enum` of every OR of its members.
- `UPDATE: tools/ahp.strict.schema.json` - regenerated.

## Steps

1. In `nameOf`, when `type.aliasSymbol` has `aliasTypeArguments`, append each argument's own name; fall back to inlining when an argument has no name.
2. In `schemaOf`, for a union of number literals that `SessionStatus` is, emit every OR-combination of its members (64 values at most) when every member is a power of two or an OR of other members; name the rule in a comment for the next flag enum.
3. Regenerate and check `PartialSessionSummary.properties.origin` is the session's, `PartialChatSummary.properties.origin` the chat's, and no `Partial` entry is left.

## Validation

- `packages/sdk/test/wire.test.ts`, in the `a capture line` block or one beside it: `root/sessionSummaryChanged` with `changes: { project: {...}, _meta: {...} }` passes, with `changes: { invented: 1 }` fails; `session/chatUpdated` with a chat-only field passes; a session state with `status: 33` passes and `status: 4` fails.
- `node tools/schema.mjs` prints no `Partial` among the definitions, and `pnpm test` passes.

## Resume
