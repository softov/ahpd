---
title: A customization switch is answered to the client that turned it
domain: host
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://ab07054c - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/chatactions.ts#L1268-L1421](../../../../packages/sdk/src/host/chatactions.ts#L1268-L1421) - `session/customizationToggled`: the switch kept, the list said, the client's own action never said back"
  - "[code://packages/sdk/src/host/tooling.ts#L947-L982](../../../../packages/sdk/src/host/tooling.ts#L947-L982) - `toggleClientPlugin`, which says the plugin's entry and nothing for the client's switch"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L371-L400 - the reducer applies `session/customizationToggled` to the entry it names"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L30 - a client holds its action until an envelope with its own origin, or a rejection, answers it"
  - "https://github.com/microsoft/agent-host-protocol/blob/main/docs/guide/mcp.md - `enablement` is toggled with `session/customizationToggled`, its first entry the effective decision"
---

## Goal

A client's `session/customizationToggled` is said back to every client of the session with its sender's origin, carrying the switch as this host made it, whether the backend switches the customization or this host switches a client's plugin; a switch the backend cannot make stays a refusal.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "customizationToggled" packages/sdk/src` - the host keeps the decision and says the list, or the plugin's entry, and nothing carries the client's origin.
- `rg "dispatch\(.*origin\)" packages/sdk/src/host/chatactions.ts` - an answer said after an await carries the origin it was given, as `session/configChanged` does.

### Gaps

- A switch the backend made is followed by `session/customizationsChanged` with no origin, so the client holds its switch as pending.
- A client plugin's switch is followed by `session/customizationUpdated` with no origin, the same way.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The switch is said back with its sender's origin, with the enablement this host applied | the reducer applies the action to the entry it names; `session/configChanged` carries the origin across an await | 01 |
| A switch the backend refuses stays a refusal, with the list said after it | the handler's own refusal | 01 |

## Proposed architecture

- **Event flow** - the client's switch reaches the host, which keeps or hands it on; once it is made, the host says the switch back with the client's origin and then the list, or the plugin's entry, that it reads from.
- **Layer responsibilities** - the host: answering the switch.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A customization switch is answered to the client that turned it](task-01-a-customization-switch-is-answered.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the switch said back carries the enablement this host applied, which is the session's own decision for a sender who may not keep one for every session.

## Final verification checklist

- [x] Each new case fails on `ab07054c` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors.
