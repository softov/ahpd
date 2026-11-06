---
title: cofold asks for a matched tool
status: done
depends: [task-01-the-rule-is-read-in-the-approval-check.md]
layer: agent-cofold
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L511-L580](../../../../packages/agent-cofold/src/mapping.ts#L511-L580) - `approval.requested` builds the options"
  - "[code://packages/agent-cofold/src/pauses.ts#L139-L180](../../../../packages/agent-cofold/src/pauses.ts#L139-L180) - `confirm` and `alwaysApprove`"
---

## Objective

A matched tool's question offers no `allow-session` option, and its answer never sends `alwaysApprove`.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:511-580` - remove the `allow-session` option for a matched tool.
- `UPDATE: packages/agent-cofold/src/pauses.ts:139-180` - never send `alwaysApprove` for a matched tool.
- `UPDATE: packages/agent-cofold/test` - a matched tool, and an unmatched one.

## Steps

1. Call the session's check for the tool in `approval.requested`.
2. Remove the `allow-session` option for a matched tool.
3. Send approve without `alwaysApprove` for a matched tool.
4. Find whether cofold can skip the question for a tool it already approved, and record it in Resume.
5. Write the tests.
6. Set this task and the plan row to `implemented`.

## Validation

- The agent-cofold tests pass.
- `pnpm -s build` and `pnpm -s typecheck` pass.

## Resume

- **Done so far:** 2026-10-19. `approval.requested` asks the live mapping whether the operator's rule names the tool. `TurnMappingOptions` gained `asksEveryTime`, and `turns.ts` answers it from `getAutoApproval`. A matched question and its ready carry `allow-once` and `deny` only. `autoApprove` reads the rule before the terminal check, so a matched `shell_exec` asks even when a rule allows the line. `confirm` reads the rule from the entry's tool name. It never sends `alwaysApprove` for a matched tool, even if a rebuilt card still offers the session choice. The replay mapping in `reopen` passes no `asksEveryTime`, so a restart consults no rules; the check stays out of `apply`. Tests: `packages/agent-cofold/test/agent-cofold-autoapproval.test.ts` (6), with two new ones: the matched question's choices, and a second turn that asks again after an `allow-session` answer. The whole agent-cofold suite passes (17 files, 232 tests).
- **Next action:** build [task-06-the-docs-name-the-rule.md](task-06-the-docs-name-the-rule.md).
- **Open questions:** none.
- **Watch out for:** cofold keeps an `alwaysApprove` in its own store, keyed by session and tool, and skips `approval.requested` for a tool it remembers. An approval remembered before the rule was set therefore still runs without asking, and the host cannot revoke it; task 06 says so. `autoApprove` and the mapping each read the rule for a matched shell call, so the callback is asked twice.
