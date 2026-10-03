---
title: "One computer: provider, the runtime named for what makes the machine"
status: accepted
date: 2026-10-02
supersedes: decisions/one-computer-provider-with-runtimes-as-options.md
refs:
  - "[code://packages/computer/src/plugin.ts#L56-L91](../../packages/computer/src/plugin.ts#L56-L91) - `optionsSchema`, whose `runtime` enum is `['docker']`"
  - "[code://packages/computer/src/manifest.ts#L430-L433](../../packages/computer/src/manifest.ts#L430-L433) - a body whose runtime differs is refused"
---

## Context

The superseded decision kept one package, `@ahpd/computer`, with the runtime as an option, and named `kvm` as the later value.
KVM is the CPU feature both Proxmox and libvirt use, not what makes a machine: each has its own API, its own options and its own verbs, and a Proxmox LXC container is not KVM at all.

## Decision

The provider stays one package, and `computer://<id>` names a machine whatever made it; the provider routes by the id it minted.
The runtime value names what makes the machine: `docker`, `ssh`, `libvirt`, `proxmox`, each with its own options.
Source: Softov, 2026-10-02, asked "How is a hypervisor named in a computer profile?": "One runtime per maker".

## Consequences

A profile says `runtime: 'libvirt'` rather than `runtime: 'kvm'` with a hypervisor option, and each runtime's options are validated on their own.
A machine id records which runtime made it, so several runtimes can serve one host.

## Options

- `runtime: 'kvm'` with `hypervisor: 'proxmox' | 'libvirt'`: one value for two APIs, and wrong for Proxmox LXC.
