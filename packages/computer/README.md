# @ahpd/computer

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fcomputer)](https://www.npmjs.com/package/@ahpd/computer)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Disposable machines for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A client or an agent makes a `computer`, runs commands and sessions inside it, and destroys it.

Docker is the runtime it ships with. A machine is a container this package started, labelled `ahpd.computer=1`, kept alive with `sleep infinity`, and reached as `computer://<id>`.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/computer`](https://github.com/softov/ahpd/tree/main/packages/computer).

## Install

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

## Options

| Option | |
| --- | --- |
| `runtime` | Which runtime to use. `docker`, the only one today |
| `command` | The program to run. `docker` |
| `args` | Arguments before its own, for a wrapper or a context |
| `env` | Environment variables merged over the daemon's |
| `image` | The image a machine is made from when a call names none. `debian:bookworm-slim` |
| `cpus` | A CPU limit for every machine this host makes |
| `memory` | A memory limit for every machine this host makes |
| `max` | How many may exist at once. `3` |
| `label` | The label every machine carries. `ahpd.computer=1` |
| `devcontainer` | The Dev Container CLI, as the program that makes a container from a folder and nothing else. `false` switches every dev container route off, and `folders` is the list of absolute folders one may be made from |

```json
{
  "plugins": [
    "@ahpd/agent-claude",
    {
      "name": "@ahpd/computer",
      "options": { "image": "debian:bookworm-slim", "cpus": "2", "memory": "2g", "max": 3 }
    }
  ]
}
```

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
