---
title: The host's files and shell reach the server, and a permission is a person
status: done
depends:
  - task-01-the-package-the-provider-and-a-turn.md
layer: agents
refs:
  - code://packages/sdk/src/types/agent.ts#L90-L168 - `Start`, which gains `resources` and `terminals`
  - code://packages/sdk/src/types/host.ts - `HostOptions.resources` and `HostOptions.terminals`, the ports the host already holds
  - code://packages/sdk/src/types/session.ts#L321-L369 - `confirm` and `answer`, how a person's reply is carried
  - code://.project/decisions/acp-ports-come-through-start.md - the fork this task implements
  - code://.project/plans/plugin/01-plugins-load-from-configuration/deferred.md - the row this task closes
  - npm://@agentclientprotocol/sdk@^1.4.0 - `readTextFile`, `writeTextFile`, `createTerminal` and `requestPermission`
---

## Objective

An ACP agent reads and writes files and opens a terminal through the host's own ports rather than around them, and a `session/request_permission` becomes the approval a client already draws: the request is a `chat/inputNeededSet` with a `toolConfirmation`, the person's answer is the ACP reply, and the capability is advertised only when the matching port was passed.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:90-168` - `Start` gains `resources?: Resources` and `terminals?: Terminals`, the same types `HostOptions` carries.
- `UPDATE: packages/sdk/src/host.ts` - the session factory is handed the host's `resources` and `terminals` beside its `tools`.
- `CREATE: packages/agent-acp/src/ports.ts` - the ACP client's `readTextFile`, `writeTextFile` and `createTerminal` answered through those ports, including the `within()` check the host already applies.
- `CREATE: packages/agent-acp/src/approvals.ts` - `requestPermission` turned into a `chat/inputNeededSet` and the held request's answer.
- `UPDATE: packages/agent-acp/src/connection.ts` - the `initialize` reply advertises `fs.readTextFile`, `fs.writeTextFile` and `terminal` only when the ports are there.
- `UPDATE: packages/agent-acp/src/session.ts` - `confirm(toolCallId, approved)` settles the held permission request.
- `UPDATE: packages/agent-cofold/src/config.ts` - nothing; the ports decision names this package as the only consumer for now.
- `CREATE: test/agent-acp-ports.test.ts` - a read, a write and a terminal through a host that has the ports, and the capability absent when it does not.
- `UPDATE: .project/plans/plugin/01-plugins-load-from-configuration/deferred.md` - the ports row is closed by this task.

## Steps

1. Add the two optional fields to `Start` and pass them where `createHost` builds a session, so an ACP bridge and an embedder both receive them.
2. Advertise the three capabilities from `initialize` exactly when the matching port exists, because a capability advertised without one is a server request nothing can answer.
3. Implement `readTextFile` and `writeTextFile` over `resources.read` and the write half, refusing a path the host refuses with the host's own words.
4. Implement `createTerminal` over `terminals.create`, returning a handle whose `currentOutput`, `waitForExit`, `kill` and `release` call the terminal's own methods.
5. Turn `requestPermission` into a `toolConfirmation` on `chat/inputNeededSet`, hold the request, and answer it from `confirm`; refuse it when the session closes, so a subprocess is never left waiting.
6. Write the fixture's file, terminal and permission exchanges and the test cases.

## Validation

- `test/agent-acp-ports.test.ts` - the capabilities the handshake advertises with both ports and with neither, a read and a write through the host's store, a terminal opened, waited on, read and released, and a permission approved as `allow_once` and refused as `reject_once`. The refusal a closed session produces is implemented in `close` (held permissions settle `cancelled` and held terminals are released) but is not separately asserted; what fails in that case is a subprocess nobody is listening to.
- `npx tsc -p tsconfig.json --noEmit`, `node scripts/boundary.mjs` and the full suite green.

## Resume

Done 2026-09-22.
The SDK half: `Start` gained `resources?: ResourceStore` and `terminals?: StartTerminals` in `packages/sdk/src/types/agent.ts`, and `createHost`'s `spawn` passes them when the host holds them, so an embedder and a plugin both receive them. `ResourceStore` and `TerminalStore` moved from `types/host.ts` to `types/resources.ts` and `types/terminals.ts`, which is where a backend reads them from; `types/host.ts` still re-exports them, and both are on the public type barrel. Because a backend cannot use the raw terminal port - the host owns the terminal's URI, its root-list row and its `emit` - `Start.terminals` is a host-owned factory, `StartTerminals.open`, and `TerminalOptions` gained `args`/`env` while `Terminal` gained `waitForExit` for ACP's argv, environment and exit wait.
The bridge half: `AcpHandlers` gained the optional ACP client callbacks, which `connectAcp` derives `clientCapabilities` from and wires one for one, so a capability is advertised exactly when it has an implementation. `session.ts` answers `fs/read_text_file` (whole file, or a line range) and `fs/write_text_file` through `Start.resources`; `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill` and `terminal/release` through `StartTerminals`, holding each handle by the ACP terminal id and capping output to the byte limit the create request named; and `session/request_permission` as `session/inputNeededSet` plus `confirm`, selecting `allow_once` on approval and `reject_once` on refusal, never an `always`, and `cancelled` when no once option was offered.
Left: task 04, which is the plugin entry, the docs and an end-to-end daemon run. Added after task 04: the bridge's own `ran`, so a `!command` on an ACP session runs in the host's shell rather than being refused - it was refused until then, because the bridge had no turn to hold one.
A method name cost a wrong answer: the ACP wait method is `terminal/wait_for_exit`, not `terminal/wait_for_terminal_exit`, and the fixture was written with the wrong one first.
