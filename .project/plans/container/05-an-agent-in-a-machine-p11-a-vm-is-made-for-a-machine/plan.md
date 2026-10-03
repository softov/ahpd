---
title: A virtual machine is made for a computer, by libvirt and then by Proxmox
domain: container
status: planned
priority: medium
created: 2026-10-02
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md
  - plans/container/05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/plan.md
  - plans/container/05-an-agent-in-a-machine-p8-a-profile-on-another-docker/plan.md
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
  - plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md
changes: []
creates: []
decisions:
  - decisions/a-machine-runtime-is-named-for-its-maker.md
  - decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md
  - decisions/a-secret-is-named-in-a-host-team-or-user-scope.md
refs:
  - "[code://packages/computer/src/runtime.ts#L194-L212](../../../../packages/computer/src/runtime.ts#L194-L212) - `ComputerRuntime`, which each maker implements"
  - "[code://packages/computer/src/runtime.ts#L389-L423](../../../../packages/computer/src/runtime.ts#L389-L423) - the records a docker machine keeps as labels, which a VM keeps in its own metadata"
  - "[code://packages/computer/src/plugin.ts#L410-L454](../../../../packages/computer/src/plugin.ts#L410-L454) - `made`, which meters up time around every start, stop and removal"
  - "[code://packages/computer/src/plugin.ts#L56-L91](../../../../packages/computer/src/plugin.ts#L56-L91) - `optionsSchema`; a credential is `writeOnly` (daemon/11)"
  - "[code://packages/computer/src/provider.ts#L156](../../../../packages/computer/src/provider.ts#L156) - `STATES`, the states a `state` write may ask for"
  - "[code://packages/computer/src/provider.ts#L278-L288](../../../../packages/computer/src/provider.ts#L278-L288) - the `state` leaf"
  - https://libvirt.org/formatdomain.html#general-metadata - `<metadata>` in a domain, under a namespace of ours
  - https://libvirt.org/manpages/virsh.html - `vol-create-as --backing-vol`, `domifaddr`, `metadata`, `start`, `shutdown`, `suspend`, `resume`, `undefine --remove-all-storage`
  - https://pve.proxmox.com/pve-docs/api-viewer/ - `qemu/{vmid}/clone` with `full=0`, `config` for cloud-init, `status/*`, tags and `description`
---

## Goal

A computer profile may say `runtime: "libvirt"` or `runtime: "proxmox"`, and a machine made from it is a virtual machine: a linked clone of a template, given this host's SSH key by cloud-init, waited for until SSH answers, then reached exactly as p9's ssh machine is, and destroyed with its disk when it goes.
The template is built from p3's `versions.json`, tagged with its hash, and rebuilt when the file moves.
Each VM records its owner in its own metadata, and its up time is metered like a container's.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "libvirt|proxmox|virsh" packages` - nothing.
- `ssh softov@dev86.brbyte.com` (Softov, 2026-10-02) - Debian 13, `/dev/kvm`, 6 cores, 11 GB, Docker, no libvirt, no Proxmox.

### Runtime path

```
disposable:<profile runtime libvirt> -> libvirt runtime:
  template ahpd-template-<hash> (built once from versions.json)
  -> virsh vol-create-as --backing-vol (linked clone) -> virt-install --cloud-init (this host's key) --import
  -> metadata: owner, team, project, profile, agents -> wait for ssh -> id libvirt.<name>
session -> port.remote(id) -> nested over ssh (p9's reach, jumping through the libvirt host) -> the VM's ahpd
remove -> virsh destroy + undefine --remove-all-storage -> stretch written to the owner
```

### Gaps

