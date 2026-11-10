---
title: Compose runs the image
status: implemented
depends: [task-02-the-entrypoint-seeds-plugins.md]
layer: "image"
refs:
  - "[code://packages/server/src/config.ts#L1027](../../../../packages/server/src/config.ts#L1027) - `AHPD_CONFIG`, which a read-only mounted file can use"
  - https://docs.docker.com/reference/compose-file/services/ - `restart`, `stop_grace_period`, `user` and `ports`
---

## Objective

`docker/compose.yaml` runs the published image with one named volume, `./work` and a loopback port.
It works alone, so a person can fetch it from `raw.githubusercontent.com` at a tag and run it.
`docker/compose.dev.yaml` builds the same service from the checkout.

## Files

- `CREATE: docker/compose.yaml` - one `ahpd` service on `ghcr.io/<owner>/ahpd:${AHPD_TAG}`, the volume `ahpd-home`, `./work:/work`, port `127.0.0.1:9187:9187`.
- `CREATE: docker/compose.dev.yaml` - the same service with `build: { context: .., dockerfile: Dockerfile }` and the image `ahpd:dev`.

## Steps

1. Write `compose.yaml` with `restart: unless-stopped` and `stop_grace_period: 40s`.
2. Set the default `AHPD_TAG` to `X.Y` of `packages/server/package.json`, or to the full version for a pre-release.
3. Set `AHPD_PLUGINS` to `@ahpd/web`, with a comment that names how to add an agent plugin.
4. Add a commented `user:` line, with one line on when to set it.
5. Keep `compose.yaml` free of any path to another file in the repository.
6. Put the raw URL and the `mkdir work` line in a comment at the top of `compose.yaml`.
7. Write `compose.dev.yaml` from `compose.yaml`, with a build in place of the image.
8. Keep the Docker socket out of both files.

## Validation

- `docker compose -f docker/compose.dev.yaml config` passes.
- `docker compose -f docker/compose.dev.yaml up -d --build` gets healthy.
- `docker compose -f docker/compose.dev.yaml exec ahpd cat /home/ahpd/.config/ahpd/connection-token` prints the token, and a client connects with it.
- `docker compose -f docker/compose.dev.yaml restart` keeps the token and `config.json`.
- `compose.yaml` copied alone into an empty folder passes `docker compose config`.

## Resume

- **Done so far:** `docker/compose.yaml` runs `ghcr.io/softov/ahpd:${AHPD_TAG:-0.15.0-rc.1}` - the full version, because `0.15.0-rc.1` is a pre-release - with `restart: unless-stopped`, `stop_grace_period: 40s`, `127.0.0.1:9187:9187`, the volume `ahpd-home` at `/home/ahpd` and `./work` at `/work`. `AHPD_PLUGINS` is `@ahpd/web`, with a comment naming `@ahpd/agent-claude` as the second name. A commented `user:` line gives the chown-free case. The top comment carries the raw URL at the version's tag and `mkdir work`. `docker/compose.dev.yaml` is the same service with `build: { context: .., dockerfile: Dockerfile }` and `image: ahpd:dev`. Neither file names another file in the repository, and neither mounts the Docker socket.
- **Next action:** review the Compose checks below.
- **Open questions:** none.
- **Watch out for:** every check that needs Docker is left for review, because Docker is denied in this mode: `docker compose config`, the dev stack getting healthy, the token read with `exec`, the restart keeping the token and `config.json`, and `compose.yaml` alone in an empty folder. Both files parse as YAML with `yaml@2.9.0` from the store, which is all this box can check. A relative bind source resolves beside the compose file, so the dev file serves `docker/work` and its comment says so. `./work` is created by `mkdir` and not by Docker, because Docker would make a missing one owned by root, which uid 1000 cannot write.

Files changed by this task: `docker/compose.yaml`, `docker/compose.dev.yaml`.

