---
title: Check the image from a phone and with a docker computer
plans:
  - plans/daemon/20261110-0947-ahpd-runs-from-an-image/plan.md
---

# Check the image from a phone and with a docker computer

Two things the `image` CI job cannot check: a person's own network, and a machine made through the Docker socket. Both need a real host, so they are here rather than in `docker/test/smoke.sh`. Run them once the `image` job is green, on a checkout of the plan's branch.

The address `192.0.2.10` below stands for this machine's own address on the LAN. Put the real one in its place, and keep `/work` in the second check as the host's own folder of that name, not the container's.

## Set up

1. Build the image from the checkout:

```bash
docker build -t ahpd:dev .
```

2. Start one container reachable from the LAN, with the token written into its volume. `--origin` is what lets a browser on another name reach it. It publishes the port on the LAN address only, never on 5180 or 37537:

```bash
mkdir -p work
docker run -d --name ahpd-lan --restart no \
  -p 192.0.2.10:9187:9187 \
  -v ahpd-lan:/home/ahpd \
  -v "$PWD/work:/work" \
  ahpd:dev run --host 0.0.0.0 --port 9187 \
  --connection-token-file /home/ahpd/.config/ahpd/connection-token \
  --path /work --no-cwd --origin http://192.0.2.10:9187
```

3. Read the token:

```bash
docker exec ahpd-lan cat /home/ahpd/.config/ahpd/connection-token
```

## Steps

1. On a phone on the same network, open `http://192.0.2.10:9187/plugins/web/`. Check that the page loads and that the token from step 3 signs in.
2. Start a turn from the phone. Check that the turn reaches the daemon, so the daemon accepts the origin.
3. Restart the container with no `--origin`, and open the page again. Check that the daemon refuses a request whose `Origin` it does not know. Stop this container before the next check.
4. Start a container with the Docker socket, and the same folder at the same path inside and outside:

```bash
docker run -d --name ahpd-sock --restart no \
  -p 127.0.0.1:9187:9187 \
  -v ahpd-sock:/home/ahpd \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/work:/work" \
  ahpd:dev
docker exec ahpd-sock ahpd plugin install @ahpd/computer
docker restart ahpd-sock
```

5. Sign in, and make a computer whose `folder` is a folder under `/work` that holds a file. Add that machine to a session. Check that the session reads the file, so the host's path and the container's path are the same one.
6. Make a second computer whose `folder` is a path that exists only inside the container, such as `/home/ahpd`. Check that it is not the folder the session sees: the Docker daemon resolves the path on the host. That is the rule the page states.

## Reply

Write "pass", or say which step stopped.
