---
title: The host captures a template's client plugins and runs with them
status: done
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

Ahpd advertises `customizations: {}` when it has a client plugins directory. A create or update whose template names plugins copies each one from the dispatching client into that directory. A copy that fails refuses the whole action. The copies go on `AutomationEntry.customizations`, and every run starts with them as an `Automation` active client of its session.

## Files

- `UPDATE: packages/sdk/src/host/handshake.ts` - the advertised `customizations` capability, present only beside a client plugins port.
- `UPDATE: packages/sdk/src/host/actions.ts` - the capture before the store, and the prune after a write and after a removal.
- `UPDATE: packages/sdk/src/host/automations.ts` - the `Automation` active client a run puts on the session it starts, and the copies the port is told to spare for it.
- `UPDATE: packages/sdk/src/host/tooling.ts` - `pluginsSettled`, so a run waits for the copy its session's plugins are still making.
- `UPDATE: packages/sdk/src/clientplugins.ts` - `capture`, `spare` and `prune`, over a folder outside the eviction order.
- `UPDATE: packages/sdk/src/types/clientplugins.ts` - `TemplatePlugin`, `CapturedPlugin` and the port's methods.
- `UPDATE: packages/sdk/src/types/automations.ts` - `customizations` on the entry, on the run's session options and on the store's two writes.
- `UPDATE: packages/sdk/src/automations.ts` - the memory store carrying the copies, and a run handing them to its session.
- `UPDATE: packages/sdk/src/scheduled.ts` - the copies written down and read back, so they survive a restart.
- `UPDATE: packages/sdk/test/automations.test.ts` - the cases below, with a fake client answering `resourceList` and `resourceRead` from a tree held in memory.
- `UPDATE: packages/sdk/test/scheduled.test.ts` - the copies across a restart, and a stored row that names no copy going.
- `UPDATE: docs/AHP.md` - the capability row, the two automation rows and `session/activeClientSet`.

## Steps

1. Validate ids (non-empty, unique) as VS Code's `capture` does.
2. Copy into `<agentPlugins dir>/automations/<sha256 of uri and nonce>` through a staging folder, then rename.
3. Hand the copies to the run session the way host/49 hands a client's plugins to a session, as an active client with `clientId` `Automation`, the copies' URIs being host paths so no client is asked at run time.

## Validation

- `packages/sdk/test/automations.test.ts`: a create with one plugin copies the client's files and the entry lists one copy with a host `uri`; an update with the same `uri` and `nonce` reads nothing from the client; a changed `nonce` copies again; a client that fails `resourceRead` gets the action refused and the entry unchanged; a run's session is started with the plugin; removing the automation removes the copy, unless a run was handed it.
- `pnpm test` passes.

## Resume

- **Status:** implemented, awaiting review.
- **Done:** [`code://packages/sdk/src/clientplugins.ts`](../../../../packages/sdk/src/clientplugins.ts) gained `capture`, `spare` and `prune`. The copies live at `<clientPluginsIn dir>/automations/<sha256 of uri and nonce>`, built in a `.building` sibling and renamed into place. They are absent from `lru.json` on purpose, so a session's eviction never reaches them. `capture` validates ids first and refuses the whole list rather than answering per plugin. It reads nothing when the folder it would write is already there. `spare` holds the copies a run was handed, and `prune` leaves those where they are.
- **Done:** [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) copies before the store, so a template whose plugins half-copied is never kept. It refuses the action when a copy fails, and prunes after a write and after a removal. [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) sets an `Automation` active client on the run's own session, through the presence a session's state is built from. That is the path `session/activeClientSet` takes. The copy is awaited first, because a backend takes its plugins when it starts. The same place hands the port the copies' own paths, so the prune that follows a removal leaves what a run is reading.
- **Files:** `docs/AHP.md` carries the `customizations` capability on the `initialize` row, and the capture and the prune on the two automation rows. It carries the `Automation` client on `session/activeClientSet`. None of it says where a copy lives, or that these copies are outside the order.
- **Tests:** `packages/sdk/test/automations.test.ts` gained the `a host that keeps client plugins` block. A create copies the client's tree and the entry lists one copy under a `file:` URI that is on disk. A patch with the same `uri` and `nonce` reads nothing from the client. A patch that moved the `nonce` copies again, and the copy the entry no longer names is gone. A patch with an empty list drops the copies and reads nothing. A `resourceRead` that fails refuses the patch and leaves the entry as it was. A list naming one id twice is refused in the port's words, before the store. A run's backend is started with the copy's path, and the run's session carries an `Automation` active client holding it. The run asks the client for nothing. Removing the automation removes the copy. One a run was handed stays, because the port holds what a run was given, as VS Code's `_usedByRuns` does. The capability is `{ create: {}, schedules: {}, customizations: {} }` on a host with the port. `packages/sdk/test/scheduled.test.ts` gained two cases: the copies come back across a restart, and a stored row naming no id or no URI reads as no copy.
- **Watch out for:** a run's copies are held for as long as the process, as VS Code's `_usedByRuns` is. So an automation run once and then removed gives its copy back only when the host exits. The set is never emptied, which is the reference's own behaviour and the price of a turn that outlives the write. Only a write and a removal prune, so a copy orphaned by a crash waits for the next write. `capture` is content addressed - `sha256` of the URI and the nonce. A template plugin with no `nonce` is therefore not re-copied when the client changes its content, where VS Code reuses the previous entry's copy.
