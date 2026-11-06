---
title: The rule is read in the approval check
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/vscoderootconfig.ts#L112-L117](../../../../packages/sdk/src/vscoderootconfig.ts#L112-L117) - `globalAutoApproveEnabled`, the pattern for a host key"
  - "[code://packages/sdk/src/host/gate.ts#L274-L298](../../../../packages/sdk/src/host/gate.ts#L274-L298) - a host key needs `config:change`"
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L1921-L1933 - `getToolFullReferenceName`
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L1348-L1370 - `isToolEligibleForAutoApproval`
---

## Objective

The check on `Start` from host/100 reads the rule first.
A matched tool gets the answer "ask, and offer no always option".
This task needs host/100 p2 task 01.

## Files

- `UPDATE: packages/sdk/src/vscoderootconfig.ts` - declare `eligibleForAutoApproval`, a map of tool name to boolean, as VS Code.
- `UPDATE: packages/sdk/src/types/agent.ts` - the check's answer gains "ask, with no always option".
- `UPDATE: packages/sdk/src/host/spawn.ts` - the check reads the rule before the terminal rules.
- `UPDATE: packages/sdk/test` - the matcher, and the order against the terminal rules.

## Steps

1. Confirm that host/100 p2 task 01 is `implemented`.
2. Declare `eligibleForAutoApproval` as a host key, which every window's push sets for the whole host, so a push needs `config:change`.
3. Match `<server>/<tool>` keys exactly, and `<server>/*` keys for every tool of that server.
4. Return "ask, with no always option" for a matched tool, before the terminal rules run.
5. Write the tests.
6. Set this task and the plan row to `implemented`.

## Validation

- The sdk tests pass.
- A tool matched by both this rule and a terminal allow rule asks.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** 2026-10-19. `eligibleForAutoApproval` is declared in `vscoderootconfig.ts` as VS Code declares it, where `false` means ask. It is a host key: a member's push is refused for want of `config:change`, and an admin's is echoed. `Start.getAutoApproval` takes a kind, `'shell'` or `'tool'`, plus the optional shell and the tool that runs a line. It answers `AutoApproval | undefined`, and the new `'ask'` is the rule's answer. The check reads the rule before the terminal rules, without a connection. It matches an exact key first and then `<server>/*`. A `shell` call whose tool is named asks even when a terminal rule approves the line. Tests: `packages/sdk/test/autoapproval.test.ts` (8) and `packages/sdk/test/root-config.test.ts` (31). The whole sdk suite passes (163 files, 3228 tests).
- **Next action:** task 02 reads the new answer for a tool in the Claude backend.
- **Open questions:** none.
- **Watch out for:** VS Code's value `false` means "always ask"; keep that sense. A `true`, a missing key and a value that is not a boolean all leave the tool as it was.
