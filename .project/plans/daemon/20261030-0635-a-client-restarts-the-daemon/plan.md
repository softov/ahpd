---
title: A client restarts the daemon over AHP
domain: daemon
status: implemented
priority: medium
created: 2026-10-30
revalidated: 2026-10-30
refs:
  - git://b04245e7 - the commit of `main` the facts were checked at
  - "[code://packages/server/src/commands/update.ts#L266-L310](../../../../packages/server/src/commands/update.ts#L266-L310) - `updateMethod`, the `x-ahpd/update` command, the pattern to copy"
  - "[code://packages/server/src/commands/run.ts#L1318-L1322](../../../../packages/server/src/commands/run.ts#L1318-L1322) - where `x-ahpd/update` is registered"
  - "[code://packages/server/src/commands/restart.ts#L102](../../../../packages/server/src/commands/restart.ts#L102) - `busy`, the refusal that always says `--force`"
  - "[code://packages/server/src/commands/restart.ts#L696-L735](../../../../packages/server/src/commands/restart.ts#L696-L735) - `ahpd restart` and `POST /api/restart`, with the checks to share"
  - "[code://packages/server/src/commands/served.ts#L100](../../../../packages/server/src/commands/served.ts#L100) - `served.restart`, which the update method calls too"
  - "[code://packages/server/src/commands/scopes.ts#L42-L43](../../../../packages/server/src/commands/scopes.ts#L42-L43) - `deploymentOnly`, the words for a caller that is not the host"
  - "[code://packages/server/test/host-update-method.test.ts](../../../../packages/server/test/host-update-method.test.ts) - the cases of `x-ahpd/update`, the shape of the new test"
  - "[code://packages/server/test/server-restart.test.ts#L526-L548](../../../../packages/server/test/server-restart.test.ts#L526-L548) - the cases that assert the `--force` refusal"
---

## Goal

A client of the daemon's AHP can restart the daemon, as `ahpd restart` does.
ahpw and ahpapp cannot do this today: ahpw does not use `/api`, and ahpapp shows only a note that a restart is needed.
After this plan, the websocket command `x-ahpd/restart` restarts the daemon, and a client draws a Restart button from it.
A refusal tells the caller how to force the restart in that caller's own terms.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "x-ahpd/update" packages/server/src` - the update is a websocket command already, with the same `force` and the same restart.
- `rg -n "busy\(" packages/server/src` - the refusal is in the command, the signal answer, `checkedRestart` and `selfupdate.ts`.
- `rg -n "restart" /github/ahpw/src /github/ahpapp/src` - neither client calls a restart of the daemon.

### Runtime path

```
client -> x-ahpd/restart { force } -> owner check -> notRestartable -> busy unless force
  -> served.restart(argv, force) -> the answer goes -> the daemon restarts
```

### Gaps

- No websocket command restarts the daemon.
- The refusal while a turn runs says `pass --force`, also to a caller over HTTP.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The restart is the websocket command `x-ahpd/restart`, with the checks and `force` of `ahpd restart` | Softov, 2026-10-30: "AHP command" | 01 |
| The command takes `config:write`, and refuses an owner that is not `root:` | (defaulted: `x-ahpd/update` replaces the same process, and admits the same caller) | 01 |
| The answer is `{ restarting: true, pid }`, as the HTTP surface answers | [code://packages/server/src/commands/restart.ts#L733-L734](../../../../packages/server/src/commands/restart.ts#L733-L734) | 01 |
| A refusal over the websocket or HTTP says `force: true`, and the terminal and the signals keep `--force` | Idea of 2026-10-15: "For an API caller it would say `force: true`" | 02 |
| ahpw and ahpapp draw the button in their own plans, only when the host offers the command | Softov, 2026-10-30: "ahpd and ahpw plans" | - |

## Proposed architecture

- **Data flow** - `restartMethod(served)` in `restart.ts` reads `{ force }` and runs the same checks as the HTTP surface. `run.ts` registers it beside `x-ahpd/update`.
- **Event flow** - The answer goes before the process stops, because `served.restart` defers the restart as it does for an update.
- **Layer responsibilities** - server: the command, its registration, the refusal words.
- **Source-of-truth files** - [`code://packages/server/src/commands/restart.ts`](../../../../packages/server/src/commands/restart.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The daemon restarts from a websocket command](task-01-the-daemon-restarts-from-a-websocket-command.md) | implemented | - |
| [02 - A refusal names the caller's way to force](task-02-a-refusal-names-the-callers-way-to-force.md) | implemented | 01 |

## Risks and tradeoffs

- A client that restarts the daemon loses its connection. The client connects again as it does after any restart.
- A forced restart ends the running turns of every person on the host, so only the host's own connection may ask for it.

## Resume state

- **Done so far:** both tasks are implemented. `x-ahpd/restart` restarts the daemon with the checks of `ahpd restart`. A refusal while a turn runs names `force: true` to every client of the API and of AHP. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a daemon in the foreground refuses with `FOREGROUND`, as the HTTP surface does. The API's surface value is `remote`, not `http`, so `servedRestart` passes the AHP way to force without reading the surface.

## Final verification checklist

- [ ] On a test daemon from `ahpd start`, `x-ahpd/restart` restarts it, and the client connects again. The restart passed on 2026-11-03; the reconnect waits in [client-restart-checks.md](../../../pending/client-restart-checks.md).
- [x] With a turn running, the command refuses, names the session and says `force: true`. Checked on 2026-11-03.
- [x] With `force: true`, the command restarts while a turn runs. Checked on 2026-11-03.
