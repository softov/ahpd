---
title: A Docker install script
created: 2026-11-11
refs:
  - git://9098d5969 - the commit of ahpd the facts were checked at
  - git://c93c1ce - the commit of ahpio-site the facts were checked at
  - "[code://docker/compose.yaml#L1-L32](../../docker/compose.yaml#L1-L32) - the Compose file a person fetches today; only `AHPD_TAG` is a variable"
  - "[code://docs/server/DOCKER.md#L7-L26](../../docs/server/DOCKER.md#L7-L26) - *Install*: `mkdir work`, `curl` the file at a tag, `docker compose up -d`"
  - "[code://scripts/install/install.sh#L1-L27](../../scripts/install/install.sh#L1-L27) - the host install script: its flags, the `AHPD_*` variable for each, no sudo, questions on `/dev/tty`"
  - "[code://scripts/install/install.sh#L207-L235](../../scripts/install/install.sh#L207-L235) - `refuse_sudo`, `interactive` and `ask_yes`, the helpers a second script would share"
  - "[code://scripts/install/install.sh#L321-L345](../../scripts/install/install.sh#L321-L345) - `confirm_update`, which stops with the `--yes` command when no terminal can answer"
  - "[code://.github/workflows/release.yml#L77](../../.github/workflows/release.yml#L77) - the tag check reads `AHPD_TAG:-<tag>}` out of `docker/compose.yaml`"
  - "[code://.github/workflows/ci.yml#L218-L273](../../.github/workflows/ci.yml#L218-L273) - the `install` job, which runs `install.sh` in three containers"
  - "[code://.github/workflows/ci.yml#L279-L311](../../.github/workflows/ci.yml#L279-L311) - the `image` job, where Docker is available to a test"
  - "[code://.project/plans/daemon/20261110-0947-ahpd-runs-from-an-image/plan.md](../plans/daemon/20261110-0947-ahpd-runs-from-an-image/plan.md) - the image plan, active, whose task 06 changes `docker/entrypoint.sh` and `docker/test/smoke.sh`"
---

# A Docker install script

Softov wants one command that installs ahpd with Docker, as `install.sh` does for a host install.
The script checks the machine, asks a few questions, writes the files, and starts the container.
Today a person runs three commands from the docs page and edits `compose.yaml` by hand for anything else.

## What others do

A self-hosted project's Docker installer, read on 2026-11-11, is run as `bash <(curl -sSL <raw url>/docker/install.sh)`.

| Case | What it does |
| --- | --- |
| Checks | Stops when `docker`, `docker compose` v2 or `curl` is missing, and names the fix |
| Folder | Installs into `$HOME/<project>`, or `--dir`; a folder that holds another thing is refused |
| Resume | A folder with the Compose file and `.env` is a resume: nothing is fetched or rewritten, and the stack starts |
| Secrets | Generates two secrets with `openssl rand -hex 32` or `/dev/urandom` and writes them into `.env`, mode 0600 |
| Port | `--port`; a port already bound on the host stops the install before `docker compose up` |
| Question | One `Proceed? [y/N]`, read from `/dev/tty` when stdin is the pipe; no terminal stops with the `--yes` line |
| Dry run | `--dry-run` prints each command and changes nothing |
| Upgrade | `--upgrade` fetches the new Compose file, validates it with `docker compose config`, backs up the old one, pulls, and starts |
| Rollback | A failed pull, start or health check after an upgrade restores the old Compose file |
| Health | Polls the health URL for 120 s, then prints the address and the next steps |
| CI | A variable points the script at another source, so CI runs it against the branch under test |

Settings stay in `.env` and `docker-compose.override.yml`, and an upgrade replaces only the managed Compose file.
A version line in the Compose file marks it as managed.

## What ahpd has today

- `scripts/install/install.sh` installs ahpd on the host with npm, and never runs Docker.
Its flags each have an `AHPD_*` variable, so a pipe can pass them.
It refuses sudo, reads its questions from `/dev/tty`, and has `--yes`, `--dry-run`, `--uninstall` and `--purge`.
- ahpio.com serves `install.sh` and `install.ps1` from `scripts/install/` of the newest `v*` tag (ahpio-site `scripts/install-scripts.mjs`, lines 16-18).
A file in another folder is not served there.
- `docker/compose.yaml` is fetched from `raw.githubusercontent.com` at a tag, and runs that tag's image.
The port, the bind address, `AHPD_PLUGINS`, `./work` and the user are written in the file, so a change means an edit.
- The release tag check reads the default of `AHPD_TAG` in `docker/compose.yaml`, so that variable keeps its `${AHPD_TAG:-<tag>}` form.
- The daemon writes its own connection token into the volume on the first start, so an install has no secret to generate.
- Docker makes a missing `./work` owned by root, and the container runs as uid 1000, so `mkdir work` comes first today.
- A `docker` computer needs the host's Docker socket and the same folder path inside and outside, which *In a container* on the docs page says.

## Who writes

- The image plan is active: task 06 changes `docker/entrypoint.sh` and `docker/test/smoke.sh`.
The script calls neither, so the two do not collide.
- The release workflow reads `docker/compose.yaml`; a change there keeps the `AHPD_TAG` form.
- ahpio-site copies the install scripts; the script reaches ahpio.com only if that list grows, or the script lives in `scripts/install/`.
- No branch and no other session changes `docker/` at `9098d5969`.

## The change

- One command installs ahpd with Docker, fetched at a tag so it runs that tag's image.
- The script checks for Docker, Compose v2 and a reachable Docker daemon, and names the fix for each.
- It asks its questions on `/dev/tty`, and each answer also comes from a flag and an `AHPD_*` variable.
- The questions cover the install folder, the folder to serve, the port, loopback or the LAN, the plugins and the image tag.
- It writes the answers into `.env` beside `compose.yaml`, and `compose.yaml` reads them, with today's values as defaults.
- It creates the served folder as the person, and sets the container user to the person's uid.
- A second run on the same folder resumes, and `--upgrade` pulls the new image and starts it.
- `--uninstall` runs `docker compose down`, and `--purge` also removes the volume.
- It waits for the container to be healthy, then prints the address and the command that reads the token, never the token.
- CI runs it in the `image` job against the branch under test.

## Open points

1. Where the script lives:
`docker/install.sh` keeps it beside `compose.yaml`, and ahpio.com does not serve it.
`scripts/install/docker.sh` is served by ahpio.com once its list grows.
A `--docker` flag on `scripts/install/install.sh` keeps one URL and its helpers, and makes that script longer.
2. Whether the Docker socket is a question, with the root warning, or stays a documented edit.
3. Whether the LAN answer also asks for the address that `--origin` needs.
4. Whether an upgrade replaces `compose.yaml` with the new tag's file, with a backup, or changes only `AHPD_TAG` in `.env`.
5. Not checked: rootless Docker and Podman, where the container's uid maps differently.
