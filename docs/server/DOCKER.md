# Docker

The image holds Node and `@ahpd/server`, so a machine with Docker needs no Node, no npm and no build.
Everything that changes lives in one volume: the configuration, the plugins, the token, the vault, the sessions and the agents' own folders.
It survives `docker rm`, an image upgrade and a reboot.

## Install

Compose is the default install.
The file is fetched from GitHub at a tag, so it runs that tag's image and needs no checkout.

```bash
mkdir work
curl -fsSLO https://raw.githubusercontent.com/ahpio/ahpd/v0.15.0-rc.2/docker/compose.yaml
docker compose up -d
```

`./work` beside the file is served as `/work`, and the port is published on `127.0.0.1` only.
Set `AHPD_TAG` to another version to run another image.

The container runs as uid 1000. A volume made by another uid is not writable, and this is the one `chown` that fixes it:

```bash
docker compose run --rm --entrypoint chown ahpd -R 1000:1000 /home/ahpd
```

## The token

The token is a file in the volume, and `--connection-token` is never a flag in a container: a flag shows in `docker inspect` and in `ps`.
Read the file:

```bash
docker compose exec ahpd cat /home/ahpd/.config/ahpd/connection-token
```

Then open `http://127.0.0.1:9187/plugins/web/` and sign in with it.
For another client the address is `ws://127.0.0.1:9187` and the token is the same one. See [Connect a client](CONNECT.md).

## By hand

```bash
docker run -d --name ahpd --restart unless-stopped \
  -p 127.0.0.1:9187:9187 \
  -v ahpd-home:/home/ahpd \
  -v "$PWD/work:/work" \
  ghcr.io/ahpio/ahpd:0.15.0-rc.2
```

`ahpd-home` here is a volume of its own. Compose names its volume after the project folder, so the two commands do not share one.

## From GitHub

The image builds from a tag or a branch without a checkout:

```bash
docker build -t ahpd:dev "https://github.com/ahpio/ahpd.git#v0.15.0-rc.2"
docker build -t ahpd:dev "https://github.com/ahpio/ahpd.git#main"
```

The same build runs from a checkout with `docker build -t ahpd:dev .`.

## Configuration

The configuration is `config.json` in `~/.config/ahpd` inside the volume, which is `/home/ahpd/.config/ahpd`.
`AHPD_CONFIG` names a second file that is merged over it, so a file mounted read-only works:

```yaml
volumes:
  - ./config.json:/etc/ahpd/config.json:ro
environment:
  AHPD_CONFIG: /etc/ahpd/config.json
```

The default command is the flags of `ahpd run`: `--host 0.0.0.0 --port 9187 --connection-token-file /home/ahpd/.config/ahpd/connection-token --path /work --no-cwd`.
A Compose `command:` replaces it, and a flag here is on one line in `docker inspect`.
Keep the token in the file and not in `--connection-token`.

## Plugins

The image holds the server and no plugin.
On every start the entrypoint installs each plugin in `AHPD_PLUGINS` that the volume does not have, then moves them all when the image version changed.
`AHPD_PLUGINS` defaults to `@ahpd/web`, and an empty value starts with no plugin.

```yaml
environment:
  AHPD_PLUGINS: "@ahpd/web,@ahpd/agent-claude"
```

To add one to a running container:

```bash
docker compose exec ahpd ahpd plugin install @ahpd/agent-claude
docker compose restart ahpd
```

A plugin installed that way is in the volume, so it survives a new container and an image upgrade.
Add its name to `AHPD_PLUGINS` as well, so a new volume gets it too.

## Agent CLIs

A native agent such as Claude, cofold or pi runs in the daemon's own process, so it needs nothing more.
An ACP agent runs its CLI, and the CLI must be in the container.
The image holds `npm`, and a global install goes to the volume:

```bash
docker compose exec ahpd npm i -g @agentclientprotocol/codex-acp
docker compose exec ahpd ahpd plugin install @ahpd/agent-acp
docker compose restart ahpd
```

## In a container

| Feature | What changes |
| --- | --- |
| Folders | Only the folders mounted in. `/work` is the default, and `--path` names more |
| Terminals | A pseudoterminal, as on a machine, because the image builds `node-pty`. A session's commands run in this container |
| Native agents | Claude, cofold and pi run in the process. Nothing to install |
| An ACP agent | Its CLI must be in the container, as *Agent CLIs* says |
| An `ssh` computer | Reaches the other box from the container's network, with the key in the volume |
| A `docker` computer | Needs the Docker socket, and its bind sources are the host's paths |
| A `libvirt` or `proxmox` computer | The socket or the API of that host, from the container's network |

::: warning The Docker socket
A container with `/var/run/docker.sock` mounted can start any container, as root, on the host.
It is not in the default Compose file. Mount it only for a `docker` computer, and know what it gives:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```
:::

A `docker` computer resolves a bind source on the host, not in this container.
A folder must have the same path inside and outside, or mount the same folder at both, or the computer finds an empty folder at that path.
The same goes for a `devcontainer` computer.

## Lifecycle

```bash
docker compose up -d                  # start, and build nothing
docker compose stop                   # stop, waiting up to stop_grace_period
docker compose restart                # stop and start again, on the same volume
docker compose logs -f ahpd           # the daemon's output
docker compose ps                     # the health status
```

The health check is `ahpd status --json`, so `healthy` means a daemon is recorded and a client can reach it.

### Upgrade

```bash
docker compose pull
docker compose up -d
```

The entrypoint runs `ahpd plugin update all` when the image version differs from the volume's, so every plugin follows the new sdk.
The token, the configuration and the sessions stay as they are.

### Rollback

```bash
AHPD_TAG=0.15.0 docker compose up -d
```

An image older than the volume's `image-version` does not start, because the plugins there follow a newer sdk.
Versions are compared as semver, so a pre-release is older than its release: a volume at `0.15.0-rc.2` starts the `0.15.0` image, and the `0.15.0-rc.2` image refuses a volume at `0.15.0`.
An `image-version` that is not a version stops the start, and the log names it.
Set `AHPD_ALLOW_DOWNGRADE=1` to start it anyway, and expect a plugin to fail to load.

### Backup

```bash
docker compose exec ahpd tar czf - -C /home/ahpd . > ahpd-home.tar.gz
```

### Restore

```bash
docker compose down
docker compose run --rm -T --entrypoint tar -v "$PWD:/backup" ahpd xzf /backup/ahpd-home.tar.gz -C /home/ahpd
docker compose up -d
```

### Remove

```bash
docker compose down          # the container and the network, and the volume stays
docker compose down -v       # and the volume, with the configuration, the token and the sessions
```

::: danger A backup holds secrets
`vault.json` and `connection-token` are in the volume in clear text, and the backup carries them both.
Treat `ahpd-home.tar.gz` as a secret: keep it off shared folders, and delete it when it is no longer needed.
:::

## From a host install

A host install keeps everything in `~/.config/ahpd`. Copy it into the volume, without what the container writes itself:

```bash
docker compose up -d
docker compose stop
tar czf - -C ~/.config/ahpd \
  --exclude node_modules --exclude daemon.json --exclude daemon.log . \
  | docker compose run --rm -T --entrypoint tar ahpd xzf - -C /home/ahpd/.config/ahpd
docker compose up -d
```

`node_modules` holds the plugin packages themselves, which the entrypoint installs again for the new image.
`daemon.json` names a process on the old machine, and `daemon.log` is that process's log.
