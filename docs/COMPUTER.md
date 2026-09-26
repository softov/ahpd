# A computer

`@ahpd/computer` lets a client make a `computer`, run a session inside it, and destroy it.

Docker is the only runtime today.

A machine is named `computer://<id>`, and it has two recipes: an image the host runs, or a folder's `devcontainer.json`, which the Dev Container CLI reads.
Writing a manifest to that name makes one, deleting it destroys it, and a session whose `computer` setting names it runs its agent in there.
A dev container is listed, picked and reached like any machine made from an image, and it survives the connection that made it - decision [a dev container is a computer, made from its devcontainer.json](../.project/decisions/a-dev-container-is-a-computer-made-from-its-devcontainer-json.md).

## Setup

The account that runs the daemon needs Docker. For a hypervisor running as that account later, it also needs `/dev/kvm`:

```sh
sudo usermod -aG docker "$USER"
sudo usermod -aG kvm "$USER"
```

Groups are read at login, so log out and back in (or `newgrp docker` for the current shell). Then check:

```sh
id -nG                                    # docker and kvm listed
docker info --format '{{.ServerVersion}}'
test -r /dev/kvm && echo 'kvm readable'
```

If `getent group kvm` lists you and `id -nG` does not, the shell is older than the change. `sudo setfacl -m u:$USER:rw /dev/kvm` opens the device until the next boot without a new login.

A container machine needs only `docker`. A VM inside a container does not need the `kvm` group either: `docker run --device /dev/kvm` passes the device through, and the image has to bring the hypervisor.

## Making one

Write a JSON manifest to the machine's name:

```json
{
  "runtime": "docker",
  "image": "debian:bookworm-slim",
  "cpus": "2",
  "memory": "2g",
  "profile": "claude",
  "workdir": "/work"
}
```

```json
{ "method": "resourceWrite", "params": { "channel": "ahp-root://", "uri": "computer://box", "data": "<the manifest>", "encoding": "utf-8", "createOnly": true } }
```

Only `image` is expected. `runtime` must match the host's, the limits are optional, and `workdir` is where commands start. `createOnly` makes a taken name fail with `-32010`. An invalid manifest fails with a message naming the field.

A manifest may name `folder`, a host folder mounted at the same path inside the machine; `workdir` defaults to it when the manifest names neither. Like `mounts` it reaches outside the machine, so a body may name one only where the operator allowed `bodyMounts`; a profile's own `folder` is always allowed.

### From a folder's devcontainer.json

In place of `image`, a manifest may name a folder whose `devcontainer.json` makes the container:

```json
{ "devcontainer": { "folder": "/path/to/repo" } }
```

The Dev Container CLI reads the file, so the image, the features, the mounts, the `remoteUser` and the lifecycle commands are the repository's and this host decides none of them - decision [a dev container is made by the Dev Container CLI](../.project/decisions/a-dev-container-is-made-by-the-dev-container-cli.md).
The create runs `devcontainer up --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder>`, and the folder is refused before the CLI runs when it is not there or has no `.devcontainer/devcontainer.json` or `.devcontainer.json`.
`image` and `devcontainer` are exclusive, and a body that names both is refused.
The create form a client draws offers no such field: the manifest is a flat set of properties and this source is not one of them, so a body written by hand or by a client that knows the field is the route.

A session in one is reached through the CLI rather than Docker, so its user and environment are the file's:

```
devcontainer exec --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder> <command>
```

The folder comes from the container's own label, never from the session, so a session can only reach the container that folder's file made.
Removing the computer removes the container and never the folder or its `devcontainer.json`.
A container someone made with `devcontainer up` by hand, without the labels, is not listed and cannot be reached as a computer.

