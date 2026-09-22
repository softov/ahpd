---
title: The host's files and shell reach the server, and a permission is a person
status: doing
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

- `test/agent-acp-ports.test.ts` - a read through the port and a refusal outside it, a write, a terminal opened and released, the capability absent with no ports, a permission asked and approved, one denied, and one refused by a closed session.
- `npx tsc -p tsconfig.json --noEmit`, `node scripts/boundary.mjs` and the full suite green.

## Resume

Started 2026-09-22, and deliberately stopped after step 1 so the public SDK change could be reviewed before the bridge uses it.
Done: `Start` gained `resources?: ResourceStore` and `terminals?: StartTerminals` in `packages/sdk/src/types/agent.ts`, and `createHost`'s `spawn` passes them when the host holds them, so an embedder and a plugin both receive them. `ResourceStore` and `TerminalStore` moved from `types/host.ts` to `types/resources.ts` and `types/terminals.ts`, which is where a backend reads them from; `types/host.ts` still re-exports them, and both are on the public type barrel. Because a backend cannot use the raw terminal port - the host owns the terminal's URI, its root-list row and its `emit` - `Start.terminals` is a host-owned factory, `StartTerminals.open`, and `TerminalOptions` gained `args`/`env` while `Terminal` gained `waitForExit` for ACP's argv, environment and exit wait.
Left: everything the bridge does with them - advertising `fs.readTextFile`, `fs.writeTextFile` and `terminal` from `initialize` only when the matching one is present, answering the three client requests through the store and the factory, turning `session/request_permission` into a real `chat/inputNeededSet` and `confirm`, and the fixture and test cases.
Also corrected: the decision said the same fields would be added to `SessionOptions`, which is the shape a backend builds for its own session and not a host contract; only `Start` carries them.
