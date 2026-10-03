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
- `CREATE: packages/computer/src/keys.ts` - `machineKey(configDir, keygen = runKeygen)`: makes `computer-ssh/id_ed25519` with `ssh-keygen` the first time, answers both halves' paths; `keygen` is injectable, so a test hands in a fixture and needs no `ssh-keygen`; and `forgetHost(configDir, address)`, which runs `ssh-keygen -R <address> -f <known_hosts>`.
- `CREATE: packages/computer/test/fixtures/ssh-keygen.mjs` - a fake that writes a fixed key pair where it is told.

## Steps

1. `-J <jump>` when a jump is given; `-o StrictHostKeyChecking=accept-new` with a known-hosts file of its own beside the key, so a VM's new host key does not touch the person's.
2. p9's ssh machines keep their behaviour.
3. When a VM is removed, its address is removed from that known-hosts file with `forgetHost`, so a later VM that DHCP gives the same address is not refused for a changed host key.

## Validation

- `computer-ssh.test.ts`: a reach with a jump puts `-J` and the known-hosts option in the argv; the key is made once, through the fixture keygen.
- Removing a VM runs `forgetHost` for its address, and a second VM at that address is reached.

## Resume
