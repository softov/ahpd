---
title: The entrypoint seeds plugins and runs ahpd
status: implemented
depends: [task-01-the-image-builds-from-the-checkout.md]
layer: "image"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L27-L28](../../../../packages/server/src/commands/plugin.ts#L27-L28) - a plugin change with no daemon only says to restart"
  - "[code://packages/server/src/commands/plugin.ts#L290-L310](../../../../packages/server/src/commands/plugin.ts#L290-L310) - `ahpd plugin update all`"
  - "[code://packages/server/src/install.ts#L502-L516](../../../../packages/server/src/install.ts#L502-L516) - the plugin root in the config folder"
---

## Objective

`docker/entrypoint.sh` installs the missing plugins of `AHPD_PLUGINS`, updates the plugins when the image version changes, and execs `ahpd`.
An image older than the volume's `image-version` does not start, unless `AHPD_ALLOW_DOWNGRADE=1` is set.

## Files

- `CREATE: docker/entrypoint.sh` - POSIX `sh`: the command switch, the plugins, the version step, and `exec ahpd`.
- `UPDATE: Dockerfile` - copy `docker/entrypoint.sh` to `/opt/ahpd/entrypoint.sh`, mode 0755, owned by root.

## Steps

1. Exec `ahpd "$@"` when the first argument is not `run`.
2. Read the image version from `ahpd --version`, and the volume's from `/home/ahpd/.config/ahpd/image-version`.
3. Exit 1 with one line when the image is older than the volume and `AHPD_ALLOW_DOWNGRADE` is not `1`.
4. Use `@ahpd/web` when `AHPD_PLUGINS` is unset, and no plugin when `AHPD_PLUGINS` is empty.
5. Run `ahpd plugin install <name>` for each plugin in `AHPD_PLUGINS` that `ahpd plugin list --json` does not list.
6. Run `ahpd plugin update all` when the two versions differ, then write the image version to `image-version`.
7. Exec `ahpd "$@"`, so `ahpd` replaces the shell under `tini`.
8. Stop at the first failed step with `set -eu`, and print which step failed.

## Validation

- A fresh volume: the container starts, `@ahpd/web` is in the plugin root, and `image-version` holds the image version.
- A second start on the same volume installs nothing and runs no update.
- `AHPD_PLUGINS=""`: the container starts with no plugin.
- An `image-version` above the image's: the container exits 1 with the downgrade line, and starts with `AHPD_ALLOW_DOWNGRADE=1`.
- `docker run --rm ahpd:dev --version` prints the version and runs no plugin step.
- `shellcheck docker/entrypoint.sh` passes.

## Resume

- **Done so far:** `docker/entrypoint.sh` is POSIX `sh` with `set -eu`. A first argument that is not `run` is `exec ahpd "$@"`, so `docker run <image> --version` reads as ahpd and touches no volume. A start reads `ahpd --version` and `~/.config/ahpd/image-version`, refuses an older image on a newer volume with one line unless `AHPD_ALLOW_DOWNGRADE=1`, and takes `@ahpd/web` when `AHPD_PLUGINS` is unset and none when it is empty. It splits the list on commas and spaces, asks `ahpd plugin list --json` for the names the configuration holds, and installs each missing one with `ahpd plugin install`. When the two versions differ it runs `ahpd plugin update all` and writes `image-version` atomically. It ends with `exec ahpd "$@"`. Every step sets `STEP` and its own failure prints that name. The `Dockerfile` copies the script to `/opt/ahpd/entrypoint.sh` at mode 0755, owned by root, with `COPY --chmod`.
- **Next action:** review the Docker checks below.
- **Open questions:** none.
- **Watch out for:** the checks that start a container are left for review, because Docker is denied in this mode: a fresh volume, a second start on it, `AHPD_PLUGINS=""`, a volume above the image, and `docker run --rm ahpd:dev --version`. `shellcheck` is not installed on this box, so it was not run either; the one deliberate word split carries `# shellcheck disable=SC2086`. The rule the plan leaves open is the separator inside `AHPD_PLUGINS`: this task takes commas or spaces, because Compose gives one string. The first start of a fresh volume runs `ahpd plugin update all` once, because there is no `image-version` to match, which is the expected answer and installs nothing.

Files changed by this task: `docker/entrypoint.sh`, `Dockerfile`.

