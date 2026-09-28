---
title: cofold opens a part per block live
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L786](../../../../packages/agent-cofold/src/session.ts#L786) - the markdown part announced at turn start"
  - "[code://packages/agent-cofold/src/mapping.ts#L188-L225](../../../../packages/agent-cofold/src/mapping.ts#L188-L225) - one reasoning part per turn"
  - "[code://packages/agent-cofold/src/transcript.ts#L297-L303](../../../../packages/agent-cofold/src/transcript.ts#L297-L303) - the transcript's per-block ids, which live must match"
---

## Objective

A cofold turn shows live the same parts, in the same order and with the same ids, as its transcript shows after a reload.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:786` - a turn starts with no part.
- `UPDATE: packages/agent-cofold/src/mapping.ts:188-225` - a part per reasoning or text block, keyed `${message.id}:${index}` as the transcript keys it.
- `UPDATE: packages/agent-cofold/test/` - the cases below.

## Steps

1. Read how cofold's run events name a message and a block, and key live parts as `transcript.ts` does.

## Validation

- A case: a cofold turn that thinks, calls a tool, thinks and replies gives, live, the parts `transcript.ts` builds from the same run, in the same order; today live merges the thoughts and puts the text first, so it fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

A cofold turn starts with no part, live and when a paused run is resumed; `mapping.ts` counts `model.started` and opens a step's reasoning or text part where the step starts writing that kind, one of each per step as cofold's adapters gather them.
Each part is announced once as a copy and appended with `chat/reasoning` or `chat/delta`, and the non-streaming `model.completed` fallback opens its parts the same way, in the order the reply holds them.
The ids are `${turnId}:${step}:${index}`, not the transcript's `${message.id}:${index}`: cofold's `model.delta` names no message or block, and the adapter mints the message id only when the reply is whole, after its deltas; the live turn id already differs from the transcript's, which is the user message id.
Thinking, tool, thinking, text now gives live `[t1:1:0 reasoning THINK-1, c1, t1:2:0 reasoning THINK-2, t1:2:1 markdown REPLY]` and the transcript `[m1:0, c1, m2:0, m2:1]` with the same kinds, contents and order.
The case in `packages/agent-cofold/test/agent-cofold-store.test.ts` failed first, with live `[markdown REPLYREPLY, reasoning THINK-1THINK-2, c1]`; two cases in `agent-cofold-turn.test.ts` were changed, because an unstreamed reply now shows its reasoning before its text, as the transcript does.
Gates: `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` 107 files and 1521 tests passed.
