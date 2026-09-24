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
  "profile": "claude",
  "workdir": "/work"
}
```

```json
{ "method": "resourceWrite", "params": { "channel": "ahp-root://", "uri": "computer://box", "data": "<the manifest>", "encoding": "utf-8", "createOnly": true } }
```

Only `image` is expected; `runtime` must be the one this host runs, the limits are optional, and `workdir` is where a command starts inside it. An image may not begin with a dash, because the image's place in the runtime's argument list is one a flag would be read in. What a machine can see is not in here unless the deployment says it may be - see [What a body may not say](#what-a-body-may-not-say).
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

Only a backend that starts its process through the host's `computers` port can
run in one, which today is `@ahpd/agent-acp` and `@ahpd/agent-claude`. Claude
Code spawns a CLI, so it is moved by starting that CLI in the machine: the
Claude SDK's own `spawnClaudeCodeProcess` is handed a spawn that goes through
the port, and nothing else about the backend changes. cofold has no child
process to move - its loop, its tools and its shell all run in this process -
so it still refuses a session that names a machine, with a sentence naming the
backend, rather than run on the host while the session says `computer://box`.
The setting is honest in both directions: a session that opens has had its
machine honoured.

A machine's `-v` is this host's filesystem made visible and nothing more: the
container is the isolation, not a boundary the daemon enforces. `-w` is where a
command starts inside the machine, and a caller's working directory is read
through the machine's mounts to find it: a path a mount covers is the same place
under another name, so `/srv/app/x` with `/srv/app:/workspaces/app` starts at
`/workspaces/app/x`. The longest mount wins, so one nested inside another is not
shadowed by it, and a path no mount covers is not a directory in there at all -
the machine's own working directory stands instead of a host path that only
looks right.

### Running Claude Code in one

Two things have to be true of the image, and neither is something this host can
arrange for you.

**The CLI has to be in it.** The in-machine command is `claude` on the image's
PATH; `computerExecutable` on `claude()` names it somewhere else. This is never
this host's own path - the executable that runs here is the SDK's to find, and
the one in the machine has to exist in the image.

**Its configuration has to reach it.** The CLI reads `CLAUDE_CONFIG_DIR`, which
this backend sets to `/ahpd/claude` unless `computerConfigDir` says otherwise or
`false` leaves the image's own. Nothing here mounts anything: the mount is
yours, and the plugin's `mounts` option is one line that gives it to every
machine it makes.

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "mounts": [
  "/home/you/.claude:/ahpd/claude",
  "/home/you/.claude.json:/ahpd/claude/.claude.json"
] } }] }
```

Both, because they are one directory to the CLI and two paths on this host:
the credential lives *inside* `~/.claude` and `.claude.json` is its *sibling*,
so a machine given only the first runs signed in but says its configuration file
is missing. A subscription needs no `ANTHROPIC_API_KEY` and none is put on the
docker command line; what reaches the machine is the mounted file.

Only `CLAUDE_*` and `ANTHROPIC_*` cross into the machine. This host's `HOME`,
`PATH` and `PWD` are this host's: forwarded, they send the CLI looking for a
home the machine does not have and a PATH that may not find it, which is a
container that fails with `executable file not found` for a reason that has
nothing to do with the image.

Sharing one `~/.claude` across machines shares one credential, and its refresh:
anything running in such a machine can use that subscription. A machine made
from an image you did not write is a machine you are handing it to. That is
what profiles are for.

## Profiles

A profile is a named set of machine settings the operator wrote down once, so
what a machine is *given* is a deployment decision rather than three mount
strings a person retypes correctly every time.

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

A create body picks one by name, and what it says itself still wins:

```json
{ "profile": "claude", "workdir": "/work" }
```

Three sources for the mounts, widest first, so the narrower statement stands where two name one target: the plugin's own `mounts`, then the profile's, then the body's where a body is allowed any. Every other field is the body's, then the profile's, then the host default.

A profile the host does not define is refused rather than ignored, and the
refusal lists the ones it has. Silently making a machine without the mounts the
person asked for fails later and further away, when the agent cannot sign in.

The names are published in the create schema as an `enum` with a
`x-choices` list carrying each one's title and description, so a client draws
the picker from what the host advertised and needs no code of its own. A
deployment that defines no profiles publishes no such property, because a
picker with no choices is a control that only takes up a screen.

So `plain` and `claude` are two machines on one host, and only one of them can
use your subscription.

## What a machine is using

`computer://<id>/stats` answers what it is doing right now, beside
`status`, which is what it *is*.

