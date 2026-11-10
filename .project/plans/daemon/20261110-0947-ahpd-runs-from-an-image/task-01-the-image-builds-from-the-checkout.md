---
title: The image builds from the checkout
status: implemented
depends: []
layer: "image"
refs:
  - "[code://.github/workflows/release.yml#L93-L99](../../../../.github/workflows/release.yml#L93-L99) - the pack command the `pack` stage runs"
  - "[code://packages/server/src/selfupdate.ts#L193-L200](../../../../packages/server/src/selfupdate.ts#L193-L200) - when npm takes `--allow-scripts=node-pty`"
  - "[code://packages/server/src/pty.ts#L192-L208](../../../../packages/server/src/pty.ts#L192-L208) - node-pty, which the install stage builds"
  - "[code://packages/server/src/commands/status.ts#L28-L36](../../../../packages/server/src/commands/status.ts#L28-L36) - the health check command"
---

## Objective

`docker build .` makes an image that holds `@ahpd/server` in `/opt/ahpd` and runs as user `ahpd`.
node-pty is built in the image, so a terminal is a pseudoterminal.

## Files

- `CREATE: .dockerignore` - `**/node_modules`, `**/dist`, `*.jsonl`, `*.tsbuildinfo`, `.project`, `docs`, `.git`.
- `CREATE: Dockerfile` - the `pack`, `install` and `runtime` stages, with the build args `NODE_IMAGE` and `AHPD_UID`.

## Steps

1. Write `.dockerignore` with the list in *Files*.
2. Write the `pack` stage on `NODE_IMAGE`: enable corepack, run `pnpm install --frozen-lockfile`, `pnpm build`, and the pack command of `release.yml`.
3. Write the `install` stage: add `python3 make g++`, then run `npm install -g --prefix /opt/ahpd` on the server tarball and its sibling tarballs.
4. Pass `--allow-scripts=node-pty` in the install stage only when npm is 11.16 or later.
5. Write the `runtime` stage on `NODE_IMAGE`: add `git bash ca-certificates openssh-client tini procps`, and copy `/opt/ahpd`.
6. Rename the base image's `node` user to `ahpd`, with uid `AHPD_UID` and home `/home/ahpd`.
7. Set `PATH` to hold `/opt/ahpd/bin` and `/home/ahpd/.npm-global/bin`, and `NPM_CONFIG_PREFIX` to `/home/ahpd/.npm-global`.
8. Set `AHPD_SERVICE=container`, `VOLUME /home/ahpd`, `WORKDIR /work`, `EXPOSE 9187` and `USER ahpd`.
9. Set `HEALTHCHECK CMD ahpd status --json`.
10. Set the labels `org.opencontainers.image.version`, `.revision` and `.source` from build args.
11. Set `ENTRYPOINT ["tini", "--", "/opt/ahpd/entrypoint.sh"]` and the default command from the plan's *Answers*.

## Validation

- `docker build -t ahpd:dev .` passes on `linux/amd64`.
- `docker run --rm ahpd:dev --version` prints the version of `packages/server/package.json`, once task 02 adds the entrypoint.
- `docker run --rm --entrypoint id ahpd:dev` prints uid 1000 and user `ahpd`.
- `docker run --rm --entrypoint sh ahpd:dev -c 'test -w /opt/ahpd'` fails, because `/opt/ahpd` belongs to root.
- The build context sent to Docker holds no `*.jsonl` file.

## Resume

- **Done so far:** `Dockerfile` has the three stages. `pack` runs `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm -r exec pnpm pack --pack-destination /out`, the pack command of `release.yml`. `install` adds `python3 make g++`, reads `npm --version`, passes `--allow-scripts=node-pty` only from npm 11.16 as `selfupdate.ts` does, and runs `npm install -g --prefix /opt/ahpd` on the `@ahpd/server` and `@ahpd/sdk` tarballs. `runtime` renames the base image's `node` user and group to `ahpd`, moves the home to `/home/ahpd`, sets uid `AHPD_UID`, adds the five packages, copies `/opt/ahpd`, and sets `PATH`, `NPM_CONFIG_PREFIX`, `AHPD_SERVICE=container`, `VOLUME`, `WORKDIR /work`, `EXPOSE 9187`, `USER ahpd`, the health check, the three OCI labels and the default command. `.dockerignore` holds the seven patterns.
- **Next action:** review the Docker checks below, which Docker refused to run in this session.
- **Open questions:** none.
- **Watch out for:** the checks that start a container are left for review, because Docker is denied in this mode: `docker build -t ahpd:dev .`, the `id` and `sh -c 'test -w /opt/ahpd'` runs, and the `--version` run, which needs task 02's entrypoint as its own note says. The build context of this worktree holds no `*.jsonl` file, and `.dockerignore` excludes them. The plan's step 10 does not name the build args, so this task chose `VERSION`, `REVISION` and `SOURCE` with defaults; the sibling release plan makes the same labels with `docker/metadata-action`, which overrides them.

Files changed by this task: `Dockerfile`, `.dockerignore`.

