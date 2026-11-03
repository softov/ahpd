---
title: A computer kind comes from any plugin
created: 2026-11-02
refs:
  - git://0e6fff13 - the commit of ahpd the facts were checked at, on the `plugin/canvas-example` branch
  - git://2ed435c - the commit of ahpw the facts were checked at
  - git://623fc9a - the commit of ahpapp the facts were checked at
  - git://ff7d6a1c7b4 - the commit of the Agent Host Protocol the facts were checked at
  - git://c6634b2b^ - the last commit that holds the two computer decisions, `one-computer-provider-with-runtimes-as-options` and `a-machine-runtime-is-named-for-its-maker`
  - "[code://.project/specs/computers.md#L37](../specs/computers.md#L37) - one plugin serves `computer:`, and its `runtime` option says what makes the machines"
  - "[code://.project/specs/computers.md#L64](../specs/computers.md#L64) - the spec's requirement: the runtime is an option of one provider"
  - "[code://packages/computer/src/plugin.ts#L886-L893](../../packages/computer/src/plugin.ts#L886-L893) - `runtimes`, one runtime for each value the plugin serves"
  - "[code://packages/computer/src/plugin.ts#L900](../../packages/computer/src/plugin.ts#L900) - `computerRouter`, which sends each call to the runtime its id names"
  - "[code://packages/computer/src/router.ts#L112-L119](../../packages/computer/src/router.ts#L112-L119) - `routed`: a create that names no runtime goes to the fallback"
  - "[code://packages/computer/src/runtime.ts#L538-L715](../../packages/computer/src/runtime.ts#L538-L715) - `ComputerRuntime`, what each runtime does"
  - "[code://packages/computer/src/plugin.ts#L1093-L1094](../../packages/computer/src/plugin.ts#L1093-L1094) - the plugin serves the `x-ahpd-computers://` channel"
  - "[code://packages/computer/src/catalogue.ts#L7-L17](../../packages/computer/src/catalogue.ts#L7-L17) - the channel: each machine with its state and status, and `?owner=me`"
  - "[code://packages/computer/src/plugin.ts#L1585-L1588](../../packages/computer/src/plugin.ts#L1585-L1588) - the plugin serves `computer:` and registers the five commands"
  - "[code://packages/computer/src/provider.ts#L528-L560](../../packages/computer/src/provider.ts#L528-L560) - `computerMethods`: `x-ahpd/computers/{create,start,stop,restart,remove}` and their grants"
  - "[code://packages/computer/src/plugin.ts#L1848](../../packages/computer/src/plugin.ts#L1848) - the plugin sets the `computers` port"
  - "[code://packages/computer/src/plugin.ts#L2299](../../packages/computer/src/plugin.ts#L2299) - the plugin sets the `containers` port"
  - "[code://packages/computer/src/tools.ts#L54](../../packages/computer/src/tools.ts#L54) - `request_disposable_computer`, the first of three host tools"
  - "[code://packages/sdk/src/types/plugin.ts#L1302-L1308](../../packages/sdk/src/types/plugin.ts#L1302-L1308) - `registerComputers`: one port per host, because a host serves one `computer:` provider"
  - "[code://packages/sdk/src/types/computers.ts#L265-L484](../../packages/sdk/src/types/computers.ts#L265-L484) - `ComputerPort`, the machine types the SDK already holds"
  - "[code://packages/sdk/src/plugins/plugins.ts#L490-L497](../../packages/sdk/src/plugins/plugins.ts#L490-L497) - a second plugin cannot serve a method name that another plugin serves"
  - "[code://packages/sdk/src/types/plugin.ts#L1176-L1185](../../packages/sdk/src/types/plugin.ts#L1176-L1185) - `registerResourceProvider`: two plugins cannot serve one scheme"
  - "[code://packages/sdk/src/types/plugin.ts#L1435-L1454](../../packages/sdk/src/types/plugin.ts#L1435-L1454) - `registerAdapter` and `registerEngine`, the two kinds a plugin offers today"
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L259-L298 - `ChangesetOperation`, the model for the operations
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/commands.ts#L58-L88 - `invokeChangesetOperation`, one command for every operation
  - https://github.com/softov/ahpw/blob/2ed435c/src/resources/computers/machines.ts#L149-L164 - ahpw calls `x-ahpd/computers/<action>` by name
  - https://github.com/softov/ahpapp/blob/623fc9a/src/computers.ts - ahpapp calls the same commands
  - file:///github/ahpd/.project/briefs/the-host-keeps-the-tunnels.md - the same model for tunnels, where the kind registration and the operations are described first
