---
title: A session reports the plugins a client hands it
status: todo
depends: [task-01-a-clients-plugin-is-copied-to-the-host.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L10273-L10322](../../../../packages/sdk/src/host.ts#L10273-L10322) - `session/activeClientSet`, where the copy starts"
  - "[code://packages/sdk/src/host.ts#L2445-L2455](../../../../packages/sdk/src/host.ts#L2445-L2455) - `leaves`, where a client's plugins go"
  - "[code://packages/sdk/src/host.ts#L11219-L11237](../../../../packages/sdk/src/host.ts#L11219-L11237) - `session/customizationToggled`, which a client plugin's id now answers here"
  - "[code://packages/sdk/src/host.ts#L3688-L3700](../../../../packages/sdk/src/host.ts#L3688-L3700) - `spawn`, whose emitter routes a backend's `session/customizationsChanged`"
  - "[code://packages/sdk/test/presence.test.ts](../../../../packages/sdk/test/presence.test.ts) - announcing and leaving a session"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentPluginManager.ts#L104-L175 - `loading`, then `loaded` or `error`"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentSideEffects.ts#L370-L383 - a toggle on a client plugin"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ClientPluginCustomization.nonce` and `childEnablement`; `ContainerCustomizationBase.clientId` and `load`; `session/customizationUpdated`"
---

## Objective

The `customizations` a client announces with `session/activeClientSet` appear in the session's customizations, each with the client's `clientId` and a `load` that goes `loading` and then `loaded` or `error`; a toggle turns one off or on; the client leaving takes them away.

## Files

- `UPDATE: packages/sdk/src/host.ts` - per session, per client: the announced plugins, their `load`, their copies and their enablement; `activeClientSet` with `customizations` syncs through `options.clientPlugins`; the host's entries are laid after the backend's wherever a session's customizations go out (the snapshot and each routed `session/customizationsChanged`); `customizationToggled` on a client plugin's URI is answered by the host and not the backend; `leaves` drops the client's entries.
- `UPDATE: packages/sdk/test/presence.test.ts` or `CREATE: packages/sdk/test/client-plugins-session.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - the `activeClientSet` row says customizations are read, and the `session/customizationUpdated` row.

## Steps

1. On `activeClientSet`, compare the announced plugins by `(uri, nonce)` with what is held; for each new one dispatch `session/customizationUpdated` with `load: loading`, sync, then `session/customizationUpdated` with `loaded` or `error`, then one `session/customizationsChanged`.
2. Without `options.clientPlugins`, each plugin goes straight to `error` "this host keeps no client plugins".
3. A toggle sets the plugin's session enablement and re-reports; `childEnablement` marks the children it names disabled.
4. `leaves` drops the client's entries and re-reports.

## Validation

- A fake client announcing one plugin over a temp-directory `clientPlugins`: subscribers see `customizationUpdated` `loading` then `loaded` with the client's `clientId`, then `customizationsChanged` listing the backend's entries and the plugin; announcing the same plugin and nonce again dispatches nothing; a plugin whose read fails ends `error` with the message; a host without the port reports `error`; toggling the plugin off reports it disabled and the backend's `setCustomizationEnabled` is not called; the client unsubscribing removes the plugin from the list.
- `pnpm test` passes.

## Resume
