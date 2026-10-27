---
title: A cofold part is the protocol's
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts) - the cases through the host"
  - "[code://packages/agent-cofold/test/agent-cofold-compact.test.ts](../../../../packages/agent-cofold/test/agent-cofold-compact.test.ts) - the cases for a compaction"
---

## Objective

Every part of a cofold session is the protocol's part, live and restored.
A decision finds its call by the call's own id.

## Files

- `UPDATE: packages/agent-cofold/src/tools.ts:278-295` - `toolCallPart` makes a part with no `id`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:273-276` - the count of command notices goes, since it only numbered an `id`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:437-468` - the two notices have no `id`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:569` - the part of an unproposed call has no `id`.
- `UPDATE: packages/agent-cofold/src/transcript.ts:408` - the part of a restored call has no `id`.
- `UPDATE: packages/agent-cofold/src/pauses.ts:215` - a decision finds its call part by the call's `toolCallId`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - the case through the host.
- `UPDATE: packages/agent-cofold/test/agent-cofold-compact.test.ts` - the compaction case checks the keys of its notice.

## Steps

1. Remove `id` from the three tool call parts and the two notices.
2. Remove the count of command notices, and say what the count of compactions is for.
3. Find a decision's call part by the call's `toolCallId`.
4. Add the case through the host, and check the keys of the compaction notice.

## Validation

- Test that the protocol declares every frame, and that the late calls equal the replayed calls.
- Test that a compaction notice holds `kind` and `content` only.
- Run the cases on the session before this change, and see them fail.
- The agent-cofold suite passes.

## Resume

Done 2026-10-27.
The three tool call parts and the two notices have no `id`, and a decision finds its call part by the call's `toolCallId`.
The case and the compaction case fail before this change, and pass after it.

