---
title: A part is mounted from its own image, and a volume filled from that image is the fallback
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/runtime.ts#L625-L650](../../packages/computer/src/runtime.ts#L625-L650) - the docker flags a machine is made with, where the mount is added"
  - "[code://packages/agent-claude/src/claude.ts#L397-L406](../../packages/agent-claude/src/claude.ts#L397-L406) - the host's `claude` binary mounted read-only, which a part replaces"
  - https://docs.docker.com/engine/storage/volumes/ - named volumes, the fallback
---

## Context

An agent's CLI reaches a machine today by mounting the host's own binary, which only works for Claude and breaks when the machine's libc or architecture differs from the host's.
A part is an agent CLI, or ahpd itself, built once into an image of its own under `/opt/ahpd/<part>`, and it has to reach machines made from any base image.
Docker 29 mounts one image inside another container read-only with `--mount type=image,source=<image>,image-subpath=<path>,target=<path>,readonly`, and marks it experimental.
On this workstation (Docker 29.6.2, 2026-09-26) Node 22 from `node:22` ran inside `debian:bookworm-slim` that way, and the run took 1.12 s against 0.94 s for the same container with no mount.

## Decision

A part reaches a machine as an image mount.
Where the runtime refuses an image mount, the part is copied once into a named volume, `ahpd-part-<part>-<version>`, and that volume is mounted read-only instead.
Source: Softov, 2026-09-26, asked "Image mounts are experimental in Docker 29. Build on them with the volume fallback, or start with volumes only and switch later?": "image mount.. volume as fallback."

## Consequences

Nothing is installed in a machine at session start, and one built part serves every machine on the host.
The runtime has to find out once whether it can mount an image, and the fallback volume is filled the first time a part is asked for on a host that cannot.
A part is read-only inside the machine, so an agent that writes next to its own binary has to be pointed elsewhere by its configuration.
A part and the base it is mounted into must share a libc family, unless the part is a static binary.

## Options

- **Volumes only.** Works on every Docker and on the Dev Container CLI's `--mount`, and costs a copy per part version that an image mount does not.
- **Parts installed into each base image by a build.** One image per base and part set, which is the combinatorial growth parts exist to avoid.
