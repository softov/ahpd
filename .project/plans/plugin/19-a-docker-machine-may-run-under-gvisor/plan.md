---
title: A docker machine may run under gVisor
domain: plugin
status: planned
priority: low
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/10-a-computer-a-person-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/gvisor-is-a-docker-profile-option-not-a-runtime.md
  - decisions/one-computer-provider-with-runtimes-as-options.md
refs:
  - "[code://packages/computer/src/manifest.ts#L25-L63](../../../../packages/computer/src/manifest.ts#L25-L63) - `Profile`, which gains `ociRuntime`"
  - "[code://packages/computer/src/manifest.ts#L406-L610](../../../../packages/computer/src/manifest.ts#L406-L610) - `manifestOf`, where a profile's fields become a `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L56-L150](../../../../packages/computer/src/runtime.ts#L56-L150) - `MachineSpec`, which carries it to the runtime"
  - "[code://packages/computer/src/runtime.ts#L600-L630](../../../../packages/computer/src/runtime.ts#L600-L630) - the `docker run` flags, where `--runtime` is added"
  - "[code://packages/computer/src/manifest.ts#L291](../../../../packages/computer/src/manifest.ts#L291) - `allowedImages`: what a machine is made from is the operator's to name, not a body's"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - the docker runtime's tests over a fake `docker`"
  - "[code://docs/COMPUTER.md#L189-L225](../../../../docs/COMPUTER.md#L189-L225) - the Profiles section"
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
- `Not found: any runtime but docker - searched "runtime" in packages/computer/src/plugin.ts`; every other runtime is an [idea](../../../ideas/more-computer-runtimes.md), not planned by Softov's choice.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [gVisor is a docker profile option, ociRuntime, and not a computer runtime](../../../decisions/gvisor-is-a-docker-profile-option-not-a-runtime.md) | Softov, 2026-09-26 |
| 2 | [One computer: provider, one package, the runtime chosen by option](../../../decisions/one-computer-provider-with-runtimes-as-options.md) | Softov, 2026-09-22 |

| What | Source | Task |
| --- | --- | --- |
| `ociRuntime` comes from the profile only, and a body that names it is refused | the boundary is the operator's, as the image list is ([`code://packages/computer/src/manifest.ts#L291`](../../../../packages/computer/src/manifest.ts#L291)) | 01 |
| Absent means no `--runtime` flag, so Docker's default runs | every existing profile is unchanged | 01 |
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
- **Watch out for:** a dev container machine is made by the Dev Container CLI, not by `docker run`; this plan leaves it alone.

## Final verification checklist

- [ ] A profile with `"ociRuntime": "runsc"` makes a machine with `--runtime=runsc`, and one without it makes the same machine as today.
- [ ] A body naming `ociRuntime` is refused with a sentence.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