---

# A computer kind comes from any plugin

The goal is that the host owns the computers and their operations, and any plugin adds a kind of computer.
Today one plugin, `@ahpd/computer`, owns the list, the commands and every runtime.
A second plugin that makes machines, such as one for a cloud provider, cannot add to that list. Its own `create` would need its own command name.
Softov wants the computers to follow the same model as the tunnels in [the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md).
The host keeps one list and offers one set of operations. Each kind asks for its own input.

## What others do

The Agent Host Protocol puts a changeset's operations in the channel's state, and one command invokes them ([state.ts](https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L259-L298), [commands.ts](https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/commands.ts#L58-L88)).
[the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md) has the details, in *What others do*.

ahpd's own kinds follow one shape: `registerAdapter` for connectors and `registerEngine` for agents ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1435-L1454)).
The manifest lists the name, and the code gives a title, a description, a form schema and icons.

## What ahpd has today

One plugin owns the computers:

- `@ahpd/computer` serves `computer:`, and its `runtime` option says what makes the machines ([`code://.project/specs/computers.md`](../specs/computers.md#L37)). The spec requires this, in *The runtime is an option of one provider* ([`code://.project/specs/computers.md`](../specs/computers.md#L64)).
- The plugin holds one runtime for each value it serves: docker, ssh, node, remote dockers, libvirt and proxmox ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L886-L893)).
- `computerRouter` sends each call to the runtime that the machine's id names ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L900)). A create that names no runtime goes to the fallback ([`code://packages/computer/src/router.ts`](../../packages/computer/src/router.ts#L112-L119)).
- `ComputerRuntime` is what each runtime does: list, inspect, run, start, stop, restart, remove, exec, and more ([`code://packages/computer/src/runtime.ts`](../../packages/computer/src/runtime.ts#L538-L715)). It is a type of the plugin, not of the SDK.

What a client sees:

- The plugin serves the `x-ahpd-computers://` channel ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L1093-L1094)). Each record is a machine with its `state` and `status`, and `?owner=me` gives the caller's own ([`code://packages/computer/src/catalogue.ts`](../../packages/computer/src/catalogue.ts#L7-L17)).
- The plugin registers five commands: `x-ahpd/computers/create`, `start`, `stop`, `restart` and `remove` ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L1585-L1588)).
- `remove` needs `computer:delete`, and the others need `computer:put` ([`code://packages/computer/src/provider.ts`](../../packages/computer/src/provider.ts#L528-L560)).
- ahpw calls `x-ahpd/computers/<action>` by name, and calls `create` with `{ name, manifest }` ([machines.ts](https://github.com/softov/ahpw/blob/2ed435c/src/resources/computers/machines.ts#L149-L164)). ahpapp calls the same commands ([computers.ts](https://github.com/softov/ahpapp/blob/623fc9a/src/computers.ts)).

What a backend and a model see:

- The plugin sets the `computers` port ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L1848)). A backend asks it how to run its process in a machine.
- The port is one per host, "because a host serves one `computer:` provider" ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1302-L1308)).
- The SDK already types the port, `ComputerPort` ([`code://packages/sdk/src/types/computers.ts`](../../packages/sdk/src/types/computers.ts#L265-L484)).
- The plugin sets the `containers` port too ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L2299)).
- The plugin registers three host tools: `request_disposable_computer`, `release_computer` and `computer_exec` ([`code://packages/computer/src/tools.ts`](../../packages/computer/src/tools.ts#L54)).

Why a second plugin cannot add a kind:

- Two plugins cannot serve one scheme ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1176-L1185)).
- A second plugin cannot serve a method name another plugin serves. The first keeps it ([`code://packages/sdk/src/plugins/plugins.ts`](../../packages/sdk/src/plugins/plugins.ts#L490-L497)).
- The `computers` port is one per host.

The earlier answers, both in decisions deleted after commit `c6634b2b^`:

| Date | Decision | What it chose |
| --- | --- | --- |
| 2026-09-22 | `one-computer-provider-with-runtimes-as-options` | One package, the runtime as an option. It rejected "a runtime registry in the SDK, with packages registering into it", because that "puts a host's machine concerns into the library that implements the protocol". Softov's words: "I want 1 also as option" |
| 2026-10-02 | `a-machine-runtime-is-named-for-its-maker` | A runtime is named for what makes the machine: `docker`, `ssh`, `libvirt`, `proxmox`. A machine's id records the runtime that made it. Softov's words: "One runtime per maker" |

## Who writes

| Writer | Files | What the change does to it |
| --- | --- | --- |
| [the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md) | The server package, `packages/sdk/src/plugins/plugins.ts` | The two share the kind registration and the operations in the state. One is built first, and the other copies it |
| ahpw | `src/resources/computers/machines.ts`, `src/bridges/served.ts`, `src/resources/plugins/provides.ts` | It calls the commands by name. It must invoke an operation from the channel's state |
| ahpapp | `src/computers.ts`, `src/useHostMachines.ts` | The same change as ahpw |
| Active plans | `acp/19`, `container/02` task-04, `host/46` tasks 01 and 02, `plugin/53` task-03 | They name the computer commands, the port or the contracts. Not checked: what each needs from this change |
| Draft plan | `bots/20261028-0545-a-bot-runs-in-a-machine` | It makes a machine for a bot. Not checked: which call it uses |
| The spec | `.project/specs/computers.md` | *The runtime is an option of one provider* is corrected when the change is built |
| Open PR #184 | `packages/computer/images/versions.json` | No overlap |
| MayCXC's fork | No branch touches `packages/computer/` | No overlap |

## The change

The host owns:

- the `computer:` scheme, and it routes each machine to its kind by the machine's id;
- the `x-ahpd-computers://` channel, with the machines and the operations in its state;
- `x-ahpd/invokeOperation`, the command that invokes an operation, shared with the tunnels;
- the machines' records, with each machine's kind, settings and `enabled`. The catalogue of `@ahpd/computer` moves to the host;
- the `computers` port, which sends each call to the kind that made the machine.

The host's code is in the server package. The kind's type is in the SDK, beside `ComputerPort`, because a plugin calls `registerComputerKind`.

A plugin adds a kind:

- It registers a kind with `registerComputerKind`, as it registers an adapter. The manifest lists the name in `contracts.computerKinds`.
- A kind has a `name`, a `title`, a `description`, `icons`, and a `schema`, the form that `create` asks for.
- A kind gives the handlers that `ComputerRuntime` holds today: list, inspect, run, start, stop, restart, remove, exec, and the rest.
- A kind can add operations of its own, such as `suspend` and `resume`, each with its own input.
- The kind's name is the maker, as the 2026-10-02 answer says: `docker`, `ssh`, `libvirt`, `proxmox`.

`@ahpd/computer` registers its runtimes as kinds:

- Each runtime it builds from its options becomes one kind, so a host with docker and ssh offers two.
- The `runtime` option stays, and says which kinds the plugin registers.
- A second plugin adds its own kind, such as a cloud provider's, beside them.

The operations follow the four groups in the tunnels brief's *The operations*.

| Operation | Group | Scope | Input | Grant |
| --- | --- | --- | --- | --- |
| `<kind>/create` | A change to the list | The list | The kind's `schema` | `computer:put` |
| `<kind>/update` | A change to the list | One machine | The kind's `schema`, filled with the machine's values | `computer:put` |
| `<kind>/remove` | A change to the list | One machine, with a confirmation | None | `computer:delete` |
| `<kind>/start`, `<kind>/stop`, `<kind>/restart` | What runs now | One machine | None | `computer:put` |
| `<kind>/enable`, `<kind>/disable` | Whether it runs | One machine | None | `computer:put` |
| A kind's own, such as `<kind>/suspend` | The kind's own | One machine | The operation's `input` | `computer:put` |

- The host offers a machine's operations from its kind. A runtime that cannot start a machine lists no `start`.
- A kind can give `restart` its own label, so a libvirt machine reads "Reboot" and a docker one reads "Restart".
- A kind can name another grant for any of its operations, such as `computer:restart`.
- The kind's `update` gets the running machine, and applies the change live or restarts the machine itself.
- The host starts each enabled machine when the daemon starts. A disabled machine keeps its settings, and the host offers it to no session.
- Each machine has `enabled`, a `status`, and the `operation` that runs on it now, as the tunnels brief's *The operations* says.
- The host sets an operation's `status` to `running`, then to `idle` or to `error`, so every subscriber sees it.
- ahpw and ahpapp draw the operations from the state, and a form from the `input`.

## Answers

| What | Source |
| --- | --- |
| The host owns the computers and their operations, and any plugin adds a kind. This replaces the 2026-09-22 answer of one package with the runtime as an option | Softov, 2026-11-02: "Host owns it, any plugin adds a kind" |
| A kind is registered as an adapter is: the manifest lists its name, the code gives its title, description, icons and form | Softov, 2026-11-02: "Like adapters" |
| The operations are in the channel's state and one command invokes them, with `invokeChangesetOperation` as the reference | Softov, 2026-11-02: "ok... put it as reference.." |
| A kind is named for its maker | Softov, 2026-10-02: "One runtime per maker" |
| The computer kind and the tunnel kind go in the SDK now, with one shape. A brief for a generic thing and its kinds comes later, from the two built kinds | Softov, 2026-11-02: "for computer and tunnel it need to go into the sdk.. but inclemente the brief for the generic resource latter? So when refined we can see what we move to it?" |
| The operations fall into the four groups of the tunnels brief | Softov, 2026-11-02: "write onto the brief" |
| The host stores each machine's record, so the catalogue moves to the host | Softov, 2026-11-02: "The host stores them" |
| The kind's `update` decides whether the change applies live or restarts the machine | Softov, 2026-11-02: "The kind decides" |
| One command, `x-ahpd/invokeOperation`, serves the computers and the tunnels | Softov, 2026-11-02: "One shared command" |
| The tunnels are built first, with the shared core. The computers come after, on that core | Softov, 2026-11-02: "Tunnels first" |
| A record of the shared core has an optional `owner`, with the `?owner=me` filter. Computers fill it with the person who made the machine. Tunnels leave it empty, so a tunnel belongs to the host | Softov, 2026-11-02: "Optional owner" |
| `remove` needs `computer:delete` and every other operation `computer:put`. A kind can name another grant, such as `computer:restart` | Softov, 2026-11-02: "host by group, kind own may name one... like it if wanted could name <thing>:restart or <thing>:<action> if wanted otherwise will write <thing>:put" |

## Open points

1. Do the three host tools move to the host, or does `@ahpd/computer` keep them for its own kinds? A model would then not reach a second plugin's machines.
2. Does the `containers` port stay with `@ahpd/computer`? A dev container is made by docker today.
3. Do the five `x-ahpd/computers/*` commands stay for a while beside the new command, so that ahpw and ahpapp keep working until they change?
4. How does a machine's id name its kind? The id records its runtime today. Not checked: whether a second plugin's ids can clash with the format.
5. Is a decision needed? The change reverses the 2026-09-22 answer, and its rejected option was a registry in the SDK. Here the registry is in the server, and only the kind's type is in the SDK.
