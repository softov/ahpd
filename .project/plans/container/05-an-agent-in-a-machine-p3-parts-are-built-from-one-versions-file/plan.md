---
title: Parts are built from one versions file, and the joined image from the same file
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-cli-is-pinned-in-one-versions-file.md
  - decisions/the-published-image-is-the-parts-joined.md
  - decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md
refs:
  - "[code://packages/computer/src/runtime.ts#L484](../../../../packages/computer/src/runtime.ts#L484) - `must`, how the runtime runs docker"
  - "[code://packages/computer/package.json](../../../../packages/computer/package.json) - `files`, which must ship `images/`"
  - "[code://scripts/computer.mjs](../../../../scripts/computer.mjs) - the script a person already manages a machine with"
  - "[code://.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) - the workflow style a scheduled job follows"
  - "git://7552054:.project/ideas/an-image-that-carries-ahpd.md - the ahpd part answers it"
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the registry a bump diffs against
  - https://docs.docker.com/build/building/context/ - a build context piped on stdin
---

## Goal

`packages/computer/images/versions.json` names every part at an exact version, and `@ahpd/computer` builds a part's image the first time one is asked for and never again for that version.
The same file builds `ahpd-agents`, the one image ahpd publishes, with every part at the path it is mounted at.

## Reconnaissance

### Searches performed

- `rg "docker build|images/" packages scripts` - nothing builds an image today.

### Runtime path

```
ensure('codex') -> versions.json -> tag ahpd-part/codex:<version>
  -> docker image inspect -> present: done
  -> absent: lock -> docker build - <generated Dockerfile> -> done
build-joined -> every part -> ahpd-agents:<hash of versions.json + ahpd version>
```

### Gaps

- No versions file, no Dockerfile, no build step, no bump job.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Every agent CLI is pinned in one versions file, and none updates itself](../../../decisions/an-agent-cli-is-pinned-in-one-versions-file.md) | 01, 05 |
| [The image ahpd publishes is its parts joined, and there is no other base](../../../decisions/the-published-image-is-the-parts-joined.md) | 04 |
| [A nested host's image installs its plugins with ahpd plugin install](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| A part lives at `/opt/ahpd/<part>` and its launchers at `/opt/ahpd/<part>/bin` | the proposal Softov asked to plan, 2026-09-26 | 02 |
| Node is a part of its own, `node`, that npm parts name as a requirement, so one Node serves them all | (defaulted: one Node per part would multiply the largest file by eleven) | 01, 02 |
| Bases are glibc; a part is built on `debian:bookworm-slim` | the proposal: goose ships only glibc builds | 02 |
| The build context is generated and piped, so nothing is written into the package at run time | (defaulted: an installed package may be read-only) | 03 |
| Publishing to a registry is optional; building locally is the default | the proposal, 2026-09-26 | 04 |

## Proposed architecture

- **Data flow** - `versions.json` -> `parts.ts` (read, validate, tag, hash) -> a Dockerfile per part kind (`npm`, `archive`, `ahpd`) -> `docker build`.
- **Layer responsibilities** - `@ahpd/computer`: the file, the builder and the lock · `scripts/computer.mjs`: the verb that builds ahead · `.github/workflows`: the bump job.
- **Source-of-truth files** - `packages/computer/images/versions.json`, `packages/computer/src/parts.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The versions file and its reader](task-01-the-versions-file.md) | todo | - |
| [02 - A part image per kind](task-02-a-part-image-per-kind.md) | todo | 01 |
| [03 - A part is built the first time it is asked for](task-03-built-on-first-use.md) | todo | 02 |
| [04 - The joined image](task-04-the-joined-image.md) | todo | 02 |
| [05 - A scheduled job proposes a bump](task-05-a-bump-job.md) | todo | 01 |
| [06 - A person can build ahead, and the docs say how](task-06-build-ahead-and-docs.md) | todo | 03, 04 |

## Risks and tradeoffs

- A first session on a fresh host waits for a build - task 06 gives the verb that warms every part, and the session's refusal while building names the part.
- Archive parts carry a sha256 that has to be refreshed with every bump - the bump job computes it.
- dsh and Hermes are not in the registry - their entries are bumped by hand and the job says it skipped them.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-versions-file.md](task-01-the-versions-file.md).
- **Open questions:**
  1. From a checkout, is the ahpd part built from the workspace's packed tarballs or from npm? - proposed: packed tarballs, so a checkout tests its own code.
- **Watch out for:** `pnpm test` is network-free, so every build test drives the fake Docker and asserts the Dockerfile text, never a real build.

## Final verification checklist

- [ ] `ensure('codex')` on a host without the image builds it once; a second call does nothing.
- [ ] Two sessions asking for one missing part start one build.
- [ ] `ahpd-agents:<hash>` runs `/opt/ahpd/codex/bin/codex-acp --help` on a real Docker.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
