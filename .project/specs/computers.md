---
title: Computers
status: current
covers:
  - packages/computer/src/**
  - packages/computer/images/versions.json
  - packages/sdk/src/machines/computers.ts
  - packages/sdk/src/types/computers.ts
  - packages/sdk/src/types/machine.ts
  - packages/sdk/src/host/machines.ts
  - scripts/computer.mjs
decisions:
  - decisions/a-machine-commits-in-its-own-repository-and-the-host-fetches-it.md
  - decisions/cofold-config-reaches-a-machine-by-a-path-variable.md
refs:
  - "[code://packages/sdk/src/types/computers.ts#L93-L143](../../packages/sdk/src/types/computers.ts#L93-L143) - `MachineSource`, what the host hands the maker of a machine"
  - "[code://packages/sdk/src/machines/computers.ts#L113-L152](../../packages/sdk/src/machines/computers.ts#L113-L152) - `machineRefusal`, the checks before a session runs in a machine"
  - "[code://packages/sdk/src/machines/computers.ts#L162-L187](../../packages/sdk/src/machines/computers.ts#L162-L187) - `computersFor`, the port a backend is given"
  - "[code://packages/sdk/src/host/machines.ts#L481-L514](../../packages/sdk/src/host/machines.ts#L481-L514) - `placedIn`, where a source becomes a machine"
  - "[code://packages/sdk/src/host/admission.ts#L123-L135](../../packages/sdk/src/host/admission.ts#L123-L135) - a session that names a source needs `computer:write`"
  - "[code://packages/computer/src/plugin.ts#L48-L59](../../packages/computer/src/plugin.ts#L48-L59) - the plugin defaults"
  - "[code://packages/computer/src/plugin.ts#L1270-L1290](../../packages/computer/src/plugin.ts#L1270-L1290) - which disposable machines a daemon adopts at startup"
  - "[code://packages/computer/src/plugin.ts#L1755-L1770](../../packages/computer/src/plugin.ts#L1755-L1770) - a machine made for a session counts against `max`"
  - "[code://packages/computer/src/plugin.ts#L2100-L2190](../../packages/computer/src/plugin.ts#L2100-L2190) - the `computer` session setting and its picker"
  - "[code://packages/computer/src/runtime.ts#L939-L1014](../../packages/computer/src/runtime.ts#L939-L1014) - the labels a machine carries"
  - "[code://packages/computer/src/runtime.ts#L3541-L3557](../../packages/computer/src/runtime.ts#L3541-L3557) - `putIn` and `takeOut`, the attachment copies"
  - "[code://packages/computer/src/runtime.ts#L1802-L1815](../../packages/computer/src/runtime.ts#L1802-L1815) - `canMountImages`, the probe for image mounts"
  - "[code://packages/computer/src/parts.ts#L934-L935](../../packages/computer/src/parts.ts#L934-L935) - `refusedWithout`, when a failed part refuses a machine"
  - "[code://packages/computer/src/parts.ts#L986-L1024](../../packages/computer/src/parts.ts#L986-L1024) - `ensureJoined`, the joined image"
  - "[code://packages/computer/src/manifest.ts#L608-L628](../../packages/computer/src/manifest.ts#L608-L628) - `oneMountEach`, one mount for each target"
  - "[code://packages/computer/src/tools.ts#L50-L70](../../packages/computer/src/tools.ts#L50-L70) - `request_disposable_computer`, one of the three host tools"
  - "[code://packages/computer/src/catalogue.ts#L1-L45](../../packages/computer/src/catalogue.ts#L1-L45) - the `x-ahpd-computers://` channel"
  - "[code://packages/sdk/src/sandbox.ts](../../packages/sdk/src/sandbox.ts) - a chat's sandbox resolved as VS Code's `getSessionSandboxConfig`"
  - "[code://packages/sdk/src/host/sandbox.ts](../../packages/sdk/src/host/sandbox.ts) - the floor published, a chat's sandbox applied, and a rejection put back"
  - "[code://packages/computer/src/sandbox.ts](../../packages/computer/src/sandbox.ts) - the root `sandbox` property, the container check, and a start inside the runtime"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-backend-reaches-a-computer-through-a-port, a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps, a-disposable-alone-machine-refuses-another-session, a-machine-is-made-by-a-host-tool, a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time, a-machine-made-for-a-session-counts-against-max-and-needs-computer-write, a-machine-runtime-is-named-for-its-maker, a-need-and-a-mount-at-one-target-are-refused, a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback, a-session-folder-reaches-a-machine-only-where-its-profile-allows, a-session-in-a-machine-gets-each-attachment-copied-into-it, a-session-on-a-machine-not-prepared-for-its-agent-fails-at-creation, a-shared-target-is-refused-only-when-the-mounts-differ, an-agent-declares-its-machine-needs-with-a-method, cofold-config-reaches-a-machine-at-a-fixed-target, gvisor-is-a-docker-profile-option-not-a-runtime, one-computer-provider-with-runtimes-as-options, the-computer-is-an-object-a-person-manages, the-host-hands-an-agents-machine-needs-to-the-machine-maker, the-published-image-is-the-parts-joined
---

A computer is a machine that a session can run in, named `computer://<id>`.
One plugin, `@ahpd/computer`, serves the `computer:` scheme, and its `runtime` option says what makes the machines: `docker` or `ssh`.
A person makes, starts, stops and destroys a computer as a resource, and a session names one in its `computer` setting.

A backend reaches the machine through the `computers` port.
The port answers a command to spawn and never spawns it, so the backend keeps the process and its stdio.
The host hands each agent's machine needs to the maker.
The maker builds the machine from a profile, the needs and the parts in [`code://packages/computer/images/versions.json`](../../packages/computer/images/versions.json).
The code is in [`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts) and [`code://packages/sdk/src/machines/computers.ts`](../../packages/sdk/src/machines/computers.ts).

## Scenarios

### A person makes a computer

WHEN a person with `computer:write` writes `computer://<name>` with a JSON body
THEN the plugin makes a machine from the image or the profile that the body names
AND a name that a computer already has is refused with `-32010`
AND a machine past the plugin's `max` is refused with `-32602`.

### A person manages a computer

WHEN a person writes `running`, `stopped` or `restarted` to `computer://<id>/state`
THEN the runtime starts, stops or restarts the machine
AND a delete of `computer://<id>` destroys it.
The `status` and `capabilities` leaves read what the runtime says about the machine.
The `x-ahpd-computers://` channel lists every machine with its state for a reader with `computer:read`.
The same acts are also commands, such as `x-ahpd/computers/start`.

### The runtime is an option of one provider

WHEN the plugin loads with `runtime: "docker"`
THEN it makes machines with `docker run` and the default image `debian:bookworm-slim`.
WHEN the plugin loads with `runtime: "ssh"`
THEN it lists the boxes in `ssh.machines` and makes none
AND each of these machines is off this host, so every session in one runs in a [nested host](nested-hosts.md).
gVisor is not a runtime: a Docker profile sets `ociRuntime: "runsc"`, and the plugin passes it as `--runtime=runsc`.

### An agent says what its machine needs

WHEN the host makes a machine for a session
THEN it reads `machine()` from the session's agent at that time and hands the needs over in `MachineSource.needs`
AND `host.machineNeeds(provider)` answers the same needs to a plugin that asks.
A need is a mount, a file, a directory, an environment variable, a state volume or a part.
The maker reads the needs, and the agent never builds the machine.

### Two mounts at one target

WHEN two mounts or needs land at the same target inside a machine
AND their source, target and read-only flag are the same
THEN the machine carries one of them.
WHEN the two differ
THEN the plugin refuses the machine and names both.
The reason: one of the two would be lost with no word.

### A part is mounted from its image

WHEN a machine needs a part, such as an agent's command
AND Docker can mount image volumes
THEN the part's image is mounted read-only at `/opt/ahpd/<id>`.
WHEN Docker cannot mount images, or the `imageMounts` option is false
THEN the part goes in a named volume `ahpd-part-<id>-<version>`, which is filled once.

### A part fails to build

WHEN a part fails to build
THEN the plugin leaves it out with a log line
AND a machine shared by sessions is made without it
AND a session whose agent needs it is refused when it asks.
WHEN the machine is made for one session whose agent needs that part
THEN the plugin refuses the machine.
A part need can name a host mount as its fallback, which is used in place of a part that failed.

### The joined image

WHEN an operator runs `scripts/computer.mjs parts --joined`
THEN the script builds `ahpd-agents:<hash>` from `debian:bookworm-slim` with ca-certificates, git, ripgrep and every part.
The joined image is for a runtime that cannot mount image parts.
It is not the default image of a profile.

### A session asks for a machine of its own

WHEN a session sets `computer` to `disposable:<profile>` or to `devcontainer://<folder>`
THEN the session needs `computer:write` as well as `session:create`
AND the host makes the machine before the backend starts and writes its `computer://<id>` over the setting.
The new machine counts against `max` in the same turn as its create, so two sessions that start together cannot both pass the count.
A session that already has a machine keeps it, and a different source before the first turn is refused.

### A disposable machine

WHEN a session asks for a profile that says `disposable: true`
THEN the machine carries the profile, the session, the owner and this host's id as labels
AND the plugin removes it `disposableDelay` milliseconds after its last session leaves.
WHEN the profile also says `disposableAlone: true`
THEN the machine runs only the session it was made for, and the picker does not offer it.

### A daemon starts with machines already there

WHEN the daemon starts and lists a disposable machine
AND the machine's `ahpd.host` label is this daemon's id
AND this daemon keeps the machine's session
THEN the plugin adopts the machine and watches it with that session counted.
WHEN either check fails
THEN the plugin leaves the machine alone with a log line.
The reason: two daemons on one Docker keep sessions under the same ids, so the session id alone does not say whose a machine is.

### A session runs in a machine

WHEN a session names `computer://<id>` at create, or a change of its config names one
THEN the host refuses it if the machine is another daemon's
AND refuses it if the machine is kept for another session or was made for another owner
AND refuses it if the machine's `ahpd.agents` list does not name the session's agent
AND refuses it if the machine was made without a part the agent needs.
The refusal comes before the backend starts, so a session does not fail later inside the machine.
A machine with no agent list runs every agent.

### A session folder reaches a machine

WHEN a session in a machine works in a folder on this host
AND the profile says `sessionFolder: true`
THEN the folder is mounted into the machine.
WHEN the profile also says `sessionRepository: true`
THEN the repository that the folder sits in is mounted too, guarded by the profile's `gitGuard`.
A profile without `sessionFolder` gets no host folder.

### The picker offers machines

WHEN a client asks for the choices of the `computer` setting
THEN the plugin offers "This host" first, then each machine prepared for the asking agent
AND a `devcontainer://` row for the session's own folder, when it has a dev container definition
AND a `disposable:<key>` row for each disposable profile.
The setting is fixed once the session runs.

### A file reaches a session in a machine

WHEN a person attaches a file to a message in a session that runs in a machine
THEN the host copies the file into the machine at the same path, read-only and owned by root
AND only a path under the session's own attachments folder is copied.
WHEN the session goes
THEN the host takes its files back out of the machine.

### An agent asks for a machine with a host tool

WHEN a session has the advanced tools
THEN its agent sees `request_disposable_computer`, `release_computer` and `computer_exec`
AND a machine that a tool makes counts against `max`.
A session without the advanced tools does not see these three tools.

### The plugin declares the root sandbox property

WHEN the plugin loads
THEN it declares VS Code's root `sandbox` property through `registerProviderConfiguration`
AND it declares no other sandbox setting.
A backend whose commands start through `Start.computers.sandboxed` declares a chat's switch with `SANDBOX_ENABLED_PROPERTY`.
That property is VS Code's platform property, `sessionMutable` and `chatMutable`.

### A chat's sandbox is resolved within the floor

WHEN a backend reads `Start.computers.sandbox(chat)`
THEN the host answers the chat's sandbox as VS Code's `getSessionSandboxConfig` resolves it
AND the root settings come first, then the chat's selection, within the operator's `managedSettingsSandbox`.
A chat reads its selection from the values it runs on: its own where it has them, its session's otherwise.
Each session publishes the floor as `vscode.resolvedSandboxPolicy`.
Under a floor that allows bypass, a client's `off` is the chat's enablement.
A floor with `failClosed` keeps the sandbox on with no way out, and refuses a client's `off`.

### Each chat's sandbox is applied

WHEN a chat starts, the selection it takes changes, or the root `sandbox` settings change
THEN the host applies the chat's sandbox where its session runs
AND it publishes the chat's applied enablement in `vscode.sandboxState` under `chats`.
The default chat's state is also at the top, where older clients read it.

### A command runs inside the sandbox runtime

WHEN a backend asks `Start.computers.sandboxed` for a command and the chat's sandbox is on
THEN the answer runs the command inside `@vscode/sandbox-runtime` with the chat's settings
AND an MCP server runs inside it only while `sandboxMcpServers` is on.
A person's terminal and a `!` command are left alone.

### A computer says whether it can host the sandbox

WHEN the host applies a chat's sandbox
THEN it asks the computer the session runs on whether it can host the runtime
AND a container answers from its real Docker settings and then from the runtime's own start inside it.
A machine made for a session whose sandbox is on gets VS Code's options for it.

### A request the computer cannot host is rejected

WHEN a client turns a chat's sandbox on where its computer cannot host it
THEN the host publishes the computer's reason in `vscode.sandboxState` with the client's id and sequence number
AND it puts the selection back to the enablement last applied.
The rejection stays reported until a new selection is made.
A start that meets the same reason reports it in the same place.

### A machine is owned and metered

WHEN a machine starts, or a relay connects to one
THEN the plugin opens an up-time stretch for it
AND it writes the stretch as `computer` usage when the machine stops, goes or the daemon stops.
The owner is whoever made the machine, read from its labels or from `computers.json`, and `root:<host name>` when neither says.
A runtime that only lists, such as ssh, is metered from its listings and charged to the host.

## Known gaps

A machine made by libvirt or Proxmox is planned in [a profile's machines may live on another Docker or in a VM](../plans/container/05-p8-a-profile-on-another-docker/plan.md).
