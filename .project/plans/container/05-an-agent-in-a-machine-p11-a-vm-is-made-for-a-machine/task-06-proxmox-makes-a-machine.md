---
title: Proxmox makes a machine the same way
status: todo
depends: [task-04-lifecycle-and-up-time.md, task-05-a-template-from-versions-json.md]
layer: "computer"
refs:
  - https://pve.proxmox.com/pve-docs/api-viewer/ - the API calls below
  - "[code://packages/computer/src/plugin.ts#L62](../../../../packages/computer/src/plugin.ts#L62) - a `writeOnly` option, the shape for the token secret"
---

## Objective

`proxmoxRuntime` does what the libvirt runtime does through the Proxmox API with Node's own `fetch`: a linked clone of the template, cloud-init with this host's key, the owner in its notes and the `ahpd` tag, the address from the guest agent, the lifecycle verbs, and a removal that purges its disk.

## Files

- `CREATE: packages/computer/src/proxmox.ts`.
- `UPDATE: packages/computer/src/plugin.ts:56-91` - `proxmox: { url, tokenId, secret (writeOnly), node, storage, bridge, ca? }` and the `runtime` value.
- `CREATE: packages/computer/test/computer-proxmox.test.ts` - against a fake API on a local port.

## Steps

1. `GET /cluster/nextid`, `POST /nodes/{node}/qemu/{template}/clone` with `full=0`, `PUT .../config` with `ciuser`, `sshkeys`, `ipconfig0=ip=dhcp`, `tags=ahpd`, `description` holding the records as JSON; `POST .../status/start`; wait for `agent/network-get-interfaces` and SSH.
2. The listing is `GET /cluster/resources?type=vm` filtered by the `ahpd` tag.
3. Removal stops, then `DELETE .../qemu/{vmid}?purge=1&destroy-unreferenced-disks=1`.
4. The secret is never logged and never in an error; it may be a vault reference once the vault resolves options.

## Validation

- `computer-proxmox.test.ts`: make, list, owner, suspend, resume, remove against the fake; a refused token says so without the token.
- By hand on the Proxmox node named then.

## Resume
