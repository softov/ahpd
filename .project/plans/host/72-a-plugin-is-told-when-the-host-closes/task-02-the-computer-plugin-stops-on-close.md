---
title: The computer plugin stops its timers and nested hosts on close
status: todo
depends: [task-01-a-plugin-can-register-a-close.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L857-L896](../../../../packages/computer/src/plugin.ts#L857-L896) - `arm` and `watch`, the disposal timers"
  - "[code://packages/computer/src/plugin.ts#L957-L1006](../../../../packages/computer/src/plugin.ts#L957-L1006) - the startup scan, which arms timers after `apply` returns"
  - "[code://packages/computer/src/devcontainer.ts#L720](../../../../packages/computer/src/devcontainer.ts#L720) - `live`, the nested host children"
  - "[code://packages/computer/src/devcontainer.ts#L1125-L1134](../../../../packages/computer/src/devcontainer.ts#L1125-L1134) - `disconnect`"
---

## Objective

After `host.close()` resolves, the computer plugin has no timer armed, no removal running and no nested host child alive.

## Files

- `UPDATE: packages/computer/src/plugin.ts:857-896` - keep the promise of each removal that `arm` starts in a set, and delete it when it settles. `arm` and `watch` do nothing once the plugin is closed.
- `UPDATE: packages/computer/src/plugin.ts:957` - the closer awaits `listing`, so that the startup scan cannot arm a timer after close.
- `UPDATE: packages/computer/src/plugin.ts` - one `host.registerClose(...)` in `apply`. It marks the plugin closed, awaits `listing`, clears every timer in `disposables`, awaits the removals in flight, and closes the dev container launcher.
- `UPDATE: packages/computer/src/devcontainer.ts:720-1134` - a `close()` on the launcher that kills every child in `live` and resolves when each one has exited. A child that does not exit within 5 s gets `SIGKILL`.

## Steps

1. Add the closed flag and the set of removals in flight to the plugin.
2. Make `arm` return early after close. Then a refused removal does not arm the timer again.
3. Add `close()` to the dev container launcher, and call it from the plugin's closer.
4. Register the closer in `apply`.

## Validation

- `packages/computer/test/computer-close.test.ts` (new): load the plugin with `disposableDelay: 1000`, open a session on a disposable profile, dispose it, and close the host. Wait 1.5 s. The fake docker records no `rm` call, and no file under the test folder changed after close.
- The same file: start a removal, then close. `close()` resolves after the fake docker records the `rm`.
- The same file: a refused removal does not arm again after close.
- `packages/computer/test/devcontainer.test.ts`: the launcher's `close()` ends a connected nested host. When it resolves, the sink has its close.

## Resume
