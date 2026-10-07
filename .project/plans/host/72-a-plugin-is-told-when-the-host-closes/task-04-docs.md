---
title: Docs
status: done
depends: [task-01-a-plugin-can-register-a-close.md, task-02-the-computer-plugin-stops-on-close.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L114-L140](../../../../docs/PLUGINS.md#L114-L140) - the table of what a plugin can register"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - what the computer plugin does when the daemon stops"
---

## Objective

`docs/PLUGINS.md` says what `registerClose` does and when it runs.
`docs/COMPUTER.md` says what happens to a disposable machine and a dev container when the daemon stops.

## Files

- `UPDATE: docs/PLUGINS.md:114-140` - one row for `registerClose(close)` in the table, and a short section: it runs once when the host closes, after the sessions close; stop timers and child processes there; a failure is logged.
- `UPDATE: docs/COMPUTER.md` - one paragraph: when the daemon stops, a removal that is running finishes, a waiting disposal timer stops, and the next start gives the machine its delay again; nested hosts in dev containers end.

## Steps

1. Write the two changes in the style of the file around them.
2. No em dash. Match the wrap of the file.

## Validation

- Each sentence is true of the code that tasks 01 and 02 wrote.

## Resume

- `docs/PLUGINS.md`: one row for `registerClose(close)` at the end of the table in "What you can register". A section follows that row, `### A plugin is told when the host closes`, after the route section. It says when the function runs and that a promise is waited for. Each registered function runs in order, a failure is logged against the plugin's name, and a plugin with nothing to stop registers nothing.
- `docs/COMPUTER.md`: one paragraph at the end of "Disposable machines", led `**Stopping the daemon stops the waiting, not the machines.**` the way the other paragraphs of that section are led. It says a running removal is waited for and a waiting disposal timer is cleared. A machine nobody is in is left where it is, and the next start adopts what it still holds a session for. An inner host is ended with the daemon.
- The claims were checked against the code tasks 01 and 02 wrote: `close` in `packages/sdk/src/host.ts`, `registerClose` in `packages/sdk/src/types/plugin.ts`, and the closer in `packages/computer/src/plugin.ts`.
