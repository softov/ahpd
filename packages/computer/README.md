# @ahpd/computer

A `computer:` resource provider for [ahpd](https://github.com/softov/ahpd): the machines a runtime has, reported read-only, and the three host tools that make one, use it and throw it away.

```bash
ahpd --plugin @ahpd/computer
```

Docker is the runtime that ships with it. A machine is a container the package
started, labelled `ahpd.computer=1`, kept alive with `sleep infinity`, and named
so that a `computer://<id>` URI reaches it.

## What it serves

| | |
| --- | --- |
| `computer://` | Lists the machines this provider made |
| `computer://<id>` | One machine: a directory with two files in it |
| `computer://<id>/status` | The runtime's own record of it, as JSON |
| `computer://<id>/capabilities` | What this host can be asked for: the runtime, the actions, the default image, the limits and the maximum |

Nothing under `computer:` is written. A resource write carries a URI and a mode,
and neither an image nor a limit goes in one; machines are made by a tool.

## The tools

| | |
| --- | --- |
| `request_disposable_computer` | Start one and answer its URI. `image`, `cpus`, `memory` and `name` may override what the host was configured with |
| `release_computer` | Stop it and remove it. Nothing on it survives |
| `computer_exec` | Run a command line inside it through `sh -lc`, and answer what it printed and what it exited with |

Each declares its `effects`, so a backend with a policy can ask a person before
one runs: making a machine writes and reaches the network, releasing is
destructive, and running in one is both.

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

```json
{
  "plugins": [
    {
      "name": "@ahpd/computer",
      "options": { "image": "debian:bookworm-slim", "cpus": "2", "memory": "2g", "max": 3 }
    }
  ]
}
```

## Before it can work

The account the daemon runs as has to reach Docker. One command, once, and a new
session:

```bash
sudo usermod -aG docker "$USER"
```

[docs/COMPUTER.md](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md)
has that, the same for `kvm`, and `scripts/computer.mjs`, which is the operator's
half: one machine, made by hand, for when no agent asked for one.
