---
title: A part image per kind
status: todo
depends: [task-01-the-versions-file.md]
layer: "computer"
refs:
  - "[code://.project/decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) - how the ahpd part gets its plugins"
  - "[code://packages/server/src/install.ts#L429](../../../../packages/server/src/install.ts#L429) - `ahpd plugin install` runs `npm install --prefix <configDir>`"
  - "[code://packages/server/src/config.ts#L218-L222](../../../../packages/server/src/config.ts#L218-L222) - `configDir`, `$XDG_CONFIG_HOME/ahpd`, which is not inside `/opt/ahpd/ahpd`"
  - "[code://packages/server/src/plugins.ts#L169-L200](../../../../packages/server/src/plugins.ts#L169-L200) - `resolvePlugin`, which resolves a bare name from the config dir only"
---

## Objective

`dockerfileOf(entry)` answers the Dockerfile text for each kind, and the image it builds holds only `/opt/ahpd/<id>`.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `dockerfileOf`, and `ahpdSourceOf()`, which answers `{ from: 'workspace', tarballs }` when the package runs from a checkout and `{ from: 'npm', version }` otherwise; it is the one place the choice is made.
- `UPDATE: packages/server/src/plugins.ts:169-200` - `resolvePlugin` also resolves a bare name from `$AHPD_PLUGIN_ROOT/node_modules` when that variable is set, after the config dir.
- `UPDATE: packages/server/src/install.ts:429` - `ahpd plugin install` installs into `$AHPD_PLUGIN_ROOT` instead of the config dir when the variable is set.
- `UPDATE: packages/server/test/` - the resolve and install cases for `AHPD_PLUGIN_ROOT`, in the files that test `resolvePlugin` and `plugin install` today.
- `UPDATE: packages/computer/test/computer-parts.test.ts` - one case per kind.

## Steps

1. Every kind is a two-stage build: a `debian:bookworm-slim` stage that fetches, and a `FROM scratch` stage that copies `/opt/ahpd/<id>` alone, so the image is the part and nothing else.
2. `node`: the Node binary and its `lib` from the official tarball of the pinned version, checked by sha256.
3. `npm`: `npm install --prefix /opt/ahpd/<id> --ignore-scripts <packages>@<version>` with the `node` part's Node, then launchers in `bin/` that run with `/opt/ahpd/node/bin/node` and set the entry's `updates` env.
4. `archive`: download, check sha256, unpack into `/opt/ahpd/<id>`.
5. `ahpd`: from an installed package, `@ahpd/server` at the version from npm; from a checkout, `pnpm pack` of `@ahpd/server`, its workspace dependencies and the listed plugins, put in the build context and installed from those tarballs, so a checkout tests its own code. Then `AHPD_PLUGIN_ROOT=/opt/ahpd/ahpd/plugins ahpd plugin install --no-enable` for each entry in its `plugins`, from its tarball in a checkout, so the plugins land inside `/opt/ahpd/ahpd` and are copied with the part; `ahpd plugin install` alone would install into `$XDG_CONFIG_HOME/ahpd`, which the `FROM scratch` stage does not copy.
6. The part's launcher `bin/ahpd` sets `AHPD_PLUGIN_ROOT=/opt/ahpd/ahpd/plugins` before it runs ahpd, so the inner ahpd resolves the installed plugins from there; its config directory stays `$XDG_CONFIG_HOME/ahpd`, writable by the machine's user.
7. The part's tag is `tagOf` from task 01, which carries the source hash, so a code change in a checkout builds a new part.

## Validation

- Each kind's text contains its version, its checksum where it has one, and `FROM scratch` last.
- The `ahpd` kind from a checkout installs from `.tgz` files in the context and names no registry; from an installed package it names `@ahpd/server@<version>`.
- `computer-parts.test.ts`: the `ahpd` kind's text sets `AHPD_PLUGIN_ROOT=/opt/ahpd/ahpd/plugins` for the install and in the launcher, and copies nothing from `$XDG_CONFIG_HOME`.
- `packages/server/test/`: with `AHPD_PLUGIN_ROOT` set, a bare plugin name installed only there resolves, and `plugin install` runs npm with `--prefix` set to it.
- By hand, once: a real build of `codex` and `node`, and `docker run --mount type=image` of both into `debian:bookworm-slim` answers `codex-acp --help`.

## Resume
