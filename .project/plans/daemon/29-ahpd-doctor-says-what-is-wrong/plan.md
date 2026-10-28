---
title: ahpd doctor says what is wrong
domain: daemon
status: planned
priority: medium
created: 2026-10-15
revalidated: 2026-10-27
requires:
  - plans/daemon/28-setup-finds-the-runtimes-and-agents/plan.md
  - plans/daemon/31-the-service-manager-starts-the-daemon/plan.md
refs:
  - "[code://packages/server/src/commands/status.ts](../../../../packages/server/src/commands/status.ts) - `ahpd status` reads the daemon's record, and does not ask the daemon"
  - "[code://packages/server/src/daemon.ts#L210-L231](../../../../packages/server/src/daemon.ts#L210-L231) - `running`, the one reader of the record, which clears a record whose process is gone"
  - "[code://packages/server/src/found.ts#L109-L135](../../../../packages/server/src/found.ts#L109-L135) - `nodeRuns`, `runtimeLines` and `findRuntimes`, the runtime lookup of plan 28"
  - "[code://packages/server/src/found.ts#L205-L245](../../../../packages/server/src/found.ts#L205-L245) - `configuredAgents` and `findAgents`, the agent lookup of plan 28"
  - "[code://packages/server/src/config.ts#L711](../../../../packages/server/src/config.ts#L711) - `loadConfig`, which throws for a file that is named and broken"
  - "[code://packages/server/src/plugins.ts#L2180](../../../../packages/server/src/plugins.ts#L2180) - `describePlugin`, which `plugin list` calls for each plugin without applying it"
  - "[code://packages/server/src/service.ts#L137](../../../../packages/server/src/service.ts#L137) - `serviceOn` and `installFile`, the service manager of this system and the file an install writes"
  - "[code://packages/server/src/update.ts#L165](../../../../packages/server/src/update.ts#L165) - `updateLine`, the line that says a newer ahpd exists"
  - "[code://packages/server/src/commands/registry.ts#L65](../../../../packages/server/src/commands/registry.ts#L65) - where each command is declared"
---

## Goal

`ahpd doctor` runs every check on this machine and prints one line for each, with the fix when a check fails.
A person runs one command, and not `status`, `config` and `plugin list` one after the other.
`ahpd doctor --json` is the output for a support ticket.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "doctor" packages/server/src docs` - no doctor command exists; `onpath.ts` names it as a future caller.
- `rg -n "pattern:" packages/server/src/commands` - `status`, `config`, `plugin list` and `service install` each report one part.
- `rg -n "onPath\(" packages/server/src` - plan 28 built the lookup in `found.ts`, and `configure` calls it.
- `running` removes a record whose process is gone, so a stale record is not a fault that doctor can find.

### Runtime path

```
ahpd doctor -> runtime, config, daemon, service, plugins, agents, update -> one line per check -> exit 1 when a check fails
```

### Gaps

- `ahpd status` reads the record that the daemon wrote. It does not find a daemon whose process runs but does not answer.
- No command checks that the agent CLIs in the configuration are on PATH.
- No command says what is wrong in one output.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd gets a `doctor` command. | Softov, 2026-10-15, to "The `ahpd doctor` question in plan 28 is my own speculation. What do I do with it?" - "we need a doctor command" | 02 |
| doctor is its own plan, and it uses the detection from plan 28. | Softov, 2026-10-15, to "Where does `ahpd doctor` go?" - "Its own plan, daemon/29" | 01 |
| doctor has a Service check. | Softov, 2026-10-27, to "Should doctor check the service, now that daemon 31 is built?" - "Add a Service check" | 01 |
| doctor does not report the state of connectors. | Softov, 2026-10-27, to "Should doctor report each connector's state?" - "No connector check" | - |
| A check gives `ok`, `warn` or `fail`, one line of text, and a fix for `warn` and `fail`. | (defaulted: the draft's proposal of 2026-10-15) | 01 |
| The daemon check opens the WebSocket at the record's `connectUrl`, and the daemon answers when it opens within 5 s. | (defaulted: the WebSocket is served when `httpApi` is off, and Node 22.18 has a global `WebSocket`) | 01 |
| No running daemon is `warn`, with `ahpd start` as the fix. A daemon that does not answer is `fail`, with `ahpd restart` as the fix. | (defaulted: no daemon is a normal state, and a hung daemon is a fault) | 01 |
| The Service check is `ok` when the unit or agent file exists, and `warn` with `ahpd service install` when it does not. On a system with no service manager, the check gives no line. | (defaulted: daemon 31 supports only systemd and launchd) | 01 |
| An agent that the configuration names and that is not on PATH is `fail`, with its install line. An agent on PATH that is not configured is `warn`, with `ahpd configure`. | (defaulted: the draft's proposal of 2026-10-15) | 01 |
| Each check has a limit of 5 s, and a check that is too slow is `fail`. | (defaulted: the draft's risk of a check that hangs) | 01 |
| doctor is a CLI command only, with no HTTP surface. | (defaulted: a served request is the daemon itself, so it cannot check that the daemon answers) | 02 |
| The exit code is 1 when a check is `fail`, and 0 otherwise. | (defaulted: the draft's proposal of 2026-10-15) | 02 |

## Proposed architecture

- **Data flow** - each check reads this machine, the configuration or the record, and gives one result.
- **Checks** - in this order:
  - **Runtime** - the runtime that runs ahpd, against `nodeRuns`, and the other runtimes from `findRuntimes`.
  - **Config** - each file that `loadConfig` reads, and whether it parses.
  - **Daemon** - the record from `running`, then the WebSocket at its `connectUrl`.
  - **Service** - the file at `installFile` for the manager that `serviceOn` names.
  - **Plugins** - each plugin resolves and imports, as `describePlugin` does for `plugin list`.
  - **Agents** - `findAgents` with `configuredAgents`.
  - **Update** - `updateLine`, as `warn`.
- **Output** - the lines in that order, then a count of each result.
- **JSON** - `--json` gives the same checks as an array, through the output contract of `@cofold/commands`.
- **Secrets** - doctor never prints the connection token, `connectUrl` or a plugin secret, as `status` and `config` do not.
- **Layer responsibilities** - `@ahpd/server`: the checks in `doctor.ts`, and the command in `commands/doctor.ts`.
- **Source-of-truth files** - CREATE: `packages/server/src/doctor.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The checks say what is wrong](task-01-the-checks-say-what-is-wrong.md) | todo | - |
| [02 - ahpd doctor prints the checks](task-02-ahpd-doctor-prints-the-checks.md) | todo | 01 |
| [03 - The docs name ahpd doctor](task-03-the-docs-name-ahpd-doctor.md) | todo | 02 |

## Risks and tradeoffs

- A check that hangs stops the report - each check has a limit of 5 s, and a check that is too slow is `fail`.
- The daemon check sends the token in `connectUrl` - it goes only to the daemon's own origin, and no line or JSON field holds it.
- A plugin import runs the plugin's top-level code - `plugin list` does the same, and doctor applies no plugin.

## Resume state

- **Done so far:** the tasks are written, 2026-10-27.
- **Next action:** build task 01.
- **Open questions:** none.
- **Watch out for:** plan 28 owns the PATH lookup in `found.ts`; doctor calls it and does not copy it.

## Final verification checklist

- [ ] With no daemon, doctor prints `warn` for the daemon with `ahpd start`, and exits 0.
- [ ] With a daemon stopped by `kill -STOP <pid>`, doctor prints `fail` for the daemon with `ahpd restart`, and exits 1.
- [ ] `ahpd doctor --json` holds no token.
- [ ] `plans/index.md` updated.
