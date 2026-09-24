---
title: A session runs inside a computer - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/computers.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/types/agent.ts
  - code://packages/sdk/src/types/plugin.ts
  - code://packages/sdk/src/plugins.ts
  - code://packages/sdk/src/host.ts
  - code://packages/computer/src/plugin.ts
  - code://packages/agent-acp/src/session.ts
  - code://packages/sdk/src/computers.ts
  - code://packages/agent-claude/src/claude.ts
  - code://packages/agent-cofold/src/agent.ts
  - code://test/computer-session.test.ts
  - code://test/computer-refusal.test.ts
  - code://docs/COMPUTER.md
---

A session created with `computer: 'computer://<id>'` runs its ACP server inside that machine. The plugin answers how to reach one as a process, the host carries that answer to the backend, and a session that names a machine which is not there - or a host with no computer plugin - refuses rather than running outside the sandbox it asked for.

## What was built

- `code://packages/sdk/src/types/computers.ts` - `ComputerPort`, `Spawn` and `SpawnOptions`: how to reach a machine, answered as a descriptor rather than a running process.
- `code://packages/sdk/src/types/host.ts`, `code://packages/sdk/src/types/agent.ts` - `HostOptions.computers` and `Start.computers`.
- `code://packages/sdk/src/types/plugin.ts`, `code://packages/sdk/src/plugins.ts`, `code://packages/sdk/src/validate.ts` - `registerComputers`, the singleton port, and its validation table.
- `code://packages/sdk/src/host.ts` - the port is handed to every backend through `Start`, only when the host holds one.
- `code://packages/computer/src/plugin.ts` - the port over the runtime: `docker exec -i`, the machine's own `-w` when the caller names none, and the caller's `env` as `-e`.
- `code://packages/computer/src/runtime.ts` - `mounts` and `workdir` on `MachineSpec`, and `-v`/`-w` in the `docker run` argument list.
- `code://packages/agent-acp/src/session.ts` - `placed()`, which reads `settings.computer`, asks the port, and refuses on a bad name, a missing port or a machine that is not there.
- `code://test/computer-session.test.ts` - the four cases, with no Docker and no network.
- `code://packages/sdk/src/computers.ts` - `refuseComputer` and `machineAsked`: the one gate a backend that cannot reach a machine applies, and the one place an empty setting is read as the host. Added after the fact, when Claude and cofold were still running on the host in silence.
- `code://packages/agent-claude/src/claude.ts`, `code://packages/agent-cofold/src/agent.ts` - both refuse a session that names a machine, in their own `create`, before anything is spawned.
- `code://test/computer-refusal.test.ts` - every backend that ships here is asked, so a new one cannot skip the rule.
- `code://docs/COMPUTER.md` - the session key, the by-hand case that ran, and what a bind mount is and is not.

## Verified

- `test/computer-session.test.ts` - the descriptor's command is what runs when a session names a machine; a machine that is not there ends the turn with `There is no computer called nope`; a host with no port ends it with `no computer plugin`; and a session naming none spawns the backend's own command without asking the port.
- `test/computer.test.ts`, `test/computer-plugin.test.ts` - mounts and a workdir reach `docker run`; the port answers `docker exec -i -w <machine workdir>` and nothing for a machine that is not there.
- `test/computer-refusal.test.ts` - Claude Code and cofold both refuse `computer://box` with a sentence naming the backend when the host carries no port, and the gate does not stop a backend that has one.
- `pnpm test` 74 files / 978 tests, `pnpm typecheck`, `pnpm boundary` and `pnpm schema` green.
- By hand, against real Docker: a `node:22` machine mounted the ACP fixture and ran it as `/srv/acp.mjs`, a session created with `computer: 'computer://box'` completed a turn (`chat/turnComplete`), and deleting the machine left nothing behind.

## Departures from the plan

- The port answers a `Spawn` descriptor and `undefined`, rather than a descriptor or a sentence; the backend owns the sentence, and the three cases it needs are distinguishable (`undefined` is "no such machine", a throw is "the runtime is not answering").
- `placed()` deliberately passes no `cwd`: the session's working directory is a host path and the machine does not have it. The port uses the machine's own working directory, read from `docker inspect`, when the caller names none. Found while preparing the by-hand case, before it could fail there.
- The by-hand case is a checklist in `docs/COMPUTER.md` rather than a test, because `pnpm test` is network-free and may have no Docker.

## Left for later

- An ephemeral machine that is destroyed when its session ends, and a per-session gate on the machine tools.
- A `kvm` runtime behind the same `computer://` names.

## Closed afterwards

- Claude and cofold used to ignore `settings.computer` and run on the host, which the decision above calls the failure to watch for. Both refuse now, through `refuseComputer` in the SDK, and `test/computer-refusal.test.ts` asks every backend that ships here. `placed()` in the ACP backend reads the setting through `machineAsked`, so the emptiness rule is written once.
- **The refusal shipped wrong once, and a live daemon is what found it.** `refuseComputer` returned early when `Start.computers` was defined, reading "the host carries the port" as "this backend can use it". The host hands that port to every backend and only ACP ever asks it, so with the computer plugin loaded - which is the case for anyone who has a machine - Claude Code ran on the host while the session said `computer://box`, and no error was raised. It was found by asking a running daemon to create just such a session and watching it succeed. The gate now refuses on the setting alone, `test/computer-refusal.test.ts` holds both cases (with the port and without it), and the sentence names the backend rather than the host.
