---
title: Part images are pulled from ghcr by a tag, with no digest and no signature
status: open
date: 2026-11-08
severity: major
blocks: []
refs:
  - "[code://packages/computer/src/parts.ts#L986](../../packages/computer/src/parts.ts#L986) - `pullImage` from `<registry>/<tag>`"
  - "[code://packages/computer/src/runtime.ts#L3530-L3539](../../packages/computer/src/runtime.ts#L3530-L3539) - `docker pull`, then `docker tag`"
  - "[code://scripts/parts-publish.mjs](../../scripts/parts-publish.mjs) - what CI pushes to the registry"
  - git://89e0ffbdd - a host pulls the part image in place of a build
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A host that needs an agent CLI part pulls `ghcr.io/<owner>/ahpd-part/<id>:<tag>`.
It runs each launcher once with `--version`, and checks nothing about where the image came from.

## Cause

At `e388d12f5` each host built the part from its Dockerfile, which checked every download by sha256.
Main moves the build and the checks to CI, and the host trusts the registry.
The tag is a hash of the Dockerfile, but a registry tag can be pushed again with other content.
`versions.json` holds no image digest, and nothing checks a signature or provenance.

## Impact

Anyone who can push to the package can replace an agent CLI image: a repository writer through `workflow_dispatch`, or a leaked package token.
Every host then runs that image in machines that hold agent credentials.

## Workaround

Build the parts locally, if main keeps that path.

## Fix

Choices asked on 2026-11-08. A plan builds them after Softov validates this file.

| Decision | Options | Chosen |
| --- | --- | --- |
| How a host checks a pulled image | Pin the digest; the digest and a setting for another registry; build locally by default | Pin the digest (Softov, 2026-11-08) |

A part's tag is its pinned version and a hash of its Dockerfile (`tagOf`), and both ship in `@ahpd/computer`.
So a new part image already needs a new `@ahpd/computer`, and the pin does not change how a part is updated.

The chosen fix:

- The publish job writes each image's `sha256` digest into `versions.json`.
- A host pulls `<image>@sha256:<digest>` and refuses an image whose digest differs.
- The parts job runs before the npm publish in `release.yml`, so the package carries the digests.
- A checkout's own `ahpd` part is still built locally, with no digest.
