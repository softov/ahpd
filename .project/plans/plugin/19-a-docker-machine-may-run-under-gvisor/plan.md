---
title: A docker machine may run under gVisor
domain: plugin
status: planned
priority: low
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/plugin/10-a-computer-a-person-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/gvisor-is-a-docker-profile-option-not-a-runtime.md
  - decisions/a-machine-runtime-is-named-for-its-maker.md
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L106](../../../../packages/computer/src/manifest.ts#L34-L106) - `Profile`, which gains `ociRuntime`"
  - "[code://packages/computer/src/manifest.ts#L508-L745](../../../../packages/computer/src/manifest.ts#L508-L745) - `manifestOf`, where a profile's fields become a `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L67-L178](../../../../packages/computer/src/runtime.ts#L67-L178) - `MachineSpec`, which carries it to the runtime"
  - "[code://packages/computer/src/runtime.ts#L778-L830](../../../../packages/computer/src/runtime.ts#L778-L830) - the `docker run` flags, where `--runtime` is added"
  - "[code://packages/computer/src/manifest.ts#L323](../../../../packages/computer/src/manifest.ts#L323) - `allowedImages`: what a machine is made from is the operator's to name, not a body's"
  - "[code://packages/computer/test/computer.test.ts](../../../../packages/computer/test/computer.test.ts) - the docker runtime's tests over a fake `docker`"
  - "[code://docs/COMPUTER.md#L206-L263](../../../../docs/COMPUTER.md#L206-L263) - the Profiles section"
---

## Goal

An operator can give a profile a stronger boundary than a plain container by naming the OCI runtime Docker runs it under, `runsc` for gVisor.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "'--runtime'|ociRuntime" packages/computer` - nothing; no machine is made with an OCI runtime other than Docker's default.
- `rg -n "profile\\.(cpus|memory|image)" packages/computer/src/manifest.ts` - each profile field is read in `manifestOf` and put on the `MachineSpec`, which is the pattern this follows.

### Runtime path

```
profile { ociRuntime: 'runsc' } -> manifestOf -> MachineSpec.ociRuntime -> docker run --runtime=runsc ...
```

### Gaps

- `Profile` and `MachineSpec` have no OCI runtime.
- `Not found: any runtime but docker - searched "runtime" in packages/computer/src/plugin.ts`; `ssh`, `libvirt` and `proxmox` are container 05 p9 to p11, and the rest is an [idea](../../../ideas/more-computer-runtimes.md), not planned by Softov's choice.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [gVisor is a docker profile option, ociRuntime, and not a computer runtime](../../../decisions/gvisor-is-a-docker-profile-option-not-a-runtime.md) | Softov, 2026-09-26 |
| 2 | [One computer: provider, the runtime named for what makes the machine](../../../decisions/a-machine-runtime-is-named-for-its-maker.md) | Softov, 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| `ociRuntime` comes from the profile only, and a body that names it is refused | the boundary is the operator's, as the image list is ([`code://packages/computer/src/manifest.ts#L291`](../../../../packages/computer/src/manifest.ts#L291)) | 01 |
| Absent means no `--runtime` flag, so Docker's default runs | every existing profile is unchanged | 01 |
| `ociRuntime` is an option of a profile the docker runtime makes; a machine made from a `devcontainer.json` with a profile that names it is refused with a sentence, as a body naming both an image and a dev container is | decision 2: the Dev Container CLI makes that machine, not `docker run` | 01 |
| The flag is written as one argument, `--runtime=<value>` | (defaulted: one spelling in code, tests and docs) | 01 |
| The value is passed as given; Docker refuses one it does not have | decision 1, Consequences | 01 |

## Proposed architecture

- **Data flow** - profile field to `MachineSpec` to one `docker run` flag.
- **Event flow** - none.
- **State flow** - none; Docker records the runtime on the container.
- **Layer responsibilities** - `packages/computer/src/manifest.ts`: the field and the refusal · `packages/computer/src/runtime.ts`: the flag · `docs/COMPUTER.md`: the option.
- **Source-of-truth files** - [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A profile names the OCI runtime its machines run under](task-01-a-profile-names-the-oci-runtime.md) | todo | - |
| [02 - Docs](task-02-docs.md) | todo | 01 |

## Risks and tradeoffs

- gVisor does not support every system call, so an agent that needs one fails inside the machine - the operator chose it per profile, and a plain profile beside it is the way out.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-profile-names-the-oci-runtime.md](task-01-a-profile-names-the-oci-runtime.md).
- **Open questions:** none.
- **Watch out for:** a dev container machine is made by the Dev Container CLI, not by `docker run`; task 01 refuses `ociRuntime` there rather than passing it.

## Final verification checklist

- [ ] A profile with `"ociRuntime": "runsc"` makes a machine with `--runtime=runsc`, and one without it makes the same machine as today.
- [ ] A body naming `ociRuntime` is refused with a sentence, and so is a dev container machine from a profile that names it.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
