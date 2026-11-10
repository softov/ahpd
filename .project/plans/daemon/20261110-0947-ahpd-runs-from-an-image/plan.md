---
title: ahpd runs from an image
domain: daemon
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/daemon/20261110-0947-a-container-holds-the-daemon/plan.md
decisions:
  - decisions/the-daemon-bundles-no-agent-and-starts-without-one.md
refs:
  - git://032300137 - the commit of ahpd this plan was revalidated at
  - "[code://.github/workflows/release.yml#L93-L99](../../../../.github/workflows/release.yml#L93-L99) - the pack step, `pnpm -r exec pnpm pack`, which only pnpm can run because of `workspace:^`"
  - "[code://.github/workflows/ci.yml#L218-L273](../../../../.github/workflows/ci.yml#L218-L273) - the `install` job, the container test the new job sits beside"
  - "[code://.github/workflows/ci.yml#L225-L229](../../../../.github/workflows/ci.yml#L225-L229) - the images CI tests: `debian:12-slim`, `node:20-bookworm-slim`, `node:22-bookworm-slim`"
  - "[code://packages/server/src/selfupdate.ts#L193-L200](../../../../packages/server/src/selfupdate.ts#L193-L200) - `--allow-scripts=node-pty`, passed only from npm 11.16"
  - "[code://packages/server/src/install.ts#L502-L516](../../../../packages/server/src/install.ts#L502-L516) - `pluginRoot`, the config folder unless `AHPD_PLUGIN_ROOT` is set"
  - "[code://packages/server/src/commands/plugin.ts#L27-L28](../../../../packages/server/src/commands/plugin.ts#L27-L28) - a plugin change with no daemon says to restart, so the entrypoint can install before `run`"
  - "[code://packages/server/src/commands/status.ts#L28-L36](../../../../packages/server/src/commands/status.ts#L28-L36) - `status --json` exits non-zero when no daemon is recorded, which a health check needs"
  - "[code://packages/server/src/commands/options.ts#L594-L620](../../../../packages/server/src/commands/options.ts#L594-L620) - `--path`, `--no-cwd` and `--connection-token-file`"
  - "[code://packages/server/src/commands/options.ts#L1133-L1169](../../../../packages/server/src/commands/options.ts#L1133-L1169) - `secret`, which writes a missing token file with mode 0600"
  - "[code://packages/server/src/config.ts#L1027](../../../../packages/server/src/config.ts#L1027) - `AHPD_CONFIG`, a file merged over the user file"
  - "[code://packages/server/src/pty.ts#L192-L208](../../../../packages/server/src/pty.ts#L192-L208) - the terminal binding: node-pty on Node"
  - "[code://docs/server/REMOTE.md#L33-L47](../../../../docs/server/REMOTE.md#L33-L47) - *Test a token*: 426 for a good token, 401 for a wrong one"
  - "[code://docs/server/INSTALL.md](../../../../docs/server/INSTALL.md) - the install page, which gets a line for the image"
  - "[code://docs/server/UPGRADE.md#L23-L34](../../../../docs/server/UPGRADE.md#L23-L34) - *Refusals*, which gets the image refusal"
  - "[code://docs/.vitepress/config.mts#L22-L40](../../../../docs/.vitepress/config.mts#L22-L40) - the sidebar, which gets the Docker page"
  - "[code://docs/README.md#L13-L26](../../../../docs/README.md#L13-L26) - the list of server pages"
  - https://docs.docker.com/build/building/context/#git-repositories - `docker build <git url>#<ref>` builds from a remote context
  - https://github.com/krallin/tini - `tini`, a PID 1 that forwards signals and reaps zombies
  - https://github.com/opencontainers/image-spec/blob/main/annotations.md - the `org.opencontainers.image.*` labels
---

## Goal

