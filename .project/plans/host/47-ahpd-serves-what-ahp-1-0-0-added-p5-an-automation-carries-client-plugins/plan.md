---
title: An automation carries the client plugins its template names
domain: host
status: built
priority: low
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
  - plans/host/49-a-session-loads-a-clients-plugins/plan.md
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L231](../../../../packages/sdk/src/host/handshake.ts#L231) - the automation capabilities ahpd advertises"
  - "[code://packages/sdk/src/host/actions.ts#L403-L423](../../../../packages/sdk/src/host/actions.ts#L403-L423) - `automation/createRequested` and `updateRequested`, handed to the store as sent"
  - "[code://packages/sdk/src/automations.ts#L95-L125](../../../../packages/sdk/src/automations.ts#L95-L125) - the store keeps a definition as sent, `session.customizations` included"
  - "[code://packages/sdk/src/automations.ts#L139-L178](../../../../packages/sdk/src/automations.ts#L139-L178) - a run reads the template's provider, folders, config and model, and nothing else"
  - "[code://packages/sdk/src/host/actions.ts#L454-L509](../../../../packages/sdk/src/host/actions.ts#L454-L509) - `session/activeClientSet` keeps a client's `tools` and passes its `customizations` on unread"
  - "[code://packages/sdk/src/host/relay.ts#L72-L93](../../../../packages/sdk/src/host/relay.ts#L72-L93) - `clients`, the server-to-client `resource*` requests a capture would read with"
  - "[code://.project/plans/acp/11-the-agent-gets-mcp-servers/deferred.md](../../../../.project/plans/acp/11-the-agent-gets-mcp-servers/deferred.md) - \"this host has no client plugin customizations\""
  - "[code://.project/plans/host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/task-01-a-definition-with-a-kind-twice-is-refused.md](../../../../.project/plans/host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/task-01-a-definition-with-a-kind-twice-is-refused.md) - the refusal at the same place, the pattern task 01 copies"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `AutomationSessionTemplate.customizations`: client plugins in the shape of `activeClients[].customizations`; the host captures a copy on a create or update that adds an entry or changes its `uri` or `nonce`, reading client-served URIs from the dispatching client, and rejects the whole action if a capture fails; clients MUST NOT set it unless the host advertises `AutomationCapabilities.customizations` (`channels-automation/state.ts:321-346`); `AutomationEntry.customizations`, the host-owned copies every run session receives (`:441-456`); `AutomationCustomizationsCapability`, an empty presence object (`common/commands.ts:333-350`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L165-L173 - VS Code advertises `customizations: {}`"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostAutomationCustomizations.ts#L37-L108 - `capture`: unique non-empty ids, an unchanged `uri` and `nonce` keeps the old copy, a new one is copied from the client into a content-addressed folder and parsed; `toRunActiveClient` hands the copies to the run session as an active client's plugins"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L695-L696 - a run starts with the captured plugins as an `Automation` active client"
  - "https://github.com/microsoft/agent-host-protocol/commit/9f94039 - client plugin customizations on automations (#474)"
---

## Goal

An automation can name client plugins that every run of it loads, as VS Code's agent host does.
They are captured when the automation is saved, so a run needs no client connected.
A host with nowhere to copy them says it cannot, and refuses a template that names any.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "customizations" packages/sdk/src/automations.ts packages/sdk/src/host.ts` - an automation's `session.customizations` is stored and never read; an active client's `customizations` are dispatched and never read.
- `rg -n -i "client plugin" .project` - acp/11's deferred list: "this host has no client plugin customizations".
- `rg -n "customizations" src/vs/platform/agentHost/node/agentHostAutomation*.ts` in the VS Code clone - capture on create and update, garbage collection of unused copies, and the copies handed to a run as an active client.

### Gaps

- ahpd stores a template's `customizations` silently, though it does not advertise them and no run would load them.
- ahpd has no client plugin customizations in a session, which capture and run both stand on.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| While ahpd does not advertise `AutomationCapabilities.customizations`, a create or update whose template carries a non-empty `customizations` is refused, and the store is not called | AHP 1.0.0: clients MUST NOT set it unless the host advertises it; (defaulted: refusing is what a host does with a field it cannot honour, as host/44 p2 does with a duplicate condition) | 01 |
| Client plugins in sessions are planned now, as host/49, and task 02 captures an automation's plugins on top of it | Softov, 2026-10-03, asked "an automation's client plugins need sessions that load a client's plugins, which ahpd does nowhere. What now?": "Plan client plugins now" | 02 |
| An automation's copies live at `<agentPlugins dir>/automations/<sha256 of uri and nonce>`, captured by a `ClientPlugins` method that reuses its copy code; they are not in `lru.json`, and a run is handed them as an `Automation` active client with host `file:` URIs, served in place | Softov, 2026-10-09, asked where an automation's captured copies live: "agentPlugins/automations"; VS Code `agentHostAutomationCustomizations.ts#L22-L105` | 02 |
| Task 02 lifts task 01's refusal and advertises `customizations: {}` | (defaulted: the refusal exists only until a run can load the plugins) | 02 |
| `automation/createRequested` and `updateRequested` keep asking `automation:write` today, and `automation:create` and `automation:update` once host/46 lands | host/46 task 02's table | 01 |

## Proposed architecture

- **Data flow** - a template naming plugins and no client plugins directory -> `no(...)`. With a directory -> capture through `clients.read`/`list` into `<dir>/automations/` -> `AutomationEntry.customizations` -> a run session carrying them.
- **Layer responsibilities** - sdk host: the refusal and the capture · sdk automations: the copies on the entry and the run · sdk clientplugins: where the copies live.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts), [`code://packages/sdk/src/host/relay.ts`](../../../../packages/sdk/src/host/relay.ts), [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A template that names client plugins is refused while the host does not advertise them](task-01-a-template-with-client-plugins-is-refused.md) | done | - |
| [02 - The host captures a template's client plugins and runs with them](task-02-the-host-captures-a-templates-client-plugins.md) | done | 01, and host/49 built |

## Risks and tradeoffs

- A client that ignores the MUST NOT is refused on a host with no client plugins directory, where it used to be accepted. On a host with one its plugins are copied. Nothing in this workspace sends them.
- A copy handed to a run session is never reclaimed while that host runs. The set of them is what spares it, and nothing empties that set. That is VS Code's own `_usedByRuns`, and the price is a copy per automation ever run in that process.

## Resume state

- **Done so far:** task 01 and task 02, both implemented 2026-10-09. A template naming plugins is refused on a host with no client plugins directory. On one that has it each plugin is copied into `<dir>/automations/<sha256 of uri and nonce>` before the store. A run puts an `Automation` active client on the session it starts, so the copies load with nobody connected. The advertised capabilities carry `customizations` only beside that directory.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none. Softov answered the two that were here on 2026-10-09. The copies live under the client plugins directory in `automations/`, and a run gets them as an `Automation` active client of its own session.
- **Watch out for:** host/44 p2 task 01 landed first, so `disableConditionsProblem` and task 01's refusal sit together before the store, in that order. [`code://packages/sdk/src/clientplugins.ts`](../../../../packages/sdk/src/clientplugins.ts) now holds two kinds of copy. The session's are in the LRU order and evicted. An automation's are outside it, and one goes when the automation does and no run holds it. A run holds its copies for as long as the process, so a removed automation's copy waits for the host to exit.

## Final verification checklist

- [x] A template with plugins is refused with no client plugins directory, and captured with one, so a run loads them.
- [x] `pnpm test` passes.
- [x] `plans/index.md` updated (2026-10-09, task 02 implemented).
