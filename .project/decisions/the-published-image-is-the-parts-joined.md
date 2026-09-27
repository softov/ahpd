---
title: The image ahpd publishes is its parts joined, and there is no other base
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L99](../../packages/computer/src/manifest.ts#L34-L99) - `Profile`, whose `image` defaults to the host's"
  - "[code://.project/ideas/an-image-that-carries-ahpd.md](../ideas/an-image-that-carries-ahpd.md) - the image made for this purpose that Softov asked for"
  - "[code://.project/decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md](a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) - how the ahpd part installs its plugins"
---

## Context

Once agent CLIs and ahpd are parts mounted into any base, a machine does not need an image of ours.
Some runtimes cannot mount a part at all: a remote Docker daemon that has never seen the part, a hosted sandbox, a VM guest.
They need one image that already holds everything.

## Decision

ahpd publishes one image, `ahpd-agents`, which is a minimal glibc system with git and ripgrep plus every part copied in at the same `/opt/ahpd/<part>` path it is mounted at elsewhere.
It is built from the same versions file as the parts, it is the default image of a profile that names none, and it is the image for any runtime that cannot mount parts.
Source: Softov, 2026-09-26, asked "Our base image, or none?", answered "our own base image will be junction of parts".

## Consequences

A part lives at one path whether it was mounted or baked in, so a command or a preset never asks which.
The joined image is rebuilt when any part moves, so its tag is a hash of the versions file and ahpd's version.
A machine made from a repo's own image still gets parts mounted, and never needs this image.

## Options

- **No image of ours.** Document `node:22-bookworm-slim` plus git as the base, and leave runtimes without mounts to build their own.
- **A base image separate from the parts.** Two things to version where one covers both.