```json
{ "running": true,
  "cpu": { "percent": 34.2, "cores": 2 },
  "memory": { "used": 421888, "limit": 536870912, "percent": 0.08 },
  "pids": 7,
  "network": { "rx": 266, "tx": 84 },
  "block": { "read": 4100, "write": 0 } }
```

Numbers rather than the runtime's own display text: `docker stats` writes
`444KiB / 512MiB` and `1.01kB / 126B` in one payload, mixing binary and decimal
units, and a client drawing a dial from those would be parsing a human
sentence. The parsing happens once, in the runtime, so a second runtime answers
in the same units.

`cpu.percent` is percent of one core's time, which is why `cores` travels with
it: 150% is busy on two cores and impossible on one. `cores` is absent when the
machine was given no CPU limit.

A machine that is not running answers `{ "running": false }` rather than
zeroes, because a dial reading zero says idle, which is not the same as
stopped. Each read is one `docker stats --no-stream`: a client that wants a
moving dial asks again, and there is no feed to leave open.

## Turning one off and on

`computer://<id>/state` is the one leaf that is written as well as read. Reading it answers `running` or `stopped`; writing `running`, `stopped` or `restarted` puts it there.

```
resourceWrite computer://box/state  "restarted"
```

A write rather than a verb of its own, because a resource scheme has four verbs and none of them is `restart`: doing it this way keeps starting a machine inside the same `computer:write` grant that makes and destroys one, with no new method for the gate to be taught about. `restarted` is `docker restart`, which starts a machine that was stopped and cycles one that was not, so a client does not have to ask which it was and race whoever else is acting on it.

The leaf answers in the words it accepts rather than the runtime's own, which are a longer list - `exited`, `paused`, `created`. `status` is the runtime's whole record and has `State.Status` in it for a reader who wants the difference.

## Only the machines this host made

Every machine this plugin makes carries a label, and every read and every act checks it. A container running on the same Docker that this plugin did not make is not a computer: `computer://<its name>` answers the same `-32008` as a name that does not exist, and stop, restart and destroy refuse with it. The two read the same on purpose, because a refusal that named the difference would answer whether a container exists.

That is what bounds the grant. `computer:write` is a permission over the machines this host made, not over the Docker daemon it made them with.

## What a body may not say

A mount is the one field in a create body that reaches outside the machine. A body free to name `/:/host` can read and write this host as root from inside a machine it just made, which would make `computer:write` a permission over the host rather than over the machines the host makes.

So a body may not name mounts unless the deployment says it may:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "bodyMounts": true } }] }
```

Off, which is the default, what a machine can see is the plugin's own `mounts` and the profile the body picked - the operator deciding what is shareable and a person picking from it. A body that names mounts anyway is refused, and the refusal lists the profiles this host has, rather than making a machine without what was asked for. The `mounts` property is left out of the create schema too, so a client drawing a form from it draws no field for something that would be refused; the refusal is still what does the work, because a body written by hand or by a client holding an older schema has to be answered.

On is the older behaviour and a fair setting for a host with one person on it, where a machine is a convenience rather than a boundary. It is the setting to keep in mind when reading the rest of this page: with it on, `computer:write` and root on this host are the same permission.

`image` is the other field in a body that the runtime reads as more than a value. It lands in the argument list at the position where `docker run` still parses flags, so an image is refused if it begins with a dash. Nothing else about it is checked: a registry, a port, a tag and a digest are all legal names and this host has no business having an opinion about which registry you use.

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
    { "name": "./packages/computer/src/index.ts", "options": { "image": "node:22", "bodyMounts": true } },
    { "name": "./packages/agent-acp/src/index.ts", "options": { "command": "node", "args": ["/srv/acp.mjs"], "provider": "acp" } }
  ]
}
JSON
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /tmp/ahpd-computer.json
```

Then, from a client: write a manifest to `computer://box` with `mounts: ["/github/ahpd/test/fixtures/acp-server.mjs:/srv/acp.mjs:ro"]` (which is why the configuration above sets `bodyMounts`) and `workdir: "/srv"`, create a session with `config: { "computer": "computer://box" }`,
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
