---
title: A person answers with the agent's own permission options
domain: acp
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/session.ts#L387-L445](../../../../packages/agent-acp/src/session.ts#L387-L445) - approve is `allow_once`, deny is `reject_once`"
  - "[code://packages/agent-acp/src/session.ts#L1047-L1079](../../../../packages/agent-acp/src/session.ts#L1047-L1079) - the answer sent back"
  - "[code://packages/sdk/src/types/session.ts#L382](../../../../packages/sdk/src/types/session.ts#L382) - `confirm(toolCallId, approved)`, which carries no option"
  - "[code://packages/sdk/src/host.ts#L8622](../../../../packages/sdk/src/host.ts#L8622) - the host drops the action's `selectedOptionId`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `ConfirmationOption` on `chat/toolCallReady`, `selectedOptionId` on the confirmed action
---

## Goal

The options an agent offers in `session/request_permission` reach the client as AHP confirmation options, and the one the person picks is the one the agent receives, so "allow always" is available and is only ever the person's choice.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- The host drops `selectedOptionId`; `Session.confirm` has no place for it.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| An `always` is sent only when the person chose that option | what stays: never an `always` the person did not choose | 02 |
| A client that sends no option id gets today's once options | (defaulted: older clients keep working) | 02 |

## Proposed architecture

- **Layer responsibilities** - `@ahpd/sdk`: `confirm` carries the choice · `@ahpd/agent-acp`: offers the options and answers the chosen one.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Confirm carries the chosen option](task-01-confirm-carries-the-chosen-option.md) | todo | - |
| [02 - The agent's options are offered and the chosen one answered](task-02-the-agent-options-are-offered-and-answered.md) | todo | 01 |
| [02 - Docs](task-02-docs.md) | todo | 02 |

## Risks and tradeoffs

- `confirm` gains a parameter every backend sees - optional, and ignored by those without options.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-confirm-carries-the-chosen-option.md](task-01-confirm-carries-the-chosen-option.md).
- **Open questions:** none.
- **Watch out for:** the host's `toolConfirmation` input-needed entry must carry the options too, or a client that reads only that list shows approve and deny.

## Final verification checklist

- [ ] Choosing "allow always" sends that option; approving without a choice sends the once option.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