A person with Docker runs ahpd without Node, npm or a build.
One root `Dockerfile` builds the image from a checkout, so `docker build <git url>#<ref>` and the release job make the same image.
The configuration, the sessions, the plugins and the token live in one volume, and survive `docker rm`, an image upgrade and a reboot.
A Compose file is the default install, and listens on loopback only.
[daemon/20261110-0947-a-release-pushes-the-image](../20261110-0947-a-release-pushes-the-image/plan.md) publishes the image.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git ls-tree -r origin/main | grep -iE "docker|compose|entrypoint"` - no `Dockerfile`, `.dockerignore` or Compose file outside `packages/computer`.
- `ls /github/ahpd` - the root holds `ahp-ahpd.jsonl` and `ahp-code.jsonl`, transcripts a build context must not carry.
- `rg -n "allow-scripts" packages/server/src` - `selfupdate.ts` passes the flag only when npm knows it.
- `rg -n "None running" packages/server/src/commands/status.ts` - `status --json` prints `{"running":false}` and fails when nothing is recorded.

### Runtime path

```
docker compose up -> tini -> entrypoint.sh run -> missing plugins installed -> version step -> exec ahpd run --host 0.0.0.0 ...
  -> AHPD_SERVICE=container record -> HEALTHCHECK ahpd status --json -> client at 127.0.0.1:9187/?tkn=<token>
