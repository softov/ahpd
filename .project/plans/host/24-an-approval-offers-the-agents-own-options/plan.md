---
title: An approval offers the agent's own options, and the one picked reaches the agent
domain: host
status: planned
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions:
  - decisions/each-backend-offers-its-own-approval-options.md
refs:
  - "[code://packages/sdk/src/types/session.ts#L381-L382](../../../../packages/sdk/src/types/session.ts#L381-L382) - `confirm(toolCallId, approved)`, which carries no option"
  - "[code://packages/sdk/src/host.ts#L8955-L8957](../../../../packages/sdk/src/host.ts#L8955-L8957) - the host drops the action's `selectedOptionId`"
  - "[code://packages/sdk/src/nested.ts#L476-L477](../../../../packages/sdk/src/nested.ts#L476-L477) - the nested proxy re-dispatches the answer with `approved` only"
  - "[code://packages/agent-claude/src/session.ts#L1765](../../../../packages/agent-claude/src/session.ts#L1765) - `canUseTool`, whose third argument carries `suggestions`, never read"
  - "[code://packages/agent-claude/src/session.ts#L3283-L3321](../../../../packages/agent-claude/src/session.ts#L3283-L3321) - claude's `confirm`, which settles allow or deny with no `updatedPermissions`"
  - "[code://packages/agent-acp/src/session.ts#L388-L445](../../../../packages/agent-acp/src/session.ts#L388-L445) - `askPermission`, which keeps only the once options and emits no pending `chat/toolCallReady`"
  - "[code://packages/agent-acp/src/session.ts#L1050-L1073](../../../../packages/agent-acp/src/session.ts#L1050-L1073) - the ACP answer, `allow` or `reject`"
  - "[code://packages/agent-cofold/src/mapping.ts#L381-L436](../../../../packages/agent-cofold/src/mapping.ts#L381-L436) - cofold's `approval.requested`, drawn with no options"
  - "[code://packages/agent-cofold/src/session.ts#L1350-L1388](../../../../packages/agent-cofold/src/session.ts#L1350-L1388) - cofold's `confirm`, which never sends `alwaysApprove`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `ConfirmationOption` (`id`, `label`, `kind`, `group`) on `chat/toolCallReady.options`, `selectedOptionId` on `chat/toolCallConfirmed`, and the reducer's `selectedOption`
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `CanUseTool`'s `suggestions: PermissionUpdate[]`, returned as `updatedPermissions` for an "always allow"
  - npm://@agentclientprotocol/sdk@1.4.0 - `PermissionOption` with kind `allow_once`, `allow_always`, `reject_once`, `reject_always`
  - npm://@cofold/agents@^0.1.1 - `alwaysApprove` on an approve command, remembered per session and tool name
---

## Goal

An approval shows the choices the agent itself has, such as Claude's "always allow" rule, an ACP agent's `allow_always`, or cofold's "allow this tool for the session", and the choice the person picks is the one the agent receives.
A backend whose agent has no such choice keeps plain approve and deny.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "selectedOptionId|ConfirmationOption" packages .project` - nothing outside the planned acp/07, whose work this plan takes over.
- The reference offers Allow in this Session, Allow Once and Skip and keeps the session answer itself (`sessionPermissions.ts:57-66`, `490-509`); its agent receives only a boolean.

### Runtime path

```
agent asks -> backend: chat/toolCallReady { options } + inputNeeded toolConfirmation { toolCall.options }
client picks -> chat/toolCallConfirmed { approved, selectedOptionId } -> host -> session.confirm(id, approved, optionId)
  -> backend answers its agent with that option (updatedPermissions / optionId / alwaysApprove)
```

### Gaps

- `Session.confirm` has no place for an option, and the host and the nested proxy drop `selectedOptionId`.
- No backend puts `options` on a ready action.
- The ACP bridge answers `allow_once` or `reject_once` whatever the agent offered, and emits no pending-state `chat/toolCallReady` to carry options.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Each backend offers its own approval options, and the host remembers no approval](../../../decisions/each-backend-offers-its-own-approval-options.md) | 01-05 |

| What | Source | Task |
| --- | --- | --- |
| The ACP work planned in acp/07 is built here, and acp/07 is dropped. | Softov, 2026-09-28, asked how acp/07 relates to host/24: "Fold into host/24 (Recommended)". | 02 |
| An `always` is sent only when the person chose that option. | acp/07's row: never an `always` the person did not choose. | 02-04 |
| A client that sends no option id gets the once answer: allow once, or deny once. | acp/07's row, (defaulted: older clients keep working). | 01-04 |
| The options go on the ready action and on the `toolCall` of the `toolConfirmation` entry, so a client reading either sees them. | the protocol: a client renders the pending state's `options` | 02-04 |
| Approve options come first, grouped apart from deny options by `group`. | the protocol's `group`; acp/07's grouping | 02-04 |
| pi offers no options. | the decision above: pi has no "always" | - |

## Proposed architecture

- **Data flow** - the backend builds `ConfirmationOption`s from what its agent offers; the host carries `selectedOptionId` to `confirm` as `optionId`.
- **Layer responsibilities** - sdk: the `confirm` parameter and passing it through, host and nested proxy · agent-acp, agent-claude, agent-cofold: offering and acting on options.
- **Source-of-truth files** - [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - confirm carries the option the person picked](task-01-confirm-carries-the-picked-option.md) | todo | - |
| [02 - An ACP agent's own options are offered, and the picked one answered](task-02-an-acp-agents-options-are-offered.md) | todo | 01 |
| [03 - Claude offers "always allow" from its suggestions](task-03-claude-offers-always-allow.md) | todo | 01 |
| [04 - cofold offers "allow for this session"](task-04-cofold-offers-allow-for-the-session.md) | todo | 01 |
| [05 - Docs](task-05-docs.md) | todo | 02, 03, 04 |

## Risks and tradeoffs

- `confirm` gains a parameter every backend sees; it is optional, so pi and any third-party backend compile and behave as before.
- Claude's suggestions can write to `userSettings` or `projectSettings`, so an "always allow" may outlive the session; the label says what it does and the person chooses it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-confirm-carries-the-picked-option.md](task-01-confirm-carries-the-picked-option.md).
- **Open questions:** none.
- **Watch out for:** the protocol field is `selectedOptionId`, not `optionId`; the reducer turns it into `selectedOption` on the call, so the backend's own echo of `chat/toolCallConfirmed` must carry it too.

## Final verification checklist

- [ ] A client that sends `selectedOptionId` reaches the backend's `confirm` with it, directly and through a nested host.
- [ ] ACP: an agent offering `allow_always` receives it when it is picked, and `allow_once` when approve carries no option.
- [ ] Claude: "always allow" returns the call's suggestions as `updatedPermissions`; a plain approve returns none.
- [ ] cofold: "allow for this session" sends `alwaysApprove`, and the next call of that tool does not ask.
- [ ] Every ready action with options validates against the protocol schema.
- [ ] VS Code or ahpapp shows the options in its approval dropdown.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
