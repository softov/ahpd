# A computer

An object a person makes, lists, reads and destroys, and a place a session can
run: `computer://<id>` names a machine whatever runtime made it, a resource
write makes one, a resource delete destroys it, and a session that names one
runs its agent inside it - decision `the-computer-is-an-object-a-person-manages`.
The three tools a *model* may ask for still exist, and are off until the daemon
permits advanced tools.

Docker is available on this machine; `/dev/kvm` is readable once the account is
in the `kvm` group and has started a new session, so the first section is the
once-per-machine part.

## Let a person use Docker and KVM

`docker` talks to a root daemon over a socket that belongs to the `docker`
group, and `/dev/kvm` belongs to `kvm`.
Neither is reachable from an ordinary account until it is a member of both:

```sh
sudo usermod -aG docker softov
sudo usermod -aG kvm softov
```

A group is read when a session starts, so that lands in the next login.
For the shell you are in now:

```sh
newgrp docker      # or log out and back in
```

Then check both:

```sh
id -nG                    # expect docker and kvm in the list
docker info --format '{{.ServerVersion}}'
test -r /dev/kvm && echo 'kvm readable' || echo 'kvm not readable'
```

A membership `usermod` adds shows in the group file at once and in `id -nG`
only in a session that started after it, so the two can disagree:

```sh
getent group kvm          # kvm:x:993:softov   - the file already says so
id -nG                    # ...and this shell still does not, until it is new
```

That is the usual reason `/dev/kvm` is still not readable after the command:
the shell, not the group.

Inside the sandbox this repository is developed in, `/dev` is a minimal one and
`/dev/kvm` is not visible at all, so the last check is for a normal shell.

If logging out is not an option, the device can be opened for one boot with an
ACL rather than a group:

```sh
sudo setfacl -m u:softov:rw /dev/kvm
```

That is per boot unless a udev rule keeps it, so the group is the durable
answer.

### What each one buys

| | |
| --- | --- |
| `docker` | Start, stop and exec a container. A container computer needs nothing else |
| `kvm` | Open `/dev/kvm` yourself, which a hypervisor running as you needs |

A container whose root opens the device does not need the group at all, because
the daemon passes the device through and root inside the container is not bound
by the file's mode:

```sh
docker run --device /dev/kvm ...
```

That is how a VM inside a container runs without adding anybody to `kvm`, and it
needs a hypervisor in the image; `qemu`, `cloud-hypervisor` and `firecracker` are
none of them installed on this machine.

## Making one

A computer is made by writing a JSON manifest to its name, which every client
can do with the resource commands it already has:

```json
{
  "runtime": "docker",
  "image": "debian:bookworm-slim",
  "cpus": "2",
  "memory": "2g",
  "mounts": ["/github/api:/work", "/srv/server.mjs:/srv/server.mjs:ro"],
  "workdir": "/work"
}
```

```json
{ "method": "resourceWrite", "params": { "channel": "ahp-root://", "uri": "computer://box", "data": "<the manifest>", "encoding": "utf-8", "createOnly": true } }
```

Only `image` is expected; `runtime` must be the one this host runs, the limits
and mounts are optional, and `workdir` is where a command starts inside it.
`createOnly` is what makes a create onto a name that is taken a refusal
(`-32010`) rather than a silent no-op, and an invalid manifest is a sentence
naming the field. `computer://<id>/capabilities` says the same thing in the
host's own words, so a client can draw the form from it.

| Command | What it does |
| --- | --- |
| `resourceList` on `computer://` | Every machine this provider made, by name |
| `resourceRead` on `computer://<id>/status` | The runtime's own record of one |
| `resourceRead` on `computer://<id>/capabilities` | The runtime, the manifest fields and the limits |
| `resourceWrite` to `computer://<id>` | Make one, from the manifest above |
| `resourceDelete` on `computer://<id>` | Destroy it, and everything in it |

The grant is the scheme's: reading one is `computer:read` and making or
destroying one is `computer:write`, which no built-in role has. A `file:write`
holder cannot make a machine, which is deliberate - a role that may save a file
may not, by that alone, start a container.

## How a client knows there are computers

