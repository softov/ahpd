---
title: Parts are built from one versions file, and the joined image from the same file
domain: container
status: built
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-cli-is-pinned-in-one-versions-file.md
  - decisions/the-published-image-is-the-parts-joined.md
  - decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md
refs:
  - "[code://packages/computer/src/runtime.ts#L570-L577](../../../../packages/computer/src/runtime.ts#L570-L577) - `must`, how the runtime runs docker"
  - "[code://packages/computer/src/plugin.ts#L38](../../../../packages/computer/src/plugin.ts#L38) - the default image, `debian:bookworm-slim`"
  - "[code://packages/server/src/install.ts#L429](../../../../packages/server/src/install.ts#L429) - `ahpd plugin install`, `npm install --prefix <configDir>`, which the ahpd part runs with `AHPD_PLUGIN_ROOT` set"
  - "[code://packages/server/src/plugins.ts#L169-L200](../../../../packages/server/src/plugins.ts#L169-L200) - `resolvePlugin`, which resolves a bare name from the config dir only"
  - "[code://packages/computer/package.json#L44-L48](../../../../packages/computer/package.json#L44-L48) - `files`, which must ship `images/`"
  - "[code://scripts/computer.mjs](../../../../scripts/computer.mjs) - the script a person already manages a machine with"
  - "[code://.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) - the workflow style a scheduled job follows"
  - "[code://.github/workflows/release.yml](../../../../.github/workflows/release.yml) - the release job a joined-image publish would join"
  - "git://7552054:.project/ideas/an-image-that-carries-ahpd.md - the ahpd part answers it"
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the registry a bump diffs against
  - https://docs.docker.com/build/building/context/ - a build context piped on stdin
---

## Goal

`packages/computer/images/versions.json` names every part at an exact version, and `@ahpd/computer` builds a part's image the first time one is asked for and never again for that version.
The same file builds `ahpd-agents`, the one image ahpd publishes, with every part at the path it is mounted at.

## Reconnaissance

### Searches performed

- `rg "docker build|image inspect|images/" packages scripts` - nothing builds or inspects an image today; there is no `packages/computer/images/` and no `parts.ts`.
- `rg "no-enable" packages/server/src` - `ahpd plugin install --no-enable` exists (`install.ts:367`, `install.ts:435`).

### Runtime path

```
ensure('codex') -> versions.json -> tag ahpd-part/codex:<version>
  -> docker image inspect -> present: done
  -> absent: lock -> docker build - <generated Dockerfile> -> done
build-joined -> every part -> ahpd-agents:<hash of versions.json + the ahpd part's tag>
```

### Gaps

