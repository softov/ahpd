---
title: gVisor is a docker profile option, ociRuntime, and not a computer runtime
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/plugin.ts#L150-L154](../../packages/computer/src/plugin.ts#L150-L154) - the `runtime` option, which is `docker` today"
  - "[code://packages/computer/src/manifest.ts#L25-L63](../../packages/computer/src/manifest.ts#L25-L63) - `Profile`, the named machine settings an option joins"
  - "[code://packages/computer/src/runtime.ts#L600-L630](../../packages/computer/src/runtime.ts#L600-L630) - the `docker run` flags a machine is made with"
  - "[code://.project/decisions/one-computer-provider-with-runtimes-as-options.md](one-computer-provider-with-runtimes-as-options.md) - the runtime is an option of the one `computer:` provider"
---

## Context

The `computer:` provider's `runtime` option names what makes and runs machines: `docker` today, with `kvm` named for later.
gVisor sandboxes a container's system calls, and it is used by running a container under another OCI runtime: `docker run --runtime=runsc`.
Docker still makes, lists, inspects, execs and removes the machine; only the kernel boundary changes.

## Decision

gVisor is not a `runtime` value.
A profile gains `ociRuntime`, passed to `docker run` as `--runtime=<value>`, so `"ociRuntime": "runsc"` is a gVisor machine and any other OCI runtime Docker knows is named the same way.

Source: Softov, 2026-09-26, in the brief for the plugin gaps: "gVisor is not a runtime but a docker flag (`--runtime=runsc`, an `ociRuntime` profile option)."

## Consequences

A gVisor machine is listed, reached and removed exactly as any docker machine is, and `ComputerRuntime` does not change.
An operator picks the boundary per profile, so one host can offer a plain and a sandboxed machine side by side.
A Docker without that OCI runtime installed refuses the create, and the refusal is Docker's message.

## Options

- **`runtime: 'gvisor'`.** Rejected: every method of the runtime would be docker's, and a runtime value is for what makes machines, not for how a container's kernel is isolated.
- **A plugin-wide option.** Rejected: it forces every machine on the host under one boundary, where a profile lets an operator offer both.