Before any machine exists, the host says so on the handshake. `initialize._meta`
(and the root state's `_meta`, from the same answer) carries
`ahpd.resourceProviders`, one entry per scheme the host serves:

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

`operations` is what the provider implements and `root` is where its objects
live, both derived by the host; `manifest` is the schema the create body is
drawn from, and it is the same list `computer://<id>/capabilities` reports for
one machine. The key is absent from a host that serves no such scheme, and a
client that does not know the key ignores it.

A scheme nobody serves answers `-32601` with `nothing here serves computer:`,
which is the host saying it has nothing for that scheme rather than refusing a
person - so a client's probe and its permission handling are two different
branches.

## A session in one

A session that names a computer runs its agent inside it. The setting is the
`computer` key the plugin contributes, so it appears in the session schema a
client draws only while the computer plugin is loaded:

```json
{ "method": "createSession", "params": { "channel": "ahp-session:/work", "provider": "acp", "config": { "computer": "computer://box" } } }
```

The machine must already exist: making one is the person's resource write above,
and a session naming one that is not there refuses with a sentence rather than
running on this host. With the ACP backend loaded, this is one command wrapped
in `docker exec` inside that machine; a backend handed no way to reach a machine
refuses rather than falling back.

Only a backend that spawns its process through the host's `computers` port can
run in one, which today is `@ahpd/agent-acp` alone. Claude Code spawns its own
CLI and cofold runs in this process, so both refuse a session that names a
machine - with a sentence naming the backend - rather than run on the host while
the session says `computer://box`. The setting is honest in both directions: a
session that opens has had its machine honoured.

A machine's `-v` is this host's filesystem made visible and nothing more: the
container is the isolation, not a boundary the daemon enforces. `-w` is where a
command starts inside the machine, and it is the only working directory that
means anything in there - the session's own directory on this host is not a path
the machine has.

## The three tools

`request_disposable_computer`, `release_computer` and `computer_exec` are the
*model's* way to ask for a scratch machine from inside a session. They are a
different thing from the machine a session runs in, which exists before that
session's first turn.

Each declares `advancedPermission`, so none of them is offered to a session
until the daemon says so:

```json
{ "advancedTools": true }
```

or `--advanced-tools`. Unset, the plugin contributes the whole lifecycle and no
tool a model can call; the reference host's own tools declare nothing and are
unaffected. The plugin's own `tools: false` still drops these three while
leaving the lifecycle in place.

## The script

`scripts/computer.mjs` is the operator's direct path to Docker for a machine no
client asked for. It owns one container by name and labels it
`ahpd.computer=1`, so a `computer://` listing shows what either made.

```sh
node scripts/computer.mjs start --cpus 2 --memory 2g
node scripts/computer.mjs exec -- sh -c 'uname -a'
node scripts/computer.mjs stop
node scripts/computer.mjs rm
```

| | |
| --- | --- |
| `start` | Run one, or start the stopped one. Idempotent |
| `status` | Whether it is running, on what image, since when |
| `exec -- <cmd>` | Run a command inside it |
| `stop` | Stop it, keeping it |
| `rm` | Remove it for good |
| `list` | Every computer this script made |

Options: `--name` (default `ahpd-computer`), `--image` (default
`debian:bookworm-slim`), `--cpus`, `--memory`, `--mount`, `--kvm`, `--label`.

`--kvm` refuses before starting anything when the device is not readable, and
prints the two commands above rather than failing inside the container later.

`--mount` is handed to docker as it is written, so a repository can be given to
the computer:

```sh
node scripts/computer.mjs start --mount type=bind,src=/github/ahpd,dst=/work
```

## Trying it by hand

What was run on 2026-09-23, and what the shape needs: Docker answering, an image
with the harness in it, and a checkout with no build.

```sh
# A daemon with the computer plugin and the ACP bridge. `node:22` has node, so
# the ACP fixture can be mounted in and run inside the machine.
cat > /tmp/ahpd-computer.json <<'JSON'
{
  "port": 9216,
  "host": "127.0.0.1",
  "withoutConnectionToken": true,
  "paths": ["/github/ahpd"],
  "plugins": [
    { "name": "./packages/computer/src/index.ts", "options": { "image": "node:22" } },
    { "name": "./packages/agent-acp/src/index.ts", "options": { "command": "node", "args": ["/srv/acp.mjs"], "provider": "acp" } }
  ]
}
JSON
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /tmp/ahpd-computer.json
```

Then, from a client: write a manifest to `computer://box` with
`mounts: ["/github/ahpd/test/fixtures/acp-server.mjs:/srv/acp.mjs:ro"]` and
`workdir: "/srv"`, create a session with `config: { "computer": "computer://box" }`,
and send it a turn. It answered `chat/turnComplete`, and `resourceDelete` on
`computer://box` left `docker ps -a --filter label=ahpd.computer=1` empty.

## What this is not

- **It is not the model's machine.** A model may ask for a scratch computer with
  a tool, but the machine a session runs in is chosen by the person who made the
  session, and an agent never creates the machine it is already inside.
- **It is not a master.** `@ahpd/computer` starts a machine itself, by Docker.
  The research that opened this work wanted a master to authorize the request
  and hand one back; when that exists it replaces the runtime behind the same
  `computer://` names, and nothing a client says changes.
- **It is not a sandbox boundary.** The container is separate from the host's
  process and filesystem, not from the network, and a bind mount is the host's
  files by definition.
- **It is not durable.** `resourceDelete` is the point, and nothing in a machine
  survives it.
