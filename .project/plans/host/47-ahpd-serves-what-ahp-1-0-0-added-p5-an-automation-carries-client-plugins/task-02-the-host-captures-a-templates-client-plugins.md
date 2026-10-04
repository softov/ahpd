---
title: The host captures a template's client plugins and runs with them
status: blocked
depends: [task-01-a-template-with-client-plugins-is-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/relay.ts#L72-L93](../../../../packages/sdk/src/host/relay.ts#L72-L93) - `clients.read` and `clients.list`, the dispatching client's resources"
  - "[code://packages/sdk/src/automations.ts#L95-L125](../../../../packages/sdk/src/automations.ts#L95-L125) - the store, where `customizations` copies sit on the entry"
  - "[code://packages/sdk/src/automations.ts#L139-L178](../../../../packages/sdk/src/automations.ts#L139-L178) - a run's session options"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostAutomationCustomizations.ts#L37-L108 - the capture and the run hand-off to mirror"
  - "[code://.project/plans/host/49-a-session-loads-a-clients-plugins/plan.md](../../../../.project/plans/host/49-a-session-loads-a-clients-plugins/plan.md) - how a session loads a client's plugins, which this task stands on"
---

## Objective

Blocked until host/49 is built, which gives a session the client plugins it is handed.
Then: task 01's refusal goes, ahpd advertises `customizations: {}`; a create or update that adds a plugin, or changes one's `uri` or `nonce`, copies it from the dispatching client into a host folder keyed by `uri` and `nonce`, refuses the whole action if a copy fails, keeps an unchanged entry's copy, reports the copies in `AutomationEntry.customizations`, and starts every run with them as an `Automation` active client, as VS Code does.

## Files

- `UPDATE: packages/sdk/src/host/handshake.ts`, `packages/sdk/src/host/actions.ts` - the capability; the capture before the store; the run's active client.
- `UPDATE: packages/sdk/src/automations.ts`, `packages/sdk/src/scheduled.ts` - `customizations` on the entry, kept across a restart; copies no automation names are removed.
- `UPDATE: packages/sdk/test/automations.test.ts` - the cases below, with a fake client answering `resourceList` and `resourceRead` from a temp directory.

## Steps

1. Validate ids (non-empty, unique) as VS Code's `capture` does.
2. Copy into `<data dir>/automations/plugins/<sha256 of uri and nonce>` through a staging folder, then rename.
3. Hand the copies to the run session the way host/49 hands a client's plugins to a session, as an active client with `clientId` `Automation`, the copies' URIs being host paths so no client is asked at run time.

## Validation

- `packages/sdk/test/automations.test.ts`: a create with one plugin copies the client's files and the entry lists one copy with a host `uri`; an update with the same `uri` and `nonce` reads nothing from the client; a changed `nonce` copies again; a client that fails `resourceRead` gets the action refused and the entry unchanged; a run's session is started with the plugin; removing the automation removes the copy.
- `pnpm test` passes.

## Resume
