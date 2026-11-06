---
title: A terminal in a machine runs in the machine
status: done
depends: []
layer: agents
refs:
  - "[code://packages/agent-acp/src/session/handlers.ts#L261-L279](../../../../packages/agent-acp/src/session/handlers.ts#L261-L279) - `openTerminal`"
  - "[code://packages/agent-acp/src/session/opening.ts#L224-L249](../../../../packages/agent-acp/src/session/opening.ts#L224-L249) - `placed`, whose reading of the computer id is shared"
  - "[code://packages/agent-acp/test/agent-acp-machine.test.ts#L383-L419](../../../../packages/agent-acp/test/agent-acp-machine.test.ts#L383-L419) - the stub `computers.how` the new case uses"
---

## Objective

A `terminal/create` from an ACP agent in a session placed in a machine runs its command in that machine, through `computers.how`, in a terminal the host still lists; a session on the host is unchanged.

## Files

- `UPDATE: packages/agent-acp/src/session/opening.ts:224-249` - the computer id read out of `placed` into one function both use: `machineIdOf(start): string | undefined`, which throws on a value that is not `computer://<id>` and when the host has no computers port, with the messages `placed` throws today.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:261-279` - `openTerminal`: where `machineIdOf(start)` names a machine, `await start.computers.how(id, { command, args, env, cwd: hostPathOf(request.cwd) })`, with no `cwd` when `request.cwd` is not set, so the port uses the machine's own directory as `placed` does, a missing descriptor thrown as `There is no computer called <id>`, and `shells.open({ cwd: where, command: how.command, args: how.args, env: how.env })`; otherwise as today.
- `UPDATE: packages/agent-acp/test/agent-acp-machine.test.ts` - a case per side.

## Steps

1. Move the id parsing out of `placed` into `machineIdOf`, and make `placed` call it.
2. In `openTerminal`, branch on `machineIdOf(start)` as above, applying decision `an-acp-agents-terminal-in-a-machine-runs-in-the-machine`.
3. Add a case in `agent-acp-machine.test.ts`: a placed session whose fixture sends `term`; assert the stub `how` was asked for `echo` with `cwd` the host folder, and that the host's terminal ran the descriptor's command, not `echo`.
4. Add a case: a session on the host sends `term`; `how` is not called, and the terminal runs `echo` at the folder.

## Validation

- `pnpm vitest run packages/agent-acp/test/agent-acp-machine.test.ts packages/agent-acp/test/agent-acp-ports.test.ts` passes on Linux and on Windows.
- `pnpm typecheck`, `pnpm boundary`.
- By hand on Windows with Docker Desktop: the hand check in `.project/pending/windows-machine-paths-checks.md` with the scripted agent's `paint` turn.

## Resume

Implemented 2026-10-20, not reviewed.

- `opening.ts` has an exported `machineIdOf(start)`, beside `placed`.
- It trims `settings.computer`, and throws on a value that is not `computer://<id>`.
- It throws too when the host has no computers port.
- `placed` calls it, so the server and each terminal read the placement one way.
- In `handlers.ts`, `openTerminal` branches on it.
- A session on the host opens `request.command` at `request.cwd ?? where`, as before.
- A session in a machine asks `computers.how(id, { command, args, env, cwd: hostPathOf(request.cwd) })`.
- It leaves `cwd` out when the request names none, so the port uses the machine's own directory.
- The host's terminal opens the descriptor at `where`, and the machine's directory rides in the argv.
- A missing descriptor fails with `There is no computer called <id>`, and nothing falls back to the host.
- `agent-acp-machine.test.ts` gains `terminalIn(placed)` and two cases, with `SpawnOptions` in its type import.
- The placed case asserts `how` was asked for `echo` at the host folder.
- It also asserts the host's terminal ran the descriptor, and the fixture read that terminal's output.
- The host case asserts `how` was never asked, and the terminal ran `echo` at the folder.

Two things went beyond the task file. ACP may send `cwd` as `null` as well as leave it out, so both count as not set. `machineIdOf` cannot narrow `start.computers` for the type, so `placed` and `openTerminal` check it again and throw the same refusal.

Gates: build, typecheck, boundary, machine tests and ports tests pass on Linux; the Windows VM check is not run here.

- **Next action:** task 02.
- **Open questions:** none.
- **Watch out for:** on Linux a host spawn at the machine's path succeeds, so only the `how` assertion shows the command was placed.
