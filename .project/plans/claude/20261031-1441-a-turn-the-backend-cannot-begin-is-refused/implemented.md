---
title: A turn the Claude session cannot begin is refused - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L594-L609](../../../../packages/agent-claude/src/session/turns.ts#L594-L609) - `begin`, refusing a turn while one runs or begins"
  - "[code://packages/sdk/src/types/session.ts#L204-L209](../../../../packages/sdk/src/types/session.ts#L204-L209) - `SessionOptions.handed`"
---

A turn that reaches the Claude session while a turn of that chat runs or is still beginning is refused to the client that sent it, in the words the host gives a turn that arrives while one runs.

## What was built

- [`code://packages/sdk/src/types/session.ts#L204-L209`](../../../../packages/sdk/src/types/session.ts#L204-L209) - `SessionOptions.handed`, beside `emit`: the client's action the host handed the session, for one it answers or refuses after the host has stopped applying it.
- [`code://packages/agent-claude/src/claude.ts#L718`](../../../../packages/agent-claude/src/claude.ts#L718) - the Claude agent passes `start.handed` to its session.
- [`code://packages/agent-claude/src/session/turns.ts#L594-L609`](../../../../packages/agent-claude/src/session/turns.ts#L594-L609) - `begin` asks `busy()`, and a turn running or beginning refuses the new one through `handed` with 'A turn is running in this chat'; `beginTurn` keeps its own guard, with its comment brought to what reaches it.
- [`code://docs/sdk/AGENT.md#L265-L267`](../../../../docs/sdk/AGENT.md#L265-L267) - *Answering later* names a turn refused while the one before it begins.
- One case in `host-turn.test.ts`: a turn naming another model, and at once a second turn, which is refused with the running-turn sentence while the first goes on.

## Verified

- On `cae062e6` the case fails for the reason it names: the second turn is answered with nothing.
- After the change, `host-turn`, `host-senders`, `nested-proxy`, `echo-origin`, `policy-checks` and the agent-claude suites pass with 647 tests in 61 files.
- The round's full run, at two workers with the machine waiting on I/O: `test:unit` 126 failed and `test:processes` 340 failed, each a timeout or a process killed or unannounced at one. One file at a time, the failed unit files pass 1143 tests with six timeouts in five files outside this change, and the failed process files pass 529 with 23 timeouts and their aftermath in the `computer-*` and server CLI files, which time out the same way on the deployed union without this change.
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## Left for later

- The cofold session drops a turn the same way while it reopens a session; that half goes with the cofold resume plan, which reshapes its turn opening.
