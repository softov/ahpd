---
title: Proxmox makes a machine the same way
status: todo
depends: [task-04-lifecycle-and-up-time.md, task-05-a-template-from-versions-json.md]
layer: "computer"
refs:
  - https://pve.proxmox.com/pve-docs/api-viewer/ - the API calls below
  - "[code://packages/computer/src/plugin.ts#L61](../../../../packages/computer/src/plugin.ts#L61) - `needValue`, `secretAtUse`, the shape for the token secret"
---

## Objective

`proxmoxRuntime` does what the libvirt runtime does through the Proxmox API with `node:https` requests, which take the `ca` option a self-signed Proxmox needs (Node's `fetch` cannot without undici, which is not a dependency): a linked clone of the template, cloud-init with this host's key, the owner in its notes and the `ahpd` tag, the address from the guest agent, the lifecycle verbs, and a removal that purges its disk.

## Files

- `CREATE: packages/computer/src/proxmox.ts`.
- `UPDATE: packages/computer/src/plugin.ts:70-108` - `proxmox: { url, tokenId, secret, node, storage, bridge, ca? }` and the `runtime` value; `secret` is `secretAtUse: true` and `writeOnly`, and `ca` is a path to a PEM file read when the runtime is built.
- `CREATE: packages/computer/test/computer-proxmox.test.ts` - against a fake API on a local port.

## Steps

1. `GET /cluster/nextid`, `POST /nodes/{node}/qemu/{template}/clone` with `full=0`, `PUT .../config` with `ciuser`, `sshkeys`, `ipconfig0=ip=dhcp`, `tags=ahpd`, `description` holding the records as JSON; `POST .../status/start`; wait for `agent/network-get-interfaces` and SSH.
2. The listing is `GET /cluster/resources?type=vm` filtered by the `ahpd` tag.
3. Removal stops, then `DELETE .../qemu/{vmid}?purge=1&destroy-unreferenced-disks=1`.
4. The secret is never logged and never in an error. It is a `$secret` reference read with `host.secret` when a call needs it, not at load; a secret that cannot be read fails only the Proxmox runtime's calls (its listing is reported as not answering, a create on a Proxmox profile is refused naming the secret), and the plugin and every other runtime work.
5. Every call goes through one `request(method, path, body)` on `node:https` with `ca` when set; no `fetch`, no undici.

## Validation

- `computer-proxmox.test.ts`: make, list, owner, suspend, resume, remove against the fake, served over TLS with a self-signed certificate and `ca` pointed at it; a refused token says so without the token.
- The same file: with the secret absent from the fake vault, the plugin loads, a docker machine is made, the Proxmox listing is reported as not answering, and a Proxmox create is refused naming the secret.
- By hand on the Proxmox node named then.

## Resume
