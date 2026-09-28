---
title: Claude offers "always allow" from its suggestions
status: implemented
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

Built, in `packages/agent-claude/src/session.ts`.
`canUseTool` reads `suggestions` off its third argument; when there are any, the call, its `chat/toolCallReady` and the `toolConfirmation` entry's `toolCall` carry `allow-once` (approve, group 1), `allow-always` (approve, group 1) and `deny` (deny, group 2), and the pending entry keeps the options and the suggestions.
With no suggestions nothing changes.
`keptLabel` names what the suggestions do: `Always allow Bash(ls:*)` for rules, `Allow edits` for an `acceptEdits` mode and `Switch to <mode> mode` for another, `Allow access to <dirs>` for directories, each followed by where it is kept (`for the rest of the session`, `kept in local settings`, `kept in project settings`, `kept in user settings`, nothing for `cliArg`), joined with `; `.
`PendingInput.settle` takes an allow with `updatedPermissions`, and the confirmation's wrapper passes it on beside the call's own input.
`confirm(toolCallId, approved, optionId)` settles with `updatedPermissions: suggestions` only when the picked option is `allow-always`; an approve with no option or with `allow-once` settles without.
The echo carries `selectedOptionId` when an offered option of the answer's kind was picked, and the held call drops `options` and keeps `selectedOption`.

Tests, in `packages/sdk/test/host.test.ts`, `driving a turn > an approval that can be kept`:

- `offers allow once, always allow and deny, and returns the suggestions when always is picked`: the ready and the entry carry the three options, labelled `Always allow Bash(ls:*), kept in local settings`; picking `allow-always` settles `{ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: <the addRules suggestion> }`; the echo carries `selectedOptionId`; the ready, the entry and the echo validate with `checker`.
- `keeps nothing when the approval picked no option, or allow once`.
- `says what a mode suggestion does`: `setMode` `acceptEdits` to `session` is labelled `Allow edits for the rest of the session`.
- `offers no options when the SDK suggested nothing`.

Failed first: the first with `expected undefined to deeply equal [ { id: 'allow-once', ... } ]` (no options), the third reading `find` of undefined; the second and fourth passed before, as they pin today's behaviour.

Departures and questions for review:

- The label wording is mine; the plan gives examples only.
- An option whose kind does not match `approved` is ignored, as on ACP.
- The suggestions are offered as one "always" option whatever their `behavior`, so an `addRules` suggestion with `behavior: 'deny'` would read `Always deny ...` on an approve option; the SDK has not been seen to suggest one on an ask.
- The first test checks the entry before answering, because the entry holds the live call object that the answer moves to `running`; the host's replay of a held `session/inputNeededSet` would show the moved call too, which was already so before this task.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1541 tests, 1540 passed; the one failure was `advertises exactly the ports it was given, and nothing more` in `agent-acp-ports.test.ts`, the known flake; that file alone passed 8 of 8 on two of three runs and failed that same case on the third, a test that asks no permission.
