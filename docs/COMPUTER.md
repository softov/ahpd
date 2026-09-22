# A disposable computer

The machine a `computer:` resource would be about: one container, started when
somebody asks for one and thrown away after.
Nothing in `@ahpd/*` starts it - this is the operator's half, and the script here
is what a provider would eventually drive.
On this machine Docker is available and `/dev/kvm` exists but is not readable by
an ordinary account, so the first section is the once-per-machine part.

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

## The script

`scripts/computer.mjs` owns one container by name and labels it
`ahpd.computer=1`, so `list` shows only what it made.

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

A computer is a container kept alive with `sleep infinity`, so it waits for work
rather than exiting with the command that started it.
`--kvm` refuses before starting anything when the device is not readable, and
prints the two commands above rather than failing inside the container later.

`--mount` is handed to docker as it is written, so a repository can be given to
the computer:

```sh
node scripts/computer.mjs start --mount type=bind,src=/github/ahpd,dst=/work
```

## What this is not

- **It is not the `computer:` provider.** Plan
  [`plugin/08`](../.project/plans/plugin/08-resource-providers/plan.md) built the
  scheme and a read-only fixture; a provider that starts one of these, and the
  master it would ask, is not written.
- **It is not a sandbox.** The container is separate from the host's files, not
  from the network, and a bind mount is the host's files by definition.
- **It is not durable.** `rm` is the point, and nothing here survives it.
