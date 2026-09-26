---
title: A nested host's image installs its plugins with ahpd plugin install
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/plugins.ts#L169-L176](../../packages/server/src/plugins.ts#L169-L176) - a bare plugin name resolves from the configuration directory and nowhere else"
  - "[code://docs/COMPUTER.md#L146-L149](../../docs/COMPUTER.md#L146-L149) - the image example, which installs the plugin with `npm i -g`"
  - "[code://docs/CONTAINERS.md#L83](../../docs/CONTAINERS.md#L83) - the dev container launcher, which already uses `plugin install --no-enable`"
  - "[code://.project/ideas/an-image-that-carries-ahpd.md](../ideas/an-image-that-carries-ahpd.md) - where this goes next"
---

## Context

The nested host is started as `ahpd --stdio --plugin @ahpd/agent-cofold`, and a bare plugin name is resolved with `createRequire` from the configuration directory.
Node's global folders do not include npm's global `lib/node_modules`, so the documented `npm i -g @ahpd/server @ahpd/agent-cofold` leaves a plugin the inner host cannot find.

## Decision

For now, the image that runs a nested host installs ahpd with npm and each plugin with `ahpd plugin install --no-enable`, the way the dev container launcher does.
Source: Softov, 2026-09-26, asked "How the image gets ahpd: (a) an image built with `ahpd plugin install` in the Dockerfile, or (b) an install step through daemon/03, contrary to the locked 'no install step'?": "for now, a Dockerfile that runs `ahpd plugin install`".

## Consequences

The machine still has no install step at session start: the image carries the host and its plugins.
Until `@ahpd/agent-cofold` is published, the image installs it from a packed tarball or a path.
The ideal Softov named is an image made for this, into which only the code is shared: [an image that carries ahpd](../ideas/an-image-that-carries-ahpd.md).

## Options

- **An install step through `ahpd plugin install` when a session starts.** Works with any image, but pays an install per machine and contradicts the plan's locked "no install step".