```

### Gaps

- No image of ahpd as a top-level host; the part images hold ahpd for machines only.
- `Not found: a docs page for Docker - searched docker in docs/server.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| The plan lives in ahpd's `.project/` | Softov, 2026-11-10, chose the recommended answer for "Where should the Docker plan files live?" | - |
| The image holds `@ahpd/server` only; the entrypoint installs `AHPD_PLUGINS` into the volume, `@ahpd/web` when unset | Softov, 2026-11-10, chose the recommended answer for "What should the ahpd image hold?" | 02 |
| The user is `ahpd`, uid 1000 from the build arg `AHPD_UID`; another uid is set with Compose `user:` | Softov, 2026-11-10, chose the recommended answer for "How should the container user match the owner of the files on the host?" | 01 |
| Base image `node:22-bookworm-slim`, from the build arg `NODE_IMAGE` | (defaulted: the image CI already tests, [`code://.github/workflows/ci.yml#L229`](../../../../.github/workflows/ci.yml#L229)) | 01 |
| Three stages: `pack` as `release.yml` packs, `install` with `python3 make g++`, `runtime` | (defaulted: one recipe for a Git build and a release) | 01 |
| The runtime adds `git bash ca-certificates openssh-client tini procps` | (defaulted: what sessions, `ssh` computers and PID 1 need) | 01 |
| `/opt/ahpd` is owned by root; `/home/ahpd` is the one volume | (defaulted: the image owns the code, the volume owns the state) | 01 |
| `HEALTHCHECK CMD ahpd status --json` | [`code://packages/server/src/commands/status.ts#L28-L36`](../../../../packages/server/src/commands/status.ts#L28-L36) | 01 |
| The image sets `AHPD_SERVICE=container` | the kind of [daemon/20261110-0947-a-container-holds-the-daemon](../20261110-0947-a-container-holds-the-daemon/plan.md) | 01 |
| Default command: `run --host 0.0.0.0 --port 9187 --connection-token-file /home/ahpd/.config/ahpd/connection-token --path /work --no-cwd` | (defaulted: `0.0.0.0` inside forces a token; the file keeps it off `docker inspect`) | 01 |
| The entrypoint runs `ahpd plugin update all` when the image version differs from `image-version` in the volume | (defaulted: a plugin follows the sdk of the image it runs on) | 02 |
| The entrypoint refuses an image older than `image-version`, unless `AHPD_ALLOW_DOWNGRADE=1` | (defaulted: a setting with the safe default) | 02 |
| A command other than `run` runs as `ahpd <command>` | (defaulted: `docker run <image> --version` reads as ahpd) | 02 |
| Compose publishes `127.0.0.1:9187`, sets `restart: unless-stopped` and `stop_grace_period: 40s` | (defaulted: loopback first; 40 s is above the 30 s `ahpd stop` waits) | 03 |
| CI builds the image from the PR's GitHub URL as well as from the checkout | Softov, 2026-11-10, chose the recommended answer for "Should I add the two run-from-GitHub paths to the Docker plans?" | 04 |
| `compose.yaml` works alone, fetched from `raw.githubusercontent.com` at a tag | Softov, 2026-11-10, chose the recommended answer for "Should I add the two run-from-GitHub paths to the Docker plans?" | 03, 05 |
| The default `AHPD_TAG` in `compose.yaml` is `X.Y` of the version, or the full version for a pre-release | (defaulted: a file fetched at a tag runs that tag's image) | 03 |
| The Docker socket is not in the default Compose file; the docs page names it as an opt-in that gives root on the host | (defaulted: no privilege by default) | 03, 05 |
| No Bun variant of the image | (defaulted: none until someone asks) | - |

## Proposed architecture

- **Build** - `Dockerfile` at the root: `pack` makes the tarballs, `install` runs `npm install -g --prefix /opt/ahpd` on them, `runtime` copies `/opt/ahpd`.
- **Start** - `tini` runs `docker/entrypoint.sh`, which installs plugins, runs the version step, and execs `ahpd`.
- **State** - the volume at `/home/ahpd` holds `~/.config/ahpd`, the plugin root, `image-version`, `.npm-global` and the agents' own folders.
- **Layer responsibilities** - image: the server and the system tools. entrypoint: plugins and the version step. daemon: everything else, unchanged.
- **Source-of-truth files** - CREATE: `Dockerfile`, `docker/entrypoint.sh`, `docker/compose.yaml`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The image builds from the checkout](task-01-the-image-builds-from-the-checkout.md) | implemented | - |
| [02 - The entrypoint seeds plugins and runs ahpd](task-02-the-entrypoint-seeds-plugins.md) | implemented | 01 |
| [03 - Compose runs the image](task-03-compose-runs-the-image.md) | implemented | 02 |
| [04 - CI runs the image checks](task-04-ci-runs-the-image-checks.md) | todo | 03 |
| [05 - The docs say how to run it in Docker](task-05-the-docs-say-how-to-run-in-docker.md) | todo | 03 |

## Risks and tradeoffs

- The first start needs npm, for `@ahpd/web` - The docs page says so, and an empty `AHPD_PLUGINS` starts with no plugin.
- The `node` image runs npm 10, which does not know `--allow-scripts` - The install stage passes the flag only when npm takes it, as `selfupdate.ts` does.
- A named volume made under one uid is not writable by another - The docs page gives the one `chown` that fixes it.
- Docker makes a missing `./work` owned by root, which uid 1000 cannot write - The install creates `work` before `docker compose up`.
- A backup of the volume holds `vault.json` and the token in clear text - The docs page says to treat a backup as a secret.

## Resume state

- **Done so far:** tasks 01 to 03 are implemented: the image builds from the checkout and is run by `docker/entrypoint.sh`, and `docker/compose.yaml` and `docker/compose.dev.yaml` run it on loopback with one volume. Every Docker check is left for review, because Docker is denied in this session.
- **Next action:** [task-04-ci-runs-the-image-checks.md](task-04-ci-runs-the-image-checks.md).
- **Open questions:** none.
- **Watch out for:**
The pack stage must run pnpm, not npm, or the tarballs carry `workspace:^`.
The token never goes on the command line: `--connection-token` shows in `docker inspect` and `ps`.
The entrypoint calls `ahpd plugin install` before `run`, and with no daemon that command only says to restart, which is the expected answer.
A `docker` or `devcontainer` computer through the socket resolves bind sources on the host, so a folder must have the same path inside and outside.

## Final verification checklist

- [ ] `docker build -t ahpd:dev .` and `docker build https://github.com/<owner>/ahpd.git#<branch>` both build.
- [ ] `docker compose -f docker/compose.dev.yaml up --build` gets healthy, and a client connects with the token from the volume.
- [ ] The CI `image` job passes on the PR.
- [ ] `pnpm docs:build` passes with the Docker page in the sidebar.
