# @ahpd/computer

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fcomputer)](https://www.npmjs.com/package/@ahpd/computer)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Disposable machines for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A client or an agent makes a `computer`, runs commands and sessions inside it, and destroys it.

Docker is the runtime it ships with. A machine is a container this package started, labelled `ahpd.computer=1`, kept alive with `sleep infinity`, and reached as `computer://<id>`.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/computer`](https://github.com/softov/ahpd/tree/main/packages/computer).

## In the daemon

```bash
ahpd plugin install @ahpd/computer
```

Or name it beside a backend for one run:

```bash
ahpd --plugin @ahpd/agent-claude --plugin @ahpd/computer
```

The account the daemon runs as has to reach Docker. Run this once, then start a new login session:

```bash
sudo usermod -aG docker "$USER"
```

In the configuration file, with the options a person sets most often:

```json
{
  "plugins": [
    "@ahpd/agent-claude",
    {
      "name": "@ahpd/computer",
      "options": {
        "image": "debian:bookworm-slim",
        "cpus": "2",
        "memory": "2g",
        "max": 3,
        "profiles": {
          "claude": { "title": "Claude", "agents": ["claude"], "needs": { "anthropicKey": { "$secret": "host:anthropic" } } }
        }
      }
    }
  ]
}
```

## Options

Every option below is a key under `options` in the plugin's entry, and the daemon checks each value against the schema before `apply` runs. An entry inside a map (`env`, `needs`, a profile) that cannot be used is dropped with a line, and the rest load.

| Option | Default | What it does |
| --- | --- | --- |
| `runtime` | `docker` | Which runtime to use. `docker` is the only one |
| `command` | `docker` | The program to run |
| `args` | none | Arguments before its own, for a wrapper or a context |
| `env` | none | Environment variables merged over the daemon's for that program |
| `image` | `debian:bookworm-slim` | The image a machine is made from when a call names none |
| `cpus` | none | A CPU limit for every machine this host makes |
| `memory` | none | A memory limit for every machine this host makes |
| `max` | `3` | How many machines may exist at once |
| `label` | `ahpd.computer=1` | The label every machine carries, and the one every read checks |
| `prefix` | `ahpd-computer` | What the name of every machine this host makes starts with |
| `sessionSetting` | `true` | Whether the plugin adds a `computer` session setting that names the machine a session runs in |
| `sessionDefault` | none | That setting's default, as a `computer://<id>` URI |
| `needs` | none | Values for any agent's machine needs, by need name. A value may be `{ "$secret": "<scope>:<name>" }`, read when the machine is made. See [Profiles](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#profiles) |
| `mounts` | none | What every machine this plugin makes can see, each `<host path>:<machine path>` |
| `profiles` | none | The named sets a person picks from when making a machine. See `profiles.<name>` below |
| `bodyMounts` | `false` | Whether a person making a machine may name `mounts` or a `folder` of their own. With it on, `computer:write` is root on the host. See [Security](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#security) |
| `imageMounts` | `true` | Whether a part may be mounted from its own image. `false` mounts every part from a volume filled once from it |
| `images` | any image | The image patterns a machine may be made from, such as `node:*` or `ghcr.io/acme/**` |
| `devcontainer` | the `devcontainer` CLI | The Dev Container CLI, as a launcher and as a machine maker. `false` switches every dev container route off. See `devcontainer` below |

### `profiles.<name>`

A manifest picks a profile with `"profile": "<name>"`, and its own fields still win. [Profiles](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#profiles) and [Disposable machines](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#disposable-machines) have the detail.

| Option | Default | What it does |
| --- | --- | --- |
| `title` | the name | What the picker shows for it |
| `description` | none | One line about it |
| `image` | the plugin's `image` | The image its machines are made from |
| `cpus` | the plugin's `cpus` | A CPU limit for its machines |
| `memory` | the plugin's `memory` | A memory limit for its machines |
| `workdir` | `folder`, or the image's | Where commands start |
| `mounts` | none | Mounts added after the plugin's own |
| `folder` | none | A host folder mounted at the same path inside the machine |
| `agents` | none | The agents its machines are prepared for. A session of another agent is refused |
| `needs` | none | Values for its agents' machine needs, over the plugin's `needs` |
| `parts` | none | The parts every machine from it carries, by their ids in the versions file |
| `host` | `["ahpd"]` | The command that starts the nested host inside one of its machines |
| `secretUnreadable` | `fail` | When a need named from the vault cannot be read again after a restart: `fail` every command into the machine, or `drop` that variable and log it |
| `state` | `volume` | Where its agents keep their state: `volume`, a named volume per provider seeded from this host, or `host`, this host's own configuration mounted |
| `stateScope` | `owner` | Who shares a state volume: `owner`, one per owner of the machine, or `shared`, one for every owner of the profile |
| `gitGuard` | `fetch` | How a git directory in a session's machine is guarded: `fetch`, the machine commits in a git directory of its own and the host fetches the work back, or `open`, the host's git directory writable in the machine. `bind` is read as `fetch` |
| `nestedDelete` | `inside` | Deleting a session that ran in one of its machines and is not running: `inside` starts the machine's host to dispose that session there too, `record` deletes it here and leaves the machine's copy |
| `disposable` | `false` | No machine until a session starts: the profile is offered as `disposable:<name>` and a machine is made for that session |
| `disposableDelay` | `300000` | Milliseconds after the last session leaves a disposable machine before it is removed |
| `disposableAlone` | `false` | A disposable machine is not listed in the picker, so only the session it was made for runs in it |
| `sessionFolder` | `false` | The session's working folder is mounted read-write at the same path inside the machine |
| `sessionRepository` | `false` | The repository that folder sits inside is mounted too. Needs `sessionFolder` |
| `sessionTree` | `shared` | `shared` mounts this host's tree; `copy` gives the machine a checkout of its own that reaches the host only by fetch. Needs `sessionFolder` |

### `devcontainer`

[CONTAINERS.md](https://github.com/softov/ahpd/blob/main/docs/CONTAINERS.md#what-the-host-needs) has the detail.

| Option | Default | What it does |
| --- | --- | --- |
| `command` | `devcontainer` | The Dev Container CLI program |
| `args` | none | Arguments before its own, such as `["-y", "-p", "@devcontainers/cli", "devcontainer"]` with `npx` |
| `env` | none | Environment variables for the CLI |
| `host` | `["ahpd"]` | The program that runs inside the container |
| `plugins` | none | What the host inside the container loads. An empty list offers no dev container flow |
| `docker` | the plugin's `command` | The Docker program commands inside the container run through |
| `install` | `true` | How the install step runs: a shell command, or `false` to skip it for an image that already has a host |
| `folders` | any folder, or none on a host with a users directory | The absolute host folders a dev container may be made from |

## Commands

| Command | What it does |
| --- | --- |
| `ahpd plugin install @ahpd/computer` | Install the package into the configuration directory and name it in `config.json` |
| `ahpd plugin update @ahpd/computer` | Move it to the version that matches the daemon; `all` in place of the name moves every installed plugin |
| `ahpd plugin list` | What the configuration names, and what a run would load, without loading it |
| `ahpd vault set <scope>:<name>` | Keep a value a need reads with `{ "$secret": "<scope>:<name>" }`, from standard input. A need may name `host:`, `team:<team>/` or `user:<id>/` |

See [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#the-vault) for the vault, and [COMPUTER.md](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#profiles) for who a need is read for.

## In your own host

The package's `apply` is the plugin entry. Hand it a plugin host from `@ahpd/sdk`, then fold what it registered into the host's options:

```ts
import { createHost, foldHostOptions, listen, pluginHost } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';
import { apply, name } from '@ahpd/computer';

const path = process.cwd();
const context = { path, paths: [path], version: '0.10.0', hostName: 'my-host', configDir: '/var/lib/my-host', log: console.log, say: console.log };
const { host: plugin, contribution, seal } = pluginHost(name, context);
await apply(plugin, { image: 'debian:bookworm-slim', max: 2 });
seal();

const { options } = foldHostOptions({ path, agents: [claude({ paths: [path] })] }, [contribution]);
const host = createHost(options);
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

## Agents in a machine

A machine made for an agent carries what the agent's `machine()` declares. Each agent's CLI comes from a part, an image this host builds at the version `images/versions.json` pins and mounts at `/opt/ahpd/<id>`, so any glibc image runs it with nothing installed. Each agent keeps its configuration in a state volume per provider, seeded from a few host files and never a login file; a profile with `state: "host"` mounts this host's own configuration instead. A value the vault fills for a need reaches only the agent whose need declared it, `computer_exec` from that agent's session included. See [COMPUTER.md](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#parts).

## The tools

| | |
| --- | --- |
| `request_disposable_computer` | Start one and answer its URI. `image`, `cpus`, `memory` and `name` may override what the host was configured with |
| `release_computer` | Stop it and remove it. Nothing on it survives |
| `computer_exec` | Run a command line inside it through `sh -lc`, and answer what it printed and its exit code |

Each declares its `effects`, so a backend with a policy can ask a person before one runs: making a machine writes and reaches the network, releasing is destructive, and running in one is both.

## What it serves

| | |
| --- | --- |
| `computer://` | Lists the machines this provider made |
| `computer://<id>` | One machine: a directory with two files in it |
| `computer://<id>/status` | The runtime's own record of it, as JSON |
| `computer://<id>/capabilities` | What this host can be asked for: the runtime, the actions, the default image, the limits and the maximum |

Nothing under `computer:` can be written. Machines are made with the tools above.

## Documentation

| | |
| --- | --- |
| [COMPUTER.md](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md) | Docker and KVM access, and `scripts/computer.mjs` for making a machine by hand |
| [CONTAINERS.md](https://github.com/softov/ahpd/blob/main/docs/CONTAINERS.md) | Running a whole host in a dev container |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Loading a plugin into the daemon |

## License

MIT © Softov
