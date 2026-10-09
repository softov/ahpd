---
title: Usage extensions are ahpd keys in every backend, and the meter reads them
status: done
depends: []
layer: "agent-claude, agent-acp, agent-pi, agent-cofold, sdk"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1291](../../../../packages/agent-claude/src/session.ts#L1291) - `cacheWriteTokens`"
  - "[code://packages/agent-claude/src/session.ts#L2890](../../../../packages/agent-claude/src/session.ts#L2890) - `cost`"
  - "[code://packages/agent-acp/src/mapping.ts#L406-L414](../../../../packages/agent-acp/src/mapping.ts#L406-L414) - `context`, `cost`"
  - "[code://packages/agent-acp/src/session.ts#L1332-L1351](../../../../packages/agent-acp/src/session.ts#L1332-L1351) - the four keys, and `context` read back"
  - "[code://packages/agent-pi/src/mapping.ts#L159](../../../../packages/agent-pi/src/mapping.ts#L159) - `cacheWriteTokens`"
  - "[code://packages/agent-pi/src/mapping.ts#L185-L208](../../../../packages/agent-pi/src/mapping.ts#L185-L208) - the running sum reads and writes `cacheWriteTokens` and `cost`"
  - "[code://packages/agent-cofold/src/mapping.ts#L104-L123](../../../../packages/agent-cofold/src/mapping.ts#L104-L123) - `cacheWriteTokens`, `reasoningTokens`, `cost`"
  - "[code://packages/agent-cofold/src/transcript.ts#L63-L74](../../../../packages/agent-cofold/src/transcript.ts#L63-L74) - the two token keys, restored"
  - "[code://packages/sdk/src/meter.ts#L99-L147](../../../../packages/sdk/src/meter.ts#L99-L147) - reads `cost` and `cacheWriteTokens`"
  - "file:///github/ahpapp/src/blocks.ts - lines 457-458, the token readers"
  - "file:///github/ahpapp/src/components/RawView.tsx - lines 592 and 594"
---

## Objective

Every backend's usage carries `_meta['ahpd.cacheWriteTokens']`, `['ahpd.reasoningTokens']`, `['ahpd.cost']` and `['ahpd.context']` where it carries them today, live and restored, and the meter counts the same totals from the new keys.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1291, 2890`.
- `UPDATE: packages/agent-acp/src/mapping.ts:406-414`, `packages/agent-acp/src/session.ts:1332-1351`.
- `UPDATE: packages/agent-pi/src/mapping.ts:159, 185-208`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:104-123`, `packages/agent-cofold/src/transcript.ts:63-74`.
- `UPDATE: packages/sdk/src/meter.ts:99-147` - `metaOf(usage)['ahpd.cost']` and `['ahpd.cacheWriteTokens']`; the meter's own output fields keep their names.
- `UPDATE: packages/agent-*/test/agent-*-usage.test.ts`, `packages/sdk/test/usage-meter.test.ts`, `packages/agent-pi/test/agent-pi.test.ts` - the new keys, and p1's `metaKeys` census over every usage they produce.
- `UPDATE: packages/sdk/test/wire.test.ts` - `cacheWriteTokens` and `cost` leave `PENDING`; its claude result has cache writes and a cost.
- `UPDATE: docs/AHP.md` - wherever usage's `_meta` is described.

## Steps

1. Confirm ahpapp's release reads `ahpd.cacheWriteTokens` and `ahpd.reasoningTokens` beside the old names; do not merge before.
2. Rename each producer, and in the same change each reader inside ahpd: pi's running sum, acp's `context` read-back, the meter.
3. Do not send the reference's numeric `_meta.cost`.

## Validation

- `packages/sdk/test/wire.test.ts` passes with `cacheWriteTokens` and `cost` gone from `PENDING`.
- Each backend's usage test asserts the `ahpd.` keys and runs the census, which finds no bare usage key; `usage-meter.test.ts` gives the same totals as before for the same turns.
- `pnpm test` passes.

## Resume

Implemented 2026-10-09, in the `build/agents/6dac4670` worktree.
Step 1 was already met: ahpapp reads both names since host/05 (a66f582).
`cacheWriteTokens`, `reasoningTokens`, `cost` and `context` are `ahpd.*` in agent-claude (`session/parts.ts`, `session/query.ts`), agent-acp (`mapping.ts`, `session/turn.ts`), agent-pi (`mapping.ts`) and agent-cofold (`mapping.ts`, `transcript.ts`). The readers moved with them: `packages/sdk/src/meter.ts`, pi's `addUsage`, and acp's `context` read-back. No numeric `_meta.cost` is sent. The timing keys were already `ahpd.` (plugin/29).
Each backend's usage test asserts its census of `ahpd.` keys. `wire.test.ts`'s `PENDING` is empty.
