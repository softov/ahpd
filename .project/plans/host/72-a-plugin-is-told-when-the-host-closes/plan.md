---
title: A plugin is told when the host closes, and the computer plugin stops its work there
domain: host
status: built
priority: high
created: 2026-10-07
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions:
  - decisions/a-plugin-is-told-when-the-host-closes.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L176](../../../../packages/sdk/src/types/plugin.ts#L176) - `PluginHost`, where `registerClose` goes"
  - "[code://packages/sdk/src/types/plugin.ts#L417](../../../../packages/sdk/src/types/plugin.ts#L417) - `Contribution`, which carries what one plugin registered"
  - "[code://packages/sdk/src/plugins.ts#L548-L571](../../../../packages/sdk/src/plugins.ts#L548-L571) - the `register*` functions, the pattern to copy"
  - "[code://packages/sdk/src/plugins.ts#L166](../../../../packages/sdk/src/plugins.ts#L166) - `foldHostOptions`, which folds the contributions into `HostOptions`"
  - "[code://packages/sdk/src/host.ts#L857-L890](../../../../packages/sdk/src/host.ts#L857-L890) - `close`: chats first, then `options.automations?.close?.()` and `kept.close?.()`, each as a `step`"
  - "[code://packages/computer/src/plugin.ts#L857-L896](../../../../packages/computer/src/plugin.ts#L857-L896) - `arm` and `watch`: the disposal timers, and a refused removal that arms again"
  - "[code://packages/computer/src/plugin.ts#L957-L1006](../../../../packages/computer/src/plugin.ts#L957-L1006) - the startup scan that gives a leftover machine the delay again"
  - "[code://packages/computer/src/devcontainer.ts#L720](../../../../packages/computer/src/devcontainer.ts#L720) - `live`, the nested host children by connection"
  - "[code://packages/computer/src/devcontainer.ts#L1125-L1134](../../../../packages/computer/src/devcontainer.ts#L1125-L1134) - `disconnect`, which kills one child"
  - "[code://packages/computer/test/computer-disposable.test.ts#L34-L43](../../../../packages/computer/test/computer-disposable.test.ts#L34-L43) - the cleanup that fails with `ENOTEMPTY`"
  - "[code://packages/computer/test/devcontainer.test.ts#L26-L34](../../../../packages/computer/test/devcontainer.test.ts#L26-L34) - a cleanup that fails the same way"
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L36-L46](../../../../packages/computer/test/computer-devcontainer.test.ts#L36-L46) - a cleanup that fails the same way"
---

## Goal

When the host closes, every plugin stops the work it started.
The computer plugin stops its disposal timers, waits for a removal that is running, and ends its nested host processes.
The computer tests close what they open, so no test writes into a folder after the test removes it.
CI does not fail with `ENOTEMPTY` in the computer tests.

## Reconnaissance

### Searches performed

- `rg "close|dispose|stop" packages/sdk/src/types/plugin.ts` - `PluginHost` has no teardown.
- A probe in `afterEach` recorded the files written after a test ended. In `computer-disposable.test.ts`, 13 of 59 tests wrote `docker.json` or `repo/.git/objects` up to 1.5 s after the test ended. The writers are the disposal timers (`disposableDelay: 1000`), a refused removal that arms again, and the startup scan of a second load. Closing the hosts was not enough, because the timers belong to the plugin.
- In `devcontainer.test.ts`, the late write is the `docker exec` that starts the nested host (`container-host.mjs --stdio`). `connect` returns before the fake docker records the call, and no test calls `disconnect`.
- The same flake failed CI on 483cd50 and on 700c5aa, so it is older than host/69 and host/70.

### Runtime path

```
host.close() -> chats close -> each plugin close (registerClose) -> automation store -> session store
computer plugin close -> clear every disposal timer -> await removals in flight -> disconnect every nested host child and await its exit
```

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin is told when the host closes, and stops its own work there](../../../decisions/a-plugin-is-told-when-the-host-closes.md) | Softov, 2026-10-07 |

| What | Source | Task |
| --- | --- | --- |
| `registerClose(fn)` on `PluginHost`, like the other `register*` functions; a plugin may call it more than once | the sibling pattern in `plugins.ts` | 01 |
| `host.close()` calls the plugin closers after the chats close and before the stores close, each as a `step`, so one failure does not stop the others | the order a session needs: a session leaves its machine before the plugin stops | 01 |
| The computer plugin clears its timers and does not remove the machines; the next start gives a leftover machine the delay again | today a daemon that stops also leaves them; the startup scan handles them | 02 |
| The computer tests close every host they make, and close a load that has no host through its closers | the cause of the flake | 03 |
| `close()` awaits every machine enter and leave that `inMachine` started, before the plugin closers; the tests do not wait for a quiet folder | Softov, 2026-10-07, asked "The host's own session leave runs unawaited, so it still writes after close() returns. Which way?" and chose "close() awaits leaves" | 05 |

## Proposed architecture

- **Data flow** - `registerClose(fn)` pushes `fn` onto `contribution.closers`. `foldHostOptions` collects them into `HostOptions.closers`, each with the plugin name. `host.close()` runs them.
- **State flow** - the computer plugin keeps a set of the removals in flight, so that its closer can await them.
- **Layer responsibilities** - sdk: the hook and the call in `close`. computer: what stops. computer tests: close what they open.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin can register what runs when the host closes](task-01-a-plugin-can-register-a-close.md) | done | - |
| [02 - The computer plugin stops its timers and nested hosts on close](task-02-the-computer-plugin-stops-on-close.md) | done | 01 |
| [03 - The computer tests close what they open](task-03-the-computer-tests-close-what-they-open.md) | done | 02 |
| [04 - Docs](task-04-docs.md) | done | 01, 02 |
| [05 - close() awaits the host's own machine leaves](task-05-close-awaits-machine-leaves.md) | done | 01 |

## Risks and tradeoffs

- A daemon that stops waits for a removal that is running. A removal fetches the machine's work first, so the wait can be some seconds. This is the same work that `remove` does now.
- A closer that never resolves stops `close`. Each closer runs as a `step`, and a step logs a failure but does not time out. The computer closer only awaits work that ends by itself.

## Resume state

- **Done so far:** tasks 01 to 05 implemented 2026-10-07, uncommitted on `build/agents/70ebe302`. The hook, the fold and the call in `close`. `close()` on the launcher. The computer plugin's `closed` flag, its removals in flight and its closer. The shared cleanup the computer tests close through. The two docs. The host's own machine leaves, waited for by `close`. [implemented.md](implemented.md) records all of it.
- **Next action:** none. Reviewed, gates green, merged.
- **Open questions:** none.
- **Watch out for:** killing the fake docker does not end the `/bin/sh` child it started with inherited stdio. A test must see the sink close, not only send the kill.

## Final verification checklist

- [x] A host test: `close()` calls a plugin closer once, after the chats and before the stores.
- [x] A host test: a closer that throws does not stop the next closer.
- [x] A computer test: after `close()`, an armed disposal timer does not fire and no file under the test folder changes.
- [x] `npx vitest run packages/computer` passes 10 times in a row, with no `ENOTEMPTY`.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.
- [ ] CI on main is green. Nothing here is committed yet, so no run has seen it.
- [x] `plans/index.md` updated.
