---
title: Compose runs the image
status: todo
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

