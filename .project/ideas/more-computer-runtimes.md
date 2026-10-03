---
title: More computer runtimes
created: 2026-09-26
---

Softov, 2026-09-26: "I dont want a new computer runtime for now... after as idea".
This is what is left of that idea once `ssh`, `libvirt`, `proxmox`, several runtimes on one host and code by clone were planned as container 05's p8 to p11.

## What is there

Decision [a-machine-runtime-is-named-for-its-maker](../decisions/a-machine-runtime-is-named-for-its-maker.md) keeps one package and names each runtime for what makes the machine.
gVisor is not part of this: it is a docker profile option, [plugin 19](../plans/plugin/19-a-docker-machine-may-run-under-gvisor/plan.md).

## Runtimes not planned

- Podman, a local runtime with an exec command and bind mounts; nearly docker's own CLI, so cheap.
- A hosted sandbox service; it would bring a vendor SDK, which is a dependency and Softov's call.
- Incus, FreeBSD jails and bhyve, each judged on whether it has a command whose stdio is a process inside the machine, which is what `ComputerPort.how()` needs.

## Working without a mount

Container 05 p8 clones a repository into a machine that cannot mount it, and refuses a folder that is not a repository.

- Copy a folder that is not a repository in at create with `MachineSpec.copies`.
- Sync the folder and the machine both ways, continuously.

The agent's own configuration, Claude's `~/.claude`, would be copied into someone else's machine, so it needs an explicit profile opt-in whichever is chosen.
