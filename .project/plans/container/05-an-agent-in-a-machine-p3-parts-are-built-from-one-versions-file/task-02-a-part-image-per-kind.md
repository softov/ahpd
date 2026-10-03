---
title: A part image per kind
status: todo
depends: [task-01-the-versions-file.md]
layer: "computer"
refs:
  - "[code://.project/decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) - how the ahpd part gets its plugins"
---

## Objective

`dockerfileOf(entry)` answers the Dockerfile text for each kind, and the image it builds holds only `/opt/ahpd/<id>`.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `dockerfileOf`, and `ahpdSourceOf()`, which answers `{ from: 'workspace', tarballs }` when the package runs from a checkout and `{ from: 'npm', version }` otherwise; it is the one place the choice is made.
- `UPDATE: packages/computer/test/computer-parts.test.ts` - one case per kind.

## Steps

1. Every kind is a two-stage build: a `debian:bookworm-slim` stage that fetches, and a `FROM scratch` stage that copies `/opt/ahpd/<id>` alone, so the image is the part and nothing else.
2. `node`: the Node binary and its `lib` from the official tarball of the pinned version, checked by sha256.
3. `npm`: `npm install --prefix /opt/ahpd/<id> --ignore-scripts <packages>@<version>` with the `node` part's Node, then launchers in `bin/` that run with `/opt/ahpd/node/bin/node` and set the entry's `updates` env.
4. `archive`: download, check sha256, unpack into `/opt/ahpd/<id>`.
5. `ahpd`: from an installed package, `@ahpd/server` at the version from npm; from a checkout, `pnpm pack` of `@ahpd/server`, its workspace dependencies and the listed plugins, put in the build context and installed from those tarballs, so a checkout tests its own code. Then `ahpd plugin install --no-enable` for each entry in its `plugins`, from its tarball in a checkout.
6. From a checkout, the part's tag hash covers the tarballs' contents as well as the versions entry, so a code change builds a new part.

## Validation

- Each kind's text contains its version, its checksum where it has one, and `FROM scratch` last.
- The `ahpd` kind from a checkout installs from `.tgz` files in the context and names no registry; from an installed package it names `@ahpd/server@<version>`.
- By hand, once: a real build of `codex` and `node`, and `docker run --mount type=image` of both into `debian:bookworm-slim` answers `codex-acp --help`.

## Resume
