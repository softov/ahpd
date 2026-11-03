---
title: Make a Proxmox VM on a real node
plans:
  - plans/container/20261030-1141-a-vm-is-made-on-a-server/plan.md
---

# Make a Proxmox VM on a real node

Task 06 of the VM plan. The Proxmox runtime passes its tests against a fake API, and has not met a real node yet.
The check needs a Proxmox VE node that this workstation reaches on port 8006.
This workstation must also reach the node's VM network, directly or through a box in `ssh.machines`.

## Steps

1. Name the node, its storage for VM disks, and its bridge, for example `pve`, `local-lvm` and `vmbr0`.
2. On the node, make the template `ahpd-template` from the Debian 13 cloud image, with `qemu-guest-agent` and a cloud-init drive. Put your storage and bridge in place of `local-lvm` and `vmbr0`:

```bash
apt install -y libguestfs-tools
wget https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2
virt-customize -a debian-13-genericcloud-amd64.qcow2 --install qemu-guest-agent
qm create 9000 --name ahpd-template --memory 2048 --net0 virtio,bridge=vmbr0 --agent enabled=1
qm importdisk 9000 debian-13-genericcloud-amd64.qcow2 local-lvm
qm set 9000 --scsihw virtio-scsi-pci --scsi0 local-lvm:vm-9000-disk-0 --ide2 local-lvm:cloudinit --boot order=scsi0 --serial0 socket --vga serial0
qm template 9000
```

3. On the node, make the user, its rights and its token, and keep the secret it prints. Put your storage and bridge zone in place of `local-lvm` and `localnetwork`:

```bash
pveum user add ahpd@pve
pveum aclmod / -user ahpd@pve -role PVEVMAdmin
pveum aclmod /storage/local-lvm -user ahpd@pve -role PVEDatastoreUser
pveum aclmod /sdn/zones/localnetwork -user ahpd@pve -role PVESDNUser
pveum user token add ahpd@pve ahpd --privsep 0
```

4. On this workstation, put the secret in the test daemon's vault. It reads the secret from standard input:

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude computer
ahpd vault set host:proxmox
```

5. If the node's certificate is its own, copy it here:

```bash
scp root@<node>:/etc/pve/pve-root-ca.pem ~/ahpd-check/pve-root-ca.pem
```

## Reply

Write the node's address, its storage, its bridge, and the path of the CA file. Write nothing of the secret.
I then make a VM from a profile with `runtime: "proxmox"` and run a turn in it.
Then I suspend, resume and remove it, and check that its disk is gone.
