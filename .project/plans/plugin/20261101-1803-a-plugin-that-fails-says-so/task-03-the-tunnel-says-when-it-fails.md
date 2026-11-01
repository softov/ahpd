---
title: The tunnel says when it fails
status: todo
depends:
  - task-01-the-anonymous-flag.md
  - task-02-a-plugin-loaded-late-hears-listening.md
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L119-L141](../../../../packages/tunnel-devtunnel/src/plugin.ts#L119-L141) - `read`, which gets the `read` alert"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L144-L216](../../../../packages/tunnel-devtunnel/src/plugin.ts#L144-L216) - the `listening` handler, which gets the `tunnel` alert"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L218-L236](../../../../packages/tunnel-devtunnel/src/plugin.ts#L218-L236) - the `stopping` handler, which kills the child it asked to stop"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251) - `host`, which gets an exit callback"
  - "[code://packages/activepieces/src/plugin.ts#L341-L345](../../../../packages/activepieces/src/plugin.ts#L341-L345) - the alert pattern this task copies"
---

## Objective

Each failure of the Dev Tunnel plugin is an alert on its row, and the alert goes when the tunnel works again.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:119-141` - `read` raises and clears the `warning` alert with the `ref` `read`.
- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:144-216` - each `catch` raises the `error` alert with the `ref` `tunnel`; a hosted tunnel clears it.
- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:218-236` - marks the kill as asked for, so its exit raises nothing.
- `UPDATE: packages/tunnel-devtunnel/src/devtunnel.ts:239-251` - `host` takes an `onExit` callback and listens for `exit`.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the cases in *Validation*.

## Steps

1. In each `catch` of the `listening` handler, call `plugin.alert` with `level: 'error'`, the `ref` `tunnel` and the logged reason.
2. Keep the `plugin.log` line in each `catch`.
3. After `host` returns, call `plugin.clearAlert('tunnel')`.
4. Add an `onExit(code, signal)` parameter to `host`, called from a `child.on('exit')` listener.
5. In the plugin, raise the `tunnel` alert from `onExit` unless `stopping` asked for the kill.
6. In `read`, raise the `warning` alert with the `ref` `read` where it logs the first failure.
7. In `read`, call `plugin.clearAlert('read')` when a read succeeds after a failure.
8. In `stopping`, clear both alerts.
9. Write each alert text as one plain sentence, as the brief `the-text-a-person-reads-is-plain.md` asks.

## Validation

- A `find` or `create` that throws raises the `tunnel` alert, and a later hosted tunnel clears it.
- A `prepare` that throws raises the `tunnel` alert.
- A port 31546 that cannot be bound raises the `tunnel` alert.
- An exit of `devtunnel host` that the plugin did not ask for raises the `tunnel` alert.
- The exit after `stopping` raises no alert.
- A failed `show` raises the `read` warning once per run, and the next good read clears it.
- `pnpm --filter @ahpd/tunnel-devtunnel test` passes.
- By hand: break the tunnel, and ahpw's list shows the Dev Tunnel row as failing.

## Resume