| Command | What it does |
| --- | --- |
| `resourceList` on `computer://` | The machines this host made |
| `resourceRead` on `computer://<id>/status` | The runtime's record of one |
| `resourceRead` on `computer://<id>/capabilities` | The runtime, the manifest fields and the limits |
| `resourceRead` on `computer://<id>/stats` | CPU, memory, processes, network and disk right now |
| `resourceRead` / `resourceWrite` on `computer://<id>/state` | `running` or `stopped`; write `running`, `stopped` or `restarted` |
| `resourceWrite` to `computer://<id>` | Make one |
| `resourceDelete` on `computer://<id>` | Destroy it and everything in it |

Reading needs `computer:read`, and making, starting, stopping or destroying needs `computer:write`. No built-in role has `computer:write`, and `file:write` does not include it.

## How a client finds out

The handshake's `initialize._meta` (and the root state's `_meta`) carries `ahpd.resourceProviders`, one entry per scheme the host serves:

```json
{
  "computer": {
    "title": "Computer",
    "description": "A machine a session can run in.",
    "root": "computer://",
    "operations": ["read", "list", "resolve", "write", "delete"],
    "manifest": { "type": "object", "properties": { "image": { "type": "string", "title": "Image", "default": "debian:bookworm-slim" }, "...": {} } }
  }
}
```

`manifest` is the schema a create form is drawn from. The key is absent when the plugin is not loaded, and a request for a scheme nobody serves answers `-32601` with `nothing here serves computer:`. That is different from a permission refusal.

## A session in one

The plugin adds a `computer` key to the session settings:

```json
{ "method": "createSession", "params": { "channel": "ahp-session:/work", "provider": "acp", "config": { "computer": "computer://box" } } }
```