- No runtime makes a virtual machine.
- No template carries the parts.
- The `state` leaf knows `running`, `stopped` and `restarted`, not `suspended`.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [One computer: provider, the runtime named for what makes the machine](../../../decisions/a-machine-runtime-is-named-for-its-maker.md) | 03, 06 |
| [A machine is owned by whoever created it, and its owner pays for the time it is up](../../../decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md) | 03, 04 |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | 02 |
| [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | 06 |
| [A secret is named in the host's, a team's or a person's scope](../../../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md) | 06 |

| What | Source | Task |
| --- | --- | --- |
| The runtime values are `libvirt` and `proxmox` | Softov, 2026-10-02, asked "How is a hypervisor named in a computer profile?": "One runtime per maker" | 03, 06 |
| libvirt first, on dev86; Proxmox second, on a Proxmox node named when tested | Softov, 2026-10-02, asked "Which VM maker comes first?": "libvirt first on dev86" | 01, 03, 06 |
| A made VM is reached as p9's ssh machine | the VM is a box with ahpd on it, which is what p9 reaches | 02 |
| A VM records its owner in its own metadata: libvirt `<metadata>`, Proxmox tags and notes | decision `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`, "The owner is stored with the machine" | 03, 06 |
| Up time is metered by the plugin's wrapper, as for a container | usage/03 | 04 |
| The template is built from `versions.json`, tagged with its hash, and rebuilt when the hash moves | p3's `hashOf` | 05 |
| Start, stop, suspend and resume are offered where the runtime declares them | the `capabilities` resource is where a client learns what a runtime does | 04 |
| The Proxmox API token is a plugin option, `writeOnly`; it may be a vault reference once the vault is built | daemon/11; Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | 06 |
| Code reaches a VM by clone, as on another Docker | Softov, 2026-10-02, asked "How does a session's code reach a machine on another box?": "clone everywhere.. but leave open for future case with virtiofs on local libvirt" | 03 |
| For now a template copies `/opt/ahpd` out of `ahpd-agents:<hash>` (`docker create` and `docker cp`) into a cloud image booted once with cloud-init, over ssh, shuts it down and keeps its disk as `ahpd-template-<hash>`; Proxmox converts the same VM to a template; `ensureTemplate` is the one place this is done | Softov, 2026-10-03, asked "how does a template get the parts?": "as proposed" | 05, 06 |
| For now a suspended VM is not up: its stretch closes at suspend and a new one opens at resume, in the one wrapper `made` uses | Softov, 2026-10-03, asked "does `suspend` keep the up-time stretch open?": "as proposed" | 04 |
| For now `virsh` runs as `virsh -c qemu+ssh://softov@dev86.brbyte.com/system` from this host, the URI a libvirt option, so the runtime is a command like Docker and nothing of ahpd runs on dev86 but inside the VMs | Softov, 2026-10-03, asked "how is `virsh` run against dev86?": "as proposed" | 01, 03 |
| For now a VM's id is `libvirt.<name>` (and `proxmox.<name>`), through p9 task 01's `spellMachineId` and `parseMachineId` | Softov, 2026-10-03, answered in p9: "put runtime.name" | 03, 06 |

## Proposed architecture

- **Data flow** - `options.libvirt = { uri, pool, network, template?, jump?, user? }` and `options.proxmox = { url, tokenId, secret (writeOnly), node, storage, bridge, template? }`; a profile names `runtime`, `cpus`, `memory`.
- **Code** - p8's `code` option, `bundle` by default, with the copy done by `scp` instead of `docker cp`.
- **Reach** - a VM is an ssh destination (`ahpd@<address>`), found by `virsh domifaddr` or the Proxmox guest agent, behind a jump through the libvirt host where its network is private; p9's ssh reach answers `how` and `nested`.
- **Key** - one key pair this host makes in its configuration directory for the VMs it makes; its public half goes in by cloud-init.
- **Layer responsibilities** - `@ahpd/computer` only: `libvirt.ts`, `proxmox.ts`, `template.ts`.
- **Source-of-truth files** - `CREATE: packages/computer/src/libvirt.ts`, `CREATE: packages/computer/src/proxmox.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - dev86 runs libvirt and qemu](task-01-dev86-runs-libvirt.md) | todo | - |
| [02 - A machine with an address is reached by ssh, with this host's own key](task-02-an-address-is-reached-by-ssh.md) | todo | - |
| [03 - libvirt makes a machine from a template, and destroys it](task-03-libvirt-makes-a-machine.md) | todo | 01, 02 |
| [04 - A VM starts, stops, suspends and resumes, and its up time is metered](task-04-lifecycle-and-up-time.md) | todo | 03 |
| [05 - A template is built from versions.json](task-05-a-template-from-versions-json.md) | todo | 03 |
| [06 - Proxmox makes a machine the same way](task-06-proxmox-makes-a-machine.md) | todo | 04, 05 |
| [07 - Docs](task-07-docs.md) | todo | 06 |

## Risks and tradeoffs

- A VM takes tens of seconds to boot - a disposable profile on a VM runtime says so in its description, and the wait for SSH is bounded with the console's last lines in the failure.
- A linked clone depends on its template - a template is never removed while a VM backs onto it; a new hash makes a new template beside the old one.
- Proxmox answers TLS with a self-signed certificate - the option takes a CA file; Node's `fetch` cannot pin a fingerprint without a dependency, which is Softov's call.
- The VM's private network is not reachable from this host - the ssh reach jumps through the libvirt host, which is the same account `virsh` already uses.

## Resume state

- **Done so far:** nothing; drafted 2026-10-02, planned 2026-10-03.
- **Next action:** [task-01-dev86-runs-libvirt.md](task-01-dev86-runs-libvirt.md), once Softov has installed libvirt on dev86; the code waits for p9 and p12.
- **Open questions:** none.
- **Watch out for:** dev86 has `/dev/kvm` and Docker but no libvirt installed yet; installing libvirt there (task 01 step 1) is Softov's step, before task 01's validation and before any by-hand check here; p3's `hashOf` is the tag, so a template built before p3 lands has no name; a libvirt on this host could share the folder by virtiofs instead of a clone, which is left open, see [deferred.md](deferred.md).

## Final verification checklist

- [ ] A disposable session on a libvirt profile makes a VM on dev86, answers a turn run by the VM's ahpd, and the VM is gone a delay after the session.
- [ ] The VM's owner is in its metadata, and its up time is written to that owner.
- [ ] Suspend and resume from the `state` leaf work on libvirt.
- [ ] The same on a Proxmox node.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
