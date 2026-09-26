# A computer

`@ahpd/computer` lets a client make a `computer`, run a session inside it, and destroy it.

Docker is the only runtime today.

A machine is named `computer://<id>`. Writing a manifest to that name makes one, deleting it destroys it, and a session whose `computer` setting names it runs its agent in there.

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

The machine must already exist. A session naming one that does not, or a backend that cannot reach one, is refused. It never falls back to running on the host.

| Backend | In a machine |
| --- | --- |
| `@ahpd/agent-acp` | Its command runs under `docker exec` |
| `@ahpd/agent-claude` | The Claude Code CLI runs under `docker exec` |
| `@ahpd/agent-cofold` | Refused, since it runs inside the host process. Use a [dev container](CONTAINERS.md) with cofold in `devcontainer.plugins` instead |

Clients get a picker for free: the key is marked `enumDynamic`, and `sessionConfigCompletions` answers with "This host" first, then each running machine with its image and status.

The session's working directory is mapped through the machine's mounts. With `/srv/app:/workspaces/app`, a session in `/srv/app/x` starts in `/workspaces/app/x`. The longest mount wins, and a path no mount covers starts in the machine's own `workdir`.

### Claude Code in a machine

The image needs the CLI. It runs `claude` from the image's `PATH`; `computerExecutable` in the `@ahpd/agent-claude` options names another path inside the machine.

The CLI's configuration has to be mounted. The backend sets `CLAUDE_CONFIG_DIR=/ahpd/claude` (change it with `computerConfigDir`, or `false` to leave the image's). Mount both the directory and the file beside it, or the CLI signs in but reports its configuration missing:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "mounts": [
  "/home/you/.claude:/ahpd/claude",
  "/home/you/.claude.json:/ahpd/claude/.claude.json"
] } }] }
```

Only `CLAUDE_*` and `ANTHROPIC_*` variables are passed into the machine. The host's `HOME`, `PATH` and `PWD` are not.

Anything running in a machine with your `~/.claude` mounted can use your subscription. Use a profile to decide which machines get it.

## Profiles

A profile is a named set of machine settings in the plugin options:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "profiles": {
  "claude": {
    "title": "Claude",
    "description": "The CLI and this host's configuration, shared in.",
    "image": "node:22", "cpus": "2", "memory": "512m", "workdir": "/work",
    "mounts": [
      "/home/you/.claude:/ahpd/claude",
      "/home/you/.claude.json:/ahpd/claude/.claude.json",
      "/home/you/.local/share/claude/versions/2.1.267:/usr/local/bin/claude:ro"
    ]
  },
  "plain": { "title": "Plain", "description": "Nothing shared.", "memory": "256m" }
} } }] }
```

A manifest picks one with `"profile": "claude"`, and its own fields still win. Mounts add up in order: the plugin's `mounts`, then the profile's, then the manifest's (if allowed); a later one wins for the same target. Other fields come from the manifest, then the profile, then the host default.

An unknown profile is refused with the list of known ones. The names are published in the create schema as an `enum` with titles and descriptions in `x-choices`, so a client can draw a picker. No profiles means no such property.

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

**Mounts in a manifest are off by default.** A manifest that could name `/:/host` would give root on the host to anyone with `computer:write`. By default a machine sees only the plugin's `mounts` and its profile's, a manifest with `mounts` is refused, and the field is left out of the create schema. To allow them:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "bodyMounts": true } }] }
```

That is reasonable on a single-person host. With it on, `computer:write` is root on the host.

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
