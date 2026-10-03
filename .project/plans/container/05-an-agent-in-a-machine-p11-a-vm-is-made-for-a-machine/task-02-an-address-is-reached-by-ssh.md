---
title: A machine with an address is reached by ssh, with this host's own key
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/owners.ts](../../../../packages/computer/src/owners.ts) - a file this plugin keeps in `host.configDir`, the place for the key"
---

## Objective

p9's ssh reach is a function of a destination, a jump and a key, so a VM runtime answers `how`, `nested`, `exec` and `stats` through it, and this host has one key pair for the VMs it makes.

## Files

- `UPDATE: packages/computer/src/ssh.ts` - `sshReach({ destination, port?, identity?, jump?, workdir?, host? })` taken out of `sshRuntime`.
- `CREATE: packages/computer/src/keys.ts` - `machineKey(configDir)`: makes `computer-ssh/id_ed25519` with `ssh-keygen` the first time, answers both halves' paths.

## Steps

1. `-J <jump>` when a jump is given; `-o StrictHostKeyChecking=accept-new` with a known-hosts file of its own beside the key, so a VM's new host key does not touch the person's.
2. p9's ssh machines keep their behaviour.

## Validation

- `computer-ssh.test.ts`: a reach with a jump puts `-J` and the known-hosts option in the argv; the key is made once.

## Resume