The machine must already exist. A session naming one that does not is refused. A backend that cannot enter a machine is refused too, unless it declares `runsNested`, which is the host starting a whole host in there instead - see [a backend that runs nested](#a-backend-that-runs-nested). It never falls back to running on the host.

A setting may also name a source to make one from, rather than a machine that exists. `devcontainer://<folder>` makes the folder's dev container when the session starts, with the session agent's needs, and the session then runs in the `computer://<id>` it became. Nothing makes a second container for one folder, and the picker offers that source only while no computer is labelled with the folder.

A machine is also kept to the agents it was prepared for. A profile with `agents` labels the machine `ahpd.agents=<list>`, and a session whose agent is not on that list is refused with a sentence naming both. A machine with no label was made before any of this existed and is available to every agent.

| Backend | In a machine |
| --- | --- |
| `@ahpd/agent-acp` | Its command runs under `docker exec`, or `devcontainer exec` in a dev container |
| `@ahpd/agent-claude` | The Claude Code CLI runs under `docker exec`, or `devcontainer exec` in a dev container |
| `@ahpd/agent-cofold` | A whole `ahpd` with the plugin runs inside the machine, and its frames are carried out as the session's - see below |

Clients get a picker for free: the key is marked `enumDynamic`, and `sessionConfigCompletions` answers with "This host" first, then each running machine with its image or folder and status. When the client says which agent the session would run, the machines not prepared for it are left out. A [disposable profile](#disposable-machines) is offered too, as `disposable:<profile>`, and once the session has made one it is an ordinary `computer://<id>`. A `devcontainer://<folder>` row is offered when the session's folder has a `devcontainer.json` and no computer is labelled with it.

The session's working directory is mapped through the machine's mounts. With `/srv/app:/workspaces/app`, a session in `/srv/app/x` starts in `/workspaces/app/x`. The longest mount wins, and a path no mount covers starts in the machine's own `workdir`.

### A backend that runs nested

Some backends cannot be moved into a machine: cofold's loop, tools and shell all run in the host process, and there is no server mode a process outside could drive. Such a backend declares `runsNested: true`, and a session of it whose `computer` setting names a machine is given the SDK's proxy backend instead of the backend itself.

The proxy starts a whole `ahpd` **inside the machine**, in stdio mode, with that backend loaded, and presents the inner session to the client exactly as a local one:

```
<host> --stdio --plugin <each>
```

The inner host creates the session with the same config minus `computer`, and the outer session forwards turns, tool confirmations, input answers, config changes, cancel and dispose to it and emits its chat and session actions as its own. The inner host's protocol version has to be this host's; another one is refused at the handshake.

**The image carries the host and the plugin.** There is no install step: a machine whose image has neither is a session that ends with a sentence carrying what the inner host last wrote to stderr. The plugin a provider needs is `@ahpd/agent-<provider>`, so cofold is `@ahpd/agent-cofold`:

```dockerfile
FROM node:22-bookworm-slim
RUN npm i -g @ahpd/server @ahpd/agent-cofold
```

**The profile says how the host starts.** `host` is the command and its arguments, `["ahpd"]` when it names none, and it is where an image that keeps its host somewhere else says so:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "profiles": {
    "cofold": {
      "title": "Cofold",
      "image": "ghcr.io/acme/ahpd-cofold:22",
      "agents": ["cofold"],
      "disposable": true,
      "host": ["node", "/work/ahpd/main.js"]
    }
  }
} }] }
```

The machine remembers the profile that made it, so a daemon that restarts - or one that did not make it - still starts the host the profile named. The profile's `agents` is what shares cofold's configuration and provider key into the machine, the same mechanism [Claude Code](#claude-code-in-a-machine) uses, and a profile without them is a cofold session that cannot sign in.

`--stdio` and one `--plugin` per spec are appended to `host`, so `host` names only the program: `ahpd`, a pinned `node /work/ahpd/main.js`, or whatever an image actually has.

### Claude Code in a machine

A machine made from a profile that names `claude` carries what the agent says it needs, so the CLI and its configuration come from the host without a person listing them by hand:

| Need | What it is on the host | Where it goes |
| --- | --- | --- |
| `claudeConfigDirectory` | `~/.claude` | `/ahpd/claude` |
| `claudeConfigJson` | `~/.claude.json` | `/ahpd/claude/.claude.json` |
| `claudeExecutable` | what `~/.local/bin/claude` points at, read-only | `/usr/local/bin/claude` |

The executable is resolved at the moment the machine is made, so an update on the host is followed rather than a version pinned in a path. A host path that is not there is refused at create, naming the need and the path, instead of becoming an empty directory the session exits 127 in.

The CLI runs with `CLAUDE_CONFIG_DIR=/ahpd/claude`. `computerConfigDir` in the `@ahpd/agent-claude` options names another path inside the machine, and `false` leaves the image's own configuration alone and mounts only the executable.

Only `CLAUDE_*` and `ANTHROPIC_*` variables are passed into the machine. The host's `HOME`, `PATH` and `PWD` are not.

**One `~/.claude` is one sign-in.** Every machine that mounts this host's configuration uses the same subscription, and anything running in one can read it. Use a profile to decide which machines get it, and treat the folder as shared for now.

## Profiles

A profile is a named set of machine settings in the plugin options:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "needs": { "claudeConfigDirectory": "/srv/claude-home" },
  "profiles": {
    "claude": {
      "title": "Claude",
      "description": "The CLI and this host's configuration, shared in.",
      "image": "node:22", "cpus": "2", "memory": "512m", "workdir": "/work",
      "agents": ["claude"]
    },
    "plain": { "title": "Plain", "description": "Nothing shared.", "memory": "256m" }
  }
} }] }
```

`agents` names the harnesses a machine is prepared for. Each of them declares what it needs with its own `machine()`, and the machine is made with the result and labelled `ahpd.agents=<list>`. A profile that names no agents is a machine with nothing added, as every profile was before this.

A need is filled from the profile, then the plugin option, then the agent's own default. So `"needs": { "claudeConfigDirectory": "/srv/claude-home" }` in a profile points that one need elsewhere for that one machine, and the same key in the plugin options does it for every profile:

```json
{ "profiles": { "claude": { "agents": ["claude"], "needs": { "claudeConfigJson": "/srv/claude.json" } } } }
```

A need is delivered as a bind mount, an environment variable or a file copied in. Copy-ins are placed between the container being created and its first process starting, and they are paid on every create and lost with the machine.

`folder` names a host folder mounted at the same path inside the machine, and `workdir` defaults to it. The same path is what keeps an agent's own record consistent: Claude writes its history under the working directory it saw, so the same spelling inside and out is what makes a session written in a machine resumable on this host.

A manifest picks a profile with `"profile": "claude"`, and its own fields still win. Mounts add up in order: the plugin's `mounts`, then the profile's, then the manifest's (if allowed); a later one wins for the same target. Other fields come from the manifest, then the profile, then the host default.

An unknown profile is refused with the list of known ones. A profile that names an agent this host does not have is refused too, rather than made without what it was prepared for. Two needs landing on one target is refused, because one of them would silently lose.

The names are published in the create schema as an `enum` with titles and descriptions in `x-choices`, so a client can draw a picker. No profiles means no such property.

## Disposable machines

A profile that sets `disposable: true` has no machine until a session starts. It is offered in the session's `computer` picker as `disposable:<profile>`, labelled with the profile's title, and the machine is made at session start from the profile, that session's harness needs and the session's folder mounted at the same path:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "profiles": {
    "scratch": {
      "title": "Scratch",
      "description": "A machine of this session's own, with the CLI shared in.",
      "image": "node:22",
      "mounts": ["/srv/claude-home:/ahpd/claude"],
      "disposable": true,
      "disposableDelay": 300000,
      "disposableAlone": true
    }
  }
} }] }
```

| Field | What it does |
| --- | --- |
| `disposable` | The profile is offered as a `disposable:<profile>` row instead of being made ahead of time. The machine takes the `machine()` needs of the harness the session runs, so the profile names no `agents`. |
| `disposableDelay` | Milliseconds after the last session using the machine is disposed before it is removed. Default `300000`, five minutes. A session that picks the machine again in that window cancels the timer. |
| `disposableAlone` | The machine is not listed in the picker, so only the session it was made for runs in it. The `disposable:<profile>` row is still offered. |

The machine is labelled `ahpd.disposable=<profile>`, so a daemon that restarts finds the machines it left behind and gives each the delay again. Its `computer` setting is the `computer://<id>` it became, so a session started again before its first turn keeps the machine it already made rather than making a second one.

A session that picks the running machine, by its `computer://<id>`, counts as a user of it too; the delay starts when the last of them is disposed. A machine that could not be made answers the session with the runtime's own sentence.

**A copy-in is paid on every create**, so a disposable profile prefers mounts. A need delivered as a copy is paid again for every session's machine and lost with it, which is the opposite of what a profile picked per session wants.

## Stats

`computer://<id>/stats`:

```json
{ "running": true,
  "cpu": { "percent": 34.2, "cores": 2 },
  "memory": { "used": 421888, "limit": 536870912, "percent": 0.08 },
  "pids": 7,
  "network": { "rx": 266, "tx": 84 },
  "block": { "read": 4100, "write": 0 } }
```

Sizes are bytes. `cpu.percent` is percent of one core, so it can exceed 100; `cores` is present when the machine has a CPU limit. A stopped machine answers `{ "running": false }`. Each read is one `docker stats --no-stream`, so poll for a live view.

## State

`computer://<id>/state` reads `running` or `stopped`. Writing `restarted` is `docker restart`, which also starts a stopped machine. The runtime's finer states (`exited`, `paused`, `created`) are in `status` under `State.Status`.

## Security

Read this before exposing the plugin to anyone but yourself.

**Only machines this host made.** Each machine carries a label, and every read and action checks it. Any other container on the same Docker answers `-32008`, the same as a name that does not exist. `computer:write` covers this host's machines, not the Docker daemon.

**Mounts in a manifest are off by default.** A manifest that could name `/:/host` would give root on the host to anyone with `computer:write`. By default a machine sees only the plugin's `mounts` and its profile's, a manifest with `mounts` or a `folder` is refused, and both fields are left out of the create schema. To allow them:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "bodyMounts": true } }] }
```

That is reasonable on a single-person host. With it on, `computer:write` is root on the host.

A `devcontainer` source is not gated by `bodyMounts`: the folder names a `devcontainer.json`, and what that file mounts is the CLI's to apply, so a body that may name one is a body that may build a folder's container. It is not a way to mount an arbitrary host path by itself, but `computer:write` with it reaches whatever the named file declares.

**Allowed images.** By default any image may be used. To limit them:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "images": ["node:*", "ghcr.io/acme/**"] } }] }
```

The host's default image and every profile's image are always allowed. Patterns match whole name components, never string prefixes:

| Pattern | Allows | Refuses |
| --- | --- | --- |
| `node:22` | that image | any other tag |
| `node:*` | any tag of `node` | `nodejs/node`, `node-evil/x` |
| `ghcr.io/acme/*:*` | any repository directly under `acme` | `ghcr.io/acme-evil/x` |
| `ghcr.io/acme/**` | anything under `acme` | anything outside it |
| `*` | anything | nothing |

`*` is one component and `**` any number of them. `*/acme/**` matches `acme` on any registry. A star inside a component, like `node:22-*`, is rejected when the plugin loads. A pattern with no tag allows every tag, and `node:22`, `library/node:22`, `docker.io/library/node:22` and `index.docker.io/library/node:22` are the same image. When every entry is a plain name, the list is published as an `enum` for a picker.

An image starting with `-` is always refused, because Docker would read it as a flag.

**What a machine is not.** The container separates processes and the filesystem, not the network, and a bind mount is the host's files. Nothing in a machine survives `resourceDelete`.

## The three tools

`request_disposable_computer`, `release_computer` and `computer_exec` let a model ask for a scratch machine during a session. They are separate from the machine a session runs in, and they follow the same image rules.

They are off until the daemon enables advanced tools:

```json
{ "advancedTools": true }
```

or `--advanced-tools`. The plugin option `tools: false` removes them even then.

## The script

`scripts/computer.mjs` manages one container directly with Docker, without a client. It labels it `ahpd.computer=1`, so it shows up in `computer://` listings.

```sh
node scripts/computer.mjs start --cpus 2 --memory 2g
node scripts/computer.mjs exec -- sh -c 'uname -a'
node scripts/computer.mjs stop
node scripts/computer.mjs rm
```

| | |
| --- | --- |
| `start` | Run it, or start it if stopped |
| `status` | Running or not, image, since when |
| `exec -- <cmd>` | Run a command inside it |
| `stop` | Stop it and keep it |
| `rm` | Remove it |
| `list` | Every computer the script made |

Options: `--name` (default `ahpd-computer`), `--image` (default `debian:bookworm-slim`), `--cpus`, `--memory`, `--mount`, `--kvm`, `--label`. `--kvm` fails up front if `/dev/kvm` is not readable. `--mount` is passed to Docker as written:

```sh
node scripts/computer.mjs start --mount type=bind,src=/github/ahpd,dst=/work
```

## Trying it from a checkout

A daemon with the computer plugin and the ACP bridge, using the test fixture as the agent:

```sh
cat > /tmp/ahpd-computer.json <<'JSON'
{
  "port": 9216,
  "host": "127.0.0.1",
  "withoutConnectionToken": true,
  "paths": ["/github/ahpd"],
  "plugins": [
    { "name": "./packages/computer/src/index.ts", "options": { "image": "node:22", "bodyMounts": true } },
    { "name": "./packages/agent-acp/src/index.ts", "options": { "command": "node", "args": ["/srv/acp.mjs"], "provider": "acp" } }
  ]
}
JSON
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /tmp/ahpd-computer.json
```

From a client, write a manifest to `computer://box` with `mounts: ["/github/ahpd/test/fixtures/acp-server.mjs:/srv/acp.mjs:ro"]` and `workdir: "/srv"`, create a session with `config: { "computer": "computer://box" }`, and send a turn. It should answer `chat/turnComplete`. After `resourceDelete` on `computer://box`, `docker ps -a --filter label=ahpd.computer=1` should be empty.
