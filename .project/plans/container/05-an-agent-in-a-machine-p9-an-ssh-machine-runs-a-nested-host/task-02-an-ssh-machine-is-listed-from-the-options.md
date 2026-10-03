---
title: An ssh machine is listed from the options and answers over ssh
status: todo
depends: [task-01-several-runtimes-on-one-host.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L56-L91](../../../../packages/computer/src/plugin.ts#L56-L91) - `optionsSchema`, where `ssh` is declared"
  - "[code://packages/computer/src/plugin.ts#L308-L318](../../../../packages/computer/src/plugin.ts#L308-L318) - the `devcontainer` option, an object with its own `command` and `args`, the shape to mirror"
  - "[code://packages/computer/src/runtime.ts#L325-L341](../../../../packages/computer/src/runtime.ts#L325-L341) - `ran`, one run of a program"
  - "[code://packages/computer/src/runtime.ts#L602-L620](../../../../packages/computer/src/runtime.ts#L602-L620) - docker's `list`, the `Machine` rows to match"
  - "[code://packages/computer/src/runtime.ts#L803-L825](../../../../packages/computer/src/runtime.ts#L803-L825) - docker's `stats`, the `MachineStats` to answer"
  - "[code://packages/computer/src/provider.ts#L278-L288](../../../../packages/computer/src/provider.ts#L278-L288) - the `state` leaf, which an ssh machine refuses"
---

## Objective

`options.ssh.machines` names boxes, the ssh runtime lists them, and inspect, exec and stats each run one `ssh` command; nothing is labelled on the box and nothing is made.

## Files

- `CREATE: packages/computer/src/ssh.ts` - `sshRuntime({ command, args, machines })` implementing `ComputerRuntime`, and `quote(word)`, the POSIX single-quote quoting every remote word goes through.
- `UPDATE: packages/computer/src/plugin.ts:56-91` - `ssh: { type: 'object', properties: { command, args, machines } }`; each machine `{ destination, port?, identity?, workdir?, host?, agents? }`; `runtime` enum gains `ssh`.
- `UPDATE: packages/computer/src/plugin.ts:226-326` - read the option, build `sshRuntime` beside docker when `machines` is not empty.

## Steps

1. Every call is `ssh -T -o BatchMode=yes -o ConnectTimeout=<n> [-p port] [-i identity] <destination> -- <one quoted string>`; the program and its leading `args` are the option's, default `ssh`.
2. `list` answers one row per configured machine; its status is `Up` when `ssh ... true` exits 0 and `unreachable: <ssh's last line>` otherwise, checked in parallel and bounded.
3. `inspect` answers the configured record with the reachability it found, or `undefined` for a name not configured.
4. `exec(id, argv)` runs `cd <workdir> && <quoted argv>`, and answers the output and the exit code as docker's does.
5. `stats` runs one remote command that reads `/proc/stat` twice half a second apart, `/proc/meminfo` and `nproc`, and answers `MachineStats`; a box without `/proc` answers `undefined`.
6. `run`, `start`, `stop`, `restart` and `remove` throw "an ssh machine is listed in the options, not made by this host"; `capabilities()` answers `{ runtime: 'ssh', actions: ['exec'], resources: ['status', 'capabilities', 'stats'] }`.
7. No owner on the row, so the machine is the host's (`root:<host>`); its up time is metered from the listing's reachability, by task 01's step 4.

## Validation

- `packages/computer/test/computer-ssh.test.ts` with the fixture from task 04: a listing of two machines, one unreachable; `exec` argv; `stats` from fixed `/proc` text; a write to the `state` leaf refused.
- A listing that sees a machine `Up` opens a stretch for it charged to the host, and one that sees it unreachable closes it.
- `quote` holds `'`, `$()`, a backtick, `;`, a newline and a space.

## Resume
