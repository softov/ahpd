---
title: Claude offers "always allow" from its suggestions
status: todo
depends: [task-01-confirm-carries-the-picked-option.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1765](../../../../packages/agent-claude/src/session.ts#L1765) - `canUseTool`; `asked.suggestions` is never read"
  - "[code://packages/agent-claude/src/session.ts#L1889-L1910](../../../../packages/agent-claude/src/session.ts#L1889-L1910) - the ready action and the pending entry"
  - "[code://packages/agent-claude/src/session.ts#L119](../../../../packages/agent-claude/src/session.ts#L119) - `PendingInput.settle`, which has no `updatedPermissions`"
  - "[code://packages/agent-claude/src/session.ts#L3283-L3321](../../../../packages/agent-claude/src/session.ts#L3283-L3321) - `confirm`"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `PermissionUpdate` (`addRules`, `setMode`, `addDirectories`, with a `destination`) and `PermissionResult.updatedPermissions`
---

## Objective

When the Claude SDK hands `canUseTool` suggestions, the approval offers Allow once, an "always" option labelled by what the suggestions do, and Deny; picking the "always" option returns the suggestions as `updatedPermissions`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1765-1910` - read `asked.suggestions`; when non-empty, put three options on the ready action and on the `toolConfirmation` entry, and keep the suggestions on the pending entry.
- `UPDATE: packages/agent-claude/src/session.ts:119` - `settle` takes an allow with `updatedPermissions`.
- `UPDATE: packages/agent-claude/src/session.ts:3283-3321` - an approve whose `optionId` is the "always" option settles with `updatedPermissions: suggestions`.
- `UPDATE: packages/agent-claude/test/` or `packages/sdk/test/host.test.ts` - the cases below, wherever the existing `canUseTool` approval cases live.

## Steps

1. Options: `allow-once` (approve, group 1), `allow-always` (approve, group 1), `deny` (deny, group 2).
2. The `allow-always` label names what the suggestions do: the rules they add (for example `Always allow Bash(npm test:*)`), a mode they set (for example `Allow edits for the rest of the session`), or the directories they add, joined when there are several, and says where it is kept when the destination is a settings file.
3. With no suggestions, no options are sent and the approval is approve or deny as today.
4. An approve with no option id, or with `allow-once`, settles with no `updatedPermissions`.

## Validation

- A case with `suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }], behavior: 'allow', destination: 'localSettings' }]`: the ready action carries three options, picking `allow-always` settles with those `updatedPermissions`, and a plain approve settles without; it fails first.
- A case with a `setMode` suggestion checks the label.
- The ready action validates against the protocol schema.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume
