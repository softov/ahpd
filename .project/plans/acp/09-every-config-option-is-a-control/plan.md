---
title: Every option an agent offers is a control
domain: acp
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/acp/08-session-updates-reach-the-client/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/session.ts#L229-L245](../../../../packages/agent-acp/src/session.ts#L229-L245) - the schema: `permissionMode` and the model only"
  - "[code://packages/agent-acp/src/session.ts#L1099-L1140](../../../../packages/agent-acp/src/session.ts#L1099-L1140) - `setConfig`: any other key is refused"
  - "[code://packages/agent-acp/src/session.ts#L683-L688](../../../../packages/agent-acp/src/session.ts#L683-L688) - a turn naming a model fails when there is no `model` option"
  - npm://@agentclientprotocol/sdk - `SessionConfigOption`, boolean options, `setSessionConfigOption`
---

## Goal

Every select and boolean config option an ACP agent offers is a session control a client draws and sets; a `mode`-category option is preferred over the legacy `modes`; an agent that still reports the legacy `models` field has its models offered.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- Only the model and a legacy mode are controls; boolean options are not advertised; an older adapter's models make every turn that names one fail.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| An option's id is its schema key, under a prefix that cannot collide with the host's own keys | (defaulted: `acp.<id>`) | 01 |

## Proposed architecture

- **Layer responsibilities** - `session.ts` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Options are controls](task-01-options-are-controls.md) | done | - |
| [02 - The legacy models field is read](task-02-legacy-models.md) | done | - |

## Risks and tradeoffs

- A schema that changes after `session/new` - the options are only known then, which is already true of the model.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] Every offered option is a control that works.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
