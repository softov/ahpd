---
title: An ssh machine runs a nested host
domain: container
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/container/04-a-cofold-session-in-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/a-machine-runtime-is-named-for-its-maker.md
  - decisions/a-nested-host-speaks-stdio.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/a-nested-session-resumes-its-inner-transcript-by-id.md
  - decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md
refs:
  - "[code://packages/computer/src/plugin.ts#L56-L91](../../../../packages/computer/src/plugin.ts#L56-L91) - `optionsSchema`; every new option needs an entry here, a credential `writeOnly` (daemon/11)"
  - "[code://packages/computer/src/plugin.ts#L59](../../../../packages/computer/src/plugin.ts#L59) - the `runtime` enum, `['docker']`"
  - "[code://packages/computer/src/plugin.ts#L227](../../../../packages/computer/src/plugin.ts#L227) - the option read as `'docker'`"
  - "[code://packages/computer/src/plugin.ts#L320-L326](../../../../packages/computer/src/plugin.ts#L320-L326) - the one `dockerRuntime` the plugin builds"
  - "[code://packages/computer/src/plugin.ts#L410-L454](../../../../packages/computer/src/plugin.ts#L410-L454) - `made`, the wrapper that meters up time around that one runtime"
  - "[code://packages/computer/src/plugin.ts#L522-L536](../../../../packages/computer/src/plugin.ts#L522-L536) - the startup listing, which opens a stretch for every running machine"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`, a host path read through the machine's bind mounts"
  - "[code://packages/computer/src/plugin.ts#L562-L620](../../../../packages/computer/src/plugin.ts#L562-L620) - `reach`, the `docker exec -i -w -e` argv `how` answers"
  - "[code://packages/computer/src/plugin.ts#L634-L646](../../../../packages/computer/src/plugin.ts#L634-L646) - `nestedHost`, `<host> --stdio --plugin <each>` through `reach`"
  - "[code://packages/computer/src/manifest.ts#L430-L433](../../../../packages/computer/src/manifest.ts#L430-L433) - a body whose runtime differs from the one runtime is refused"
  - "[code://packages/computer/src/runtime.ts#L194-L212](../../../../packages/computer/src/runtime.ts#L194-L212) - `ComputerRuntime`, which an ssh runtime implements"
  - "[code://packages/computer/src/runtime.ts#L600](../../../../packages/computer/src/runtime.ts#L600) - `kind: 'docker'`, hard-coded"
  - "[code://packages/computer/src/runtime.ts#L827-L831](../../../../packages/computer/src/runtime.ts#L827-L831) - `capabilities`, `runtime: 'docker'` hard-coded"
  - "[code://packages/computer/src/runtime.ts#L370-L379](../../../../packages/computer/src/runtime.ts#L370-L379) - `ours`, a container is a computer by its label"
  - "[code://packages/computer/src/runtime.ts#L389-L423](../../../../packages/computer/src/runtime.ts#L389-L423) - the labels that are a docker machine's records"
  - "[code://packages/computer/src/runtime.ts#L602-L620](../../../../packages/computer/src/runtime.ts#L602-L620) - listing by `docker ps`"
  - "[code://packages/computer/src/runtime.ts#L803-L825](../../../../packages/computer/src/runtime.ts#L803-L825) - `stats`, parsed from `docker stats`"
  - "[code://packages/computer/src/owners.ts](../../../../packages/computer/src/owners.ts) - owners kept in `host.configDir` for machines that carry no label"
  - "[code://packages/computer/src/provider.ts#L278-L294](../../../../packages/computer/src/provider.ts#L278-L294) - the `state` leaf and a create, which read `runtime.kind`"
  - "[code://packages/sdk/src/types/computers.ts#L110-L119](../../../../packages/sdk/src/types/computers.ts#L110-L119) - `how`: `undefined` is no such machine, a throw is a runtime that does not answer"
  - "[code://packages/sdk/src/types/computers.ts#L19-L28](../../../../packages/sdk/src/types/computers.ts#L19-L28) - `Spawn`, the descriptor"
  - "[code://packages/sdk/src/types/computers.ts#L51-L60](../../../../packages/sdk/src/types/computers.ts#L51-L60) - `SpawnOptions`: command, args, cwd, env"
  - "[code://packages/sdk/src/types/computers.ts#L143](../../../../packages/sdk/src/types/computers.ts#L143) - `nested`"
  - "[code://packages/sdk/src/plugins.ts#L393](../../../../packages/sdk/src/plugins.ts#L393) - `registerComputers` is one port per host, so every runtime lives inside this plugin"
  - "[code://packages/sdk/src/computers.ts#L103-L129](../../../../packages/sdk/src/computers.ts#L103-L129) - `computersFor`, the agents gate around `how` and `nested`"
  - "[code://packages/sdk/src/host/spawn.ts#L332-L334](../../../../packages/sdk/src/host/spawn.ts#L332-L334) - a session runs nested only when its backend says `runsNested`"
  - "[code://packages/sdk/src/host.ts#L844-L846](../../../../packages/sdk/src/host.ts#L844-L846) - `Host.close` closes every chat, which for a nested session sends `disposeSession` inside"
  - "[code://packages/sdk/src/nested.ts#L511-L524](../../../../packages/sdk/src/nested.ts#L511-L524) - the nested `close`"
  - "[code://packages/sdk/src/decide.ts#L68-L71](../../../../packages/sdk/src/decide.ts#L68-L71) - a policy value is a whole-value glob, `*` the only special character"
  - git://c81ebe0:.project/ideas/more-computer-runtimes.md - the idea this plan takes `ssh` and several runtimes on one host from
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts - VS Code's SSH remote agent host, the parity target
  - https://man.openbsd.org/ssh - `ssh` has no flag for a remote directory or environment; the remote command is one string the login shell parses
---

## Goal

A box that already runs ahpd is listed in the computer plugin's options as an ssh machine, and `computer://<id>` names it like any other machine.
A session there runs `ahpd --stdio` on the box over ssh, whatever its agent, so two servers work together with no hypervisor code.
The plugin serves several runtimes at once, and each machine's id says which runtime it belongs to.

