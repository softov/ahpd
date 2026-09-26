---
title: More computer runtimes
created: 2026-09-26
---

Softov, 2026-09-26: "I dont want a new computer runtime for now... after as idea".
This is that idea, kept until a plan starts from it.

## What is there

`@ahpd/computer` refuses every `runtime` but `docker` ([`code://packages/computer/src/plugin.ts#L150-L154`](../../packages/computer/src/plugin.ts#L150-L154)).
Only `dockerRuntime` implements `ComputerRuntime` ([`code://packages/computer/src/runtime.ts#L167-L185`](../../packages/computer/src/runtime.ts#L167-L185)).
Everything below the seam assumes the machine shares the host's filesystem: the session folder, the agent's configuration and every need arrive as bind mounts.
Decision [one-computer-provider-with-runtimes-as-options](../decisions/one-computer-provider-with-runtimes-as-options.md) keeps one package and makes the runtime an option.
gVisor is not part of this: it is a docker profile option, [plugin 19](../plans/plugin/19-a-docker-machine-may-run-under-gvisor/plan.md).

## A second runtime

- A local one with an exec command and bind mounts, podman first because it is nearly docker's own CLI; cheap, and it proves the seam holds a second runtime.
- `ssh`, a machine that is a host listed in the options; it covers any Linux or BSD box and is the first runtime without a mount.
- A hosted sandbox service; it proves the copy-in path, and it brings a vendor SDK, which is a dependency and Softov's call.
- Also possible: incus, FreeBSD jails, bhyve and KVM, each judged on whether it has a command whose stdio is a process inside the machine, which is what `ComputerPort.how()` needs.

The order suggested when this was written: podman, then ssh.

## Working without a mount, and syncing

A machine that is not on this host cannot mount the session folder.

- Copy the folder in at create with `MachineSpec.copies`, and push the result back as a branch through the host's worktree and pull request ports.
- Clone the repository and branch inside the machine, and push from there.
- Sync the folder and the machine both ways, continuously.

The suggestion: clone, and copy in for a folder that is not a repository.
The agent's own configuration, Claude's `~/.claude`, would be copied into someone else's machine, so it needs an explicit profile opt-in whichever is chosen.

## Several runtimes on one host

The decision already allows a machine asked for per call, routed by the id the provider minted, and `manifestOf` refuses it today ([`code://packages/computer/src/manifest.ts#L406-L412`](../../packages/computer/src/manifest.ts#L406-L412)).
The suggestion: several, each machine's id recording the runtime that made it, once a second runtime lands.
