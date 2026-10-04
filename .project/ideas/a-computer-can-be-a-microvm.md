---
title: A computer can be a microVM
created: 2026-10-04
---

A microVM gives a computer its own kernel behind a hardware boundary, booting in about a hundred milliseconds rather than a full VM's seconds.
It sits between today's Docker containers and the full VMs of [container/05 p11](../plans/container/05-an-agent-in-a-machine-p11-a-vm-is-made-for-a-machine/plan.md).
Source: Softov, 2026-10-04: "Kata is good. short modifications... but microsandbox is a interesting one".
Background: Docker's [Why MicroVMs: the architecture behind Docker Sandboxes](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/).

## Two ways in

- **Kata Containers as a Docker runtime** (https://github.com/kata-containers/kata-containers).
  A profile names the OCI runtime, `ociRuntime: "kata"`, the way [plugin/19](../plans/plugin/19-a-docker-machine-may-run-under-gvisor/plan.md) names `runsc`, under the decision [gvisor-is-a-docker-profile-option-not-a-runtime](../decisions/gvisor-is-a-docker-profile-option-not-a-runtime.md).
  `docker run`, `docker exec -i`, the session folder at the same path, parts and dev containers stay as they are, so ahpd changes nothing beyond plugin/19.
  The cost is on the host: the `kata-static` tarball, the `vhost_vsock` and `vhost_net` modules, a `runtimes` entry in `/etc/docker/daemon.json` and a Docker restart.
- **microsandbox as a runtime of its own** (https://github.com/superradcompany/microsandbox).
  It makes an OCI image into a libkrun microVM and has a CLI verb for each `ComputerRuntime` operation, with `msb exec --stream` as `how()`.
  It would be a fourth maker beside `docker`, `ssh` and the VM makers, under the decision [a-machine-runtime-is-named-for-its-maker](../decisions/a-machine-runtime-is-named-for-its-maker.md), and a second local `ComputerRuntime` about the size of Docker's.
  What it gives that Kata cannot: snapshot and fork of a running machine, no root setup beyond `/dev/kvm`, macOS and Windows hosts, and placeholder secrets that reach only an allowed host, which overlaps the credential proxy of [container/05 p12](../plans/container/05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/plan.md).
  What it costs: it is beta, on its own libkrun fork, installed from a script, and an external binary, which is a dependency and Softov's call.

## Where it would wire in

- A case that needs a stronger boundary than a container, such as an untrusted repository or an agent allowed to run Docker itself, takes Kata first: a profile option and nothing else.
- A case that needs to snapshot or fork a machine (try two approaches from one state, or keep a warm machine to fork per session), or a microVM on a laptop, is the reason to take microsandbox.
- Parts ([container/05 p4](../plans/container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md)) mount through Docker under Kata; under microsandbox an image is not a mount, so a part would be a copy or a volume.

## Questions it must answer first

- Kata: whether a long `docker exec -i` stream, an image mount, the session folder's ownership and inotify, and git and npm over virtio-fs behave as under runc, and its start time and memory per idle machine, measured on this workstation (it has `/dev/kvm` and nested virtualisation).
- microsandbox: the same list, plus `msb snap` and `msb fork` times, and whether it runs on Debian 13.
