---
title: A Claude session's model and a skill's argument hint are sent as ahpd keys
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L3125-L3127](../../../../packages/agent-claude/src/session.ts#L3125-L3127) - `_meta: { model }` on the session state"
  - "[code://packages/agent-claude/src/session.ts#L326](../../../../packages/agent-claude/src/session.ts#L326) - `_meta: { argumentHint }` on a skill customization"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L386](../../../../packages/sdk/src/host/sessionmethods.ts#L386) - `argumentHint` on a completion item, the reference client's, which stays"
  - "[code://docs/AHP.md#L556-L569](../../../../docs/AHP.md#L556-L569) - why the completion item's key is the reference's"
  - "file:///github/ahpc/src/ahp/live.ts - line 3166, the reader of `_meta.model`"
---

## Objective

A Claude session state carries `_meta['ahpd.model']` and a skill customization `_meta['ahpd.argumentHint']`; a completion item keeps the reference's `argumentHint`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:3126` - `ahpd.model`.
- `UPDATE: packages/agent-claude/src/session.ts:326` - `ahpd.argumentHint`; check where the host reads a skill's hint to build a completion item (`rg -n "argumentHint" packages/sdk/src/host/`, `sessionmethods.ts:290`) and read the new key there.
- `UPDATE: packages/agent-claude/test/*.test.ts` - assertions on either key.
- `UPDATE: packages/sdk/test/wire.test.ts` - `model` and the skill's `argumentHint` leave `PENDING`; its skill has a hint.

## Steps

1. Confirm ahpc's release reads `_meta['ahpd.model']` beside `_meta.model`; do not merge before.
2. Rename both producers and the host's reader of the skill hint, if it reads the customization.

## Validation

- `packages/sdk/test/wire.test.ts` passes with `model` and the skill's `argumentHint` gone from `PENDING`, and the completion item's `argumentHint` still allowed by `REFERENCE`.
- A completions test: the `/` menu still shows the skill's hint as ghost text.
- `pnpm test` passes.

## Resume

Implemented 2026-10-09, in the `build/agents/6dac4670` worktree.
Step 1 was already met: ahpc reads both names for the model since ahp/07 (a13ec65).
`packages/agent-claude/src/session.ts` sends `ahpd.model` on the state. `packages/agent-claude/src/session/customizations.ts` sends a skill's hint as `ahpd.argumentHint`. A completion item's `argumentHint` stays bare.
`packages/sdk/src/host/sessionmethods.ts` gains `hintOf`, which reads `argumentHint` (a prompt) and then `_meta['ahpd.argumentHint']` (a skill). Before this, the live slash menu never read a skill's hint at all; the new case in `host-harness.test.ts` fails without `hintOf`.
