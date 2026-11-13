---
title: The ahpd part is the release's own build
created: 2026-11-13
refs:
  - git://1da0d0325 - the commit of ahpd the facts were checked at
  - git://1da0d0325 - the last commit that holds `problems/the-ahpd-part-does-not-follow-the-release.md`, which this brief and plan container/20261113-0507 replace
  - "[code://packages/computer/src/parts.ts#L469-L492](../../packages/computer/src/parts.ts#L469-L492) - `ahpdSourceOf`: the part from npm at its pinned version, or from a checkout's own packed packages when `AHPD_PART_AHPD_ROOT` names one"
  - "[code://packages/computer/src/parts.ts#L294-L304](../../packages/computer/src/parts.ts#L294-L304) - `tagOf` puts the source's hash in the ahpd part's tag"
  - "[code://packages/computer/src/hostinstall.ts#L163-L180](../../packages/computer/src/hostinstall.ts#L163-L180) - the install on an ssh box pins the part's version and writes its lock into the script"
  - "[code://.github/workflows/release.yml](../../.github/workflows/release.yml) - the parts job, which the release job waits for since #315"
  - "[code://packages/computer/images/versions.json#L22-L23](../../packages/computer/images/versions.json#L22-L23) - the ahpd part's pinned version"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L1-L5 - VS Code's build produces each agent SDK once per release, and every host downloads it at first use
---

# The ahpd part is the release's own build

Softov wants the ahpd in a machine, and the ahpd installed on an ssh box, to be the host's own version.
Plan container/20261113-0507 makes them the last release on npm, one release behind the host, for 0.15.0.
This brief is the step after it, for 0.16: the release builds the ahpd part from the packages it publishes.

## What others do

- VS Code's build produces each agent SDK once per release, and every host downloads it at first use, as the `refs` say.
- ahpd's other parts follow that model: the release's parts job builds each one, and a host pulls it by its digest since #315.

## What ahpd has today

- The ahpd part is pinned in [`code://packages/computer/images/versions.json`](../../packages/computer/images/versions.json), and installed from npm at that version from a committed lock.
- A release cannot pin its own version. npm serves it only after Softov approves the staged packages, which is after the tag run.
- `ahpdSourceOf` already builds the part from packed packages, for a checkout that `AHPD_PART_AHPD_ROOT` names. The part's tag then carries a hash of the tarballs.
- A host installed from npm computes the part's tag from the pinned version. It cannot compute the hash of tarballs it never saw.
- The install on an ssh box writes the part's lock into its script and installs from npm. No lock can exist for a version npm does not serve yet.

## Who writes

- Plan container/20261113-0507 changes `scripts/parts-bump.mjs` only. This change replaces its rule for the ahpd part.
- #315 added `digests.json`. The ahpd part's tag and digest would be read from the release's files beside it.
- MayCXC's fork has no work on the parts on 2026-11-13, as `.project/working/HANDOFF.md` says.

## The change

- The parts job builds the ahpd part from the tarballs that the tag packs, as the `AHPD_PART_AHPD_ROOT` path does.
- The release writes the part's tag beside its digest, in `@ahpd/computer`, so an installed host asks for that tag and pulls it by digest.
- The part's version is the host's own version. `versions.json` no longer pins it.
- The install on an ssh box gets the same packages from a source other than npm.

## Open points

- Where the box install gets the release's packages: the part image, the release's assets on GitHub, or another place.
- Whether `pnpm pack` gives the same bytes in the parts job and in the release job, so the part holds what npm serves.
