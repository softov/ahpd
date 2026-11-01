---
title: The nested proxy says the outer names
status: done
depends: []
layer: "sdk sessions"
refs:
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - the proxy's status, its answers to the host, and what it relays"
---

## Objective

A nested session tells the outer host and its clients only names the outer host serves.
It says the inner host's activity as the inner reducer made it.

## Files

- `UPDATE: packages/sdk/src/sessions/nested.ts:1180-1186` - a chat's status is the mirror chat's activity bits.
- `UPDATE: packages/sdk/src/sessions/nested.ts:1223-1224` - `customizations()` and `allTurns()` answer under the outer names.
- `UPDATE: packages/sdk/src/sessions/nested.ts:882-906` - inner terminals are relayed and renamed; inner changesets, canvases and lead-chat rows are kept back.
- `UPDATE: packages/sdk/src/types/terminals.ts:319-322` - an output terminal takes `isPty`.
- `UPDATE: packages/sdk/src/host/terminals.ts:293-330` - the output terminal's state says it.

## Steps

1. Answer a chat's status from the mirror chat's activity bits.
2. Answer the customizations and the turns through `outward`.
3. Open an output terminal for each inner terminal a relayed action names, and copy the inner one into it.
4. Name the output terminal in place of the inner one.
5. Keep back the inner host's changeset and canvas lists, and its catalogue actions about the lead chat.
6. Run the nested suites.

## Validation

- A test of each change fails before it, for the reason the change names, and passes after it.
- `nested-proxy.test.ts` and `nested-background-tasks.test.ts` pass.

## Resume

Done; [implemented.md](implemented.md) says what was built.
The output terminal's `isPty` was not in the plan: a copy of a pseudoterminal needs it to say what its text is.