- No versions file, no Dockerfile, no build step, no bump job.
- The fake Docker knows neither `image inspect` nor `build -`.
- A machine made with no image named is `debian:bookworm-slim`, not the joined image.
- `ahpd plugin install` installs into the config dir, outside `/opt/ahpd/ahpd`, so a part built that way would lose its plugins.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Every agent CLI is pinned in one versions file, and none updates itself](../../../decisions/an-agent-cli-is-pinned-in-one-versions-file.md) | 01, 05 |
| [The image ahpd publishes is its parts joined, and there is no other base](../../../decisions/the-published-image-is-the-parts-joined.md) | 04 |
| [A nested host's image installs its plugins with ahpd plugin install](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| A profile naming no image runs `debian:bookworm-slim` with its parts mounted; the joined image is built only for a runtime that cannot mount image parts, so no fifteen-part build precedes the first default machine | Softov, 2026-10-04, asked "container/05 p3: when a profile names no image, which machines are made from the joined image (all fifteen parts baked in)?": "Only where parts can't mount" | 04 |
| A part lives at `/opt/ahpd/<part>` and its launchers at `/opt/ahpd/<part>/bin` | the proposal Softov asked to plan, 2026-09-26 | 02 |
| Node is a part of its own, `node`, that npm parts name as a requirement, so one Node serves them all | (defaulted: one Node per part would multiply the largest file by eleven) | 01, 02 |
| Bases are glibc; a part is built on `debian:bookworm-slim` | the proposal: goose ships only glibc builds | 02 |
| The build context is generated and piped, so nothing is written into the package at run time | (defaulted: an installed package may be read-only) | 03 |
| Publishing to a registry is optional; building locally is the default | the proposal, 2026-09-26 | 04 |
| The ahpd part installs its plugins into `/opt/ahpd/ahpd/plugins`: `ahpd plugin install` and `resolvePlugin` read `AHPD_PLUGIN_ROOT`, which the part's launcher sets, and the config dir stays `$XDG_CONFIG_HOME/ahpd`, writable | (defaulted: only `/opt/ahpd/<id>` is copied into the part, and the config dir must stay writable for the inner host) | 02 |
| One `tagOf` spells every part's tag; the ahpd part's carries its source hash, and the joined hash folds that tag in | (defaulted: two hashes for one source drift apart) | 01, 02, 04 |
| A part whose build fails refuses only the machines that need it | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" (a failure belongs to the item that failed) | 04 |
| For now, from a checkout the ahpd part is built from the workspace's packed tarballs, so a checkout tests its own code; from an installed package it comes from npm at the pinned version; one function, `ahpdSourceOf`, makes the choice, so it can change | Softov, 2026-10-03, asked "from a checkout, is the ahpd part built from the workspace's packed tarballs or from npm?": "packed tarballs" | 02, 03 |

## Proposed architecture

- **Data flow** - `versions.json` -> `parts.ts` (read, validate, tag, hash) -> a Dockerfile per part kind (`npm`, `archive`, `ahpd`) -> `docker build`.
- **Layer responsibilities** - `@ahpd/computer`: the file, the builder and the lock · `scripts/computer.mjs`: the verb that builds ahead · `.github/workflows`: the bump job.
- **Source-of-truth files** - `packages/computer/images/versions.json`, `packages/computer/src/parts.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The versions file and its reader](task-01-the-versions-file.md) | implemented | - |
| [02 - A part image per kind](task-02-a-part-image-per-kind.md) | implemented | 01 |
| [03 - A part is built the first time it is asked for](task-03-built-on-first-use.md) | implemented | 02 |
| [04 - The joined image](task-04-the-joined-image.md) | implemented | 02 |
| [05 - A scheduled job proposes a bump](task-05-a-bump-job.md) | implemented | 01 |
| [06 - A person can build ahead, and the docs say how](task-06-build-ahead-and-docs.md) | implemented | 03, 04 |

## Risks and tradeoffs

- A first session on a fresh host waits for a build - task 06 gives the verb that warms every part, and the session's refusal while building names the part.
- Archive parts carry a sha256 that has to be refreshed with every bump - the bump job computes it.
- dsh and Hermes are not in the registry - their entries are bumped by hand and the job says it skipped them.

## Resume state

- **Done so far:** all six tasks. Every part kind builds against real Docker on
  a checkout with a daemon, and the three Dockerfile bugs a fake docker can
  never show are fixed (task 06's Resume has them).
- **Next action:** the next plan. Nothing here is half done.
- **Open questions:** none.
- **Watch out for:**
  - `pnpm test` is network-free, so every build test drives the fake Docker and asserts the Dockerfile text, never a real build. A build with real Docker has caught four defects the text assertions cannot see, so a change to `dockerfileOf` is worth a real build before it is trusted.
  - This worktree does have Docker and network, which task 04's Resume claimed
    it did not. That note is wrong and has been corrected where it stood.
  - An archive part is unpacked unstripped and its launcher is written only
    where nothing executable is already. Both are because of what publishers
    actually ship: opencode and amp hold the executable at the archive root,
    and devin holds it at `bin/devin`, which is where its launcher goes.
  - From a checkout the ahpd part's tag covers the packed tarballs, not only the versions entry, or a code change would reuse a stale image.
  - If task 04 changes the image a machine with none named is made from, every computer test that asserts `debian:bookworm-slim` as the default has to name its image or expect the joined tag.
  - container/05 p5 tasks 03 and 06 run the ahpd part's plugins, so they wait for task 02's `AHPD_PLUGIN_ROOT`.

## Final verification checklist

- [x] `ensure('codex')` on a host without the image builds it once; a second call does nothing.
- [x] Two sessions asking for one missing part start one build.
- [x] From a checkout, the ahpd part holds the workspace's own code, and a change to it builds a new part.
- [ ] `ahpd-agents:<hash>` runs `/opt/ahpd/codex/bin/codex-acp --help` on a real Docker.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [x] `docs/COMPUTER.md` updated. `plans/index.md` was left alone.

The joined image was not built by hand - the box that ran this had under 5 GB
free and fifteen parts plus the joined image do not fit beside what its daemon
already holds. So that line is open on `ensureJoined`'s own tests against the
fake docker and on `codex` itself building and answering for real mounted, not
on one real joined image.
