---
title: A VM template is built from versions.json and rebuilt when it moves
status: todo
depends: [task-03-libvirt-makes-a-machine.md]
layer: "computer"
refs:
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md](../05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md) - `versions.json`, `hashOf` and `ahpd-agents:<hash>`"
---

## Objective

The libvirt runtime makes `ahpd-template-<hash>` the first time a VM is asked for at a hash it has no template for, with every part at `/opt/ahpd`, and a later VM backs onto it.

## Files

- `CREATE: packages/computer/src/template.ts` - `ensureTemplate(runtime, hash)`, the one place a template is made, so the way it gets the parts can change.
- `UPDATE: packages/computer/src/libvirt.ts` - `run` asks for the template first.

## Steps

1. Boot the cloud image once with cloud-init (this host's key, nothing else), copy `/opt/ahpd` out of `ahpd-agents:<hash>` with `docker create` and `docker cp`, copy it into the VM over ssh, shut the VM down, and keep its disk as `ahpd-template-<hash>`; the helper VM is removed whether this succeeds or not.
2. Two creates at once build the template once; the second waits.
3. A template a VM still backs onto is never removed; an old one is listed in the log, not deleted.

## Validation

- With the fakes, a first create builds a template and a second does not; a changed hash builds a second.
- By hand: a VM from the template runs `/opt/ahpd/ahpd/bin/ahpd --version` at this host's version.

## Resume