The first test is dev86 (`softov@dev86.brbyte.com`, Debian 13, Docker, `/dev/kvm`), with ahpd installed by hand.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "runtime" packages/computer/src` - the value is fixed to `docker` in the schema, the cast, the manifest check and both `kind` fields.
- `rg "registerComputers" packages/sdk/src` - one `computers` port per host, so an ssh runtime cannot be a second plugin.
- `rg "runsNested" packages/sdk/src` - the host picks the nested route from the backend alone, never from the machine.
- `node -e "new URL('computer://ssh:dev86')"` - throws `Invalid URL`; `computer://ssh.dev86` parses.

### Runtime path

```
options.ssh.machines.dev86 -> ssh runtime: list / inspect / exec / stats over `ssh -T`
session computer://ssh.dev86 -> port.remote(id) -> nested for every backend
  -> nested(): ssh -T softov@dev86.brbyte.com -- 'cd <dir> && ahpd --stdio --plugin <each>'
  -> nested.ts AhpClient over that ssh's stdio -> the box's ahpd runs the agent
```

### Gaps

- `@ahpd/computer` refuses every runtime but `docker`, and its plugin holds one runtime.
- `how` and `nestedHost` speak `docker exec` only, with `-w` and `-e` flags ssh does not have.
- The host runs a `how` backend (Claude, every ACP agent) directly even when the machine is on another box.
- A restart of this host, `restartChat`, a working-directory change and a truncate close a nested session with `disposeSession`, which ends the inner session they should resume.
- The router has no rule for a runtime whose `list` throws, and Docker's does by design.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [One computer: provider, the runtime named for what makes the machine](../../../decisions/a-machine-runtime-is-named-for-its-maker.md) | 01, 02 |
| [The nested host speaks AHP over stdio, so the relay is a pipe](../../../decisions/a-nested-host-speaks-stdio.md) | 03 |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | 03 |
| [A nested session is resumed by resuming the inner transcript by id](../../../decisions/a-nested-session-resumes-its-inner-transcript-by-id.md) | 05 |
| [A machine is owned by whoever created it, and its owner pays for the time it is up](../../../decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| `ssh` is a runtime value, and several runtimes serve one host | decision `a-machine-runtime-is-named-for-its-maker`, "A machine id records which runtime made it" | 01 |
| Every runtime lives inside `@ahpd/computer` | one `computers` port per host, [`code://packages/sdk/src/plugins.ts#L393`](../../../../packages/sdk/src/plugins.ts#L393) | 01 |
| The first test is a box set up by hand and listed as an ssh machine, before any maker code | Softov, 2026-10-02, asked "Does the first Proxmox test use a VM made by hand, listed as an ssh machine (p9 only), before any maker code?": "Yes, by hand first" | 06 |
| The test box is dev86 | Softov, 2026-10-02, asked "Which box is the test target?": "ssh to softov@dev86.brbyte.com worked." | 06 |
| An ssh machine's records are the plugin's options, not labels on the box | an ssh machine is listed, never made, so there is nothing of ours on the box to label | 02 |
| ssh has no `-w` or `-e`: the directory and the variables are written into the remote command with shell quoting, `cd <dir> && env K=V <cmd>` | `ssh(1)` | 03 |
| `within` gives no answer for an ssh machine: a path on this host is not a path on the box, so the machine's own `workdir` stands | there is no mount to read a host path through | 03 |
| A session on a machine off this host runs nested whatever its backend | decision `a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent`, "A runtime that reaches another host answers `nested()` for every backend" | 03 |
| `nested` sends no environment and no secret: the box's ahpd holds whatever it was given by hand | model credentials never leave this host; p12 adds the per-session token | 03 |
| A restart of this host, and every close that is followed by a resume, leaves the inner session to resume; only `removeSession` and a chat removal dispose it | decision `a-nested-session-resumes-its-inner-transcript-by-id` | 05 |
| The router lists with `allSettled`, bounds each runtime, keeps the rows that answered and reports each that did not; `claimOf` reads through the router, and the `stopping` loop closes each stretch alone | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" (a failure belongs to the runtime that failed) | 01 |
| An ssh machine that answers is listed as `running` | (defaulted: `isRunning` reads `running` or `Up ` with a trailing space, so a bare `Up` would read as down) | 02 |
| The vault-named env refusal in `how` applies to exec tools; a session's credentials are p12 task 03's | (defaulted: a session on a remote machine runs nested and `nested` sends no env, so the check never fires for one) | 03 |
| The ssh fixture (task 04) is built before tasks 02 and 03, whose tests run through it | (defaulted: the tests need it) | 02, 03, 04 |
| For now a machine id is `<runtime>.<name>` (`ssh.dev86`, `libvirt.<name>`, `node.<name>`, `docker-<profile>.<name>` for a profile's remote Docker), and the local Docker keeps a bare name; one function spells an id and one parses it, so the spelling can change in one place | Softov, 2026-10-03, asked "how is a machine id spelled so it records its runtime?": "not a decision now.. but put runtime.name" | 01 |
| For now an ssh machine is owned by the host (`root:<host>`), and its up time is metered: a stretch opens when a listing sees it reachable and closes when one sees it unreachable or the daemon stops | Softov, 2026-10-03, asked "who owns an ssh machine, and is its up time metered?": "host-owned, and metered" | 01, 02 |
| For now ahpd is installed on the box by hand, at this host's version; the copy from p5's ahpd part waits for p5 and goes to p11's template or a later plan | Softov, 2026-10-03, asked "how does ahpd get onto the box?": "installed by hand for now" | 06 |
| For now `how` writes non-secret variables inline, a secret env need (one whose value is named from the vault) is refused for an ssh machine, and p12's per-session token is the one credential that travels | Softov, 2026-10-03, asked "how does a value reach an ssh machine without sitting in a process list?": "as proposed" | 03 |

## Proposed architecture

- **Data flow** - `options.ssh = { command?, args?, machines: { <name>: { destination, port?, identity?, workdir?, host?, agents? } } }`; the ssh runtime lists `machines`, and every verb is one `ssh -T -o BatchMode=yes <destination> -- '<quoted command>'`.
- **Routing** - the plugin holds a runtime per value it serves and a router that implements `ComputerRuntime` by the id's prefix, spelled and parsed by `spellMachineId` and `parseMachineId` in `router.ts` and nowhere else; `made` wraps the router, so metering, the tools and the provider are unchanged.
- **Metering** - a runtime that makes machines is metered from start and stop as today; a runtime that only lists (ssh) is metered from what its listing sees, charged to the host.
- **Reach** - `how` and the host command `nested` runs move from the plugin into each runtime; docker keeps today's argv, ssh writes `cd` and `env` into the remote command.
- **The port** - `ComputerPort.remote?(id): boolean` says a machine is off this host; the host runs every backend nested in such a machine.
- **Layer responsibilities** - `@ahpd/computer`: the router, the ssh runtime, the options · `@ahpd/sdk`: `remote` on the port, the nested route chosen by it, a host close that does not dispose an inner session.
- **Source-of-truth files** - `CREATE: packages/computer/src/ssh.ts`, [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The plugin serves several runtimes, and an id says which](task-01-several-runtimes-on-one-host.md) | todo | - |
| [02 - An ssh machine is listed from the options and answers over ssh](task-02-an-ssh-machine-is-listed-from-the-options.md) | todo | 01, 04 |
| [03 - A session on an ssh machine runs nested over ssh](task-03-a-session-on-an-ssh-machine-runs-nested.md) | todo | 02, container 04 task 17 |
| [04 - The ssh fixture and the tests](task-04-the-ssh-fixture-and-tests.md) | todo | 01 |
| [05 - A restart of this host leaves a nested session to resume](task-05-a-restart-leaves-a-nested-session-to-resume.md) | todo | 03 |
| [06 - dev86, set up by hand, runs a session](task-06-dev86-runs-a-session.md) | todo | 04 |
| [07 - Docs](task-07-docs.md) | todo | 06 |

## Risks and tradeoffs

- A box's ahpd at another protocol version is refused by the proxy at `initialize` - the by-hand install pins the version this host runs, and the refusal names both.
- Quoting is the one place a value can escape into the box's shell - one `quote` function, single quotes with `'\''` for a quote inside, held by a test with every shell metacharacter.
- The box may be FreeBSD - list, exec and nested work there; `stats` reads `/proc` and answers nothing on a box without it.
- `ssh` asks for a password or a host key and hangs - `BatchMode=yes` makes it fail with its own sentence instead.

## Resume state

- **Done so far:** nothing; planned 2026-10-02.
- **Next action:** [task-01-several-runtimes-on-one-host.md](task-01-several-runtimes-on-one-host.md), then task 04's fixture, then 02.
- **Open question (ask before task 02):** callers read a machine's `inspect` record in Docker's shape (`State.Running` in `provider.ts:179`, `Config.Labels` in `runtime.ts:457`, `Config.WorkingDir`, `HostConfig`) - (a) the ssh and node runtimes answer `inspect` with a Docker-shaped record, or (b) the runtime gains `state()`, `agents()` and `owner()`, and the plugin stops parsing the record?
- **Open question (ask before task 02):** an ssh machine's up time is metered from what a listing sees, so a box that goes down between listings is charged until the next one - (a) poll each listing runtime on an interval (which interval?), or (b) accept coarse metering driven by listings?
- **Open question (ask before task 03):** step 5 wraps a backend without `runsNested` with the plugin it comes from; this is container/04's open question (every backend declares its plugin, or the host records which package registered each agent), and task 03 waits on it.
- **Watch out for:** `ssh:dev86` is not a usable id, because `new URL('computer://ssh:dev86')` reads the colon as a port, so the separator is a dot; a policy matches a runtime with `computer: ["ssh.*"]`; a docker name that starts with a served runtime value and a dot is refused at create; p8, p10 and p11 spell their ids through task 01's functions; container/04 tasks 11 (resume by id), 14 (the inner working directory), 15 (close waits for dispose) and 17 (a backend names its plugin) must land first, or a nested session on the box starts in a path the box does not have and never resumes; container/04 task 15 makes close wait for `disposeSession`, which task 05 here must not undo for a session that is ending because this host is stopping; claude/15 loads a plugin once with presets as variants, so the box's ahpd needs the same plugin options to serve a preset.

## Final verification checklist

- [ ] `computer://ssh.dev86` is listed, and a session there answers a turn run by dev86's ahpd.
- [ ] A Claude session and an ACP session on the ssh machine both run nested.
- [ ] `ps` on this host shows no secret value while a session runs on dev86.
- [ ] After `ahpd restart`, the session on dev86 continues its conversation.
- [ ] dev86's up time as an ssh machine is written as stretches charged to `root:<host>`, closed when it stops answering.
- [ ] A body asking for `runtime: "ssh"` is refused with a sentence: an ssh machine is listed, never made.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
