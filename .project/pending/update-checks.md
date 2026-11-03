---
title: Check ahpd update on Debian and Windows
plans:
  - plans/daemon/35-the-daemon-updates-itself/plan.md
---

# Check ahpd update on Debian and Windows

daemon/35 is on main, and its tests use a fake npm and a fake registry. `ahpd update` came in 0.14.0, and npm has no newer `@ahpd/server` (checked on 2026-11-03). So this check waits on the next release.

## Set up

On Debian, in a shell of its own, so your global npm and your daemon stay as they are:

```bash
export NPM_CONFIG_PREFIX=$HOME/ahpd-update-check PATH=$HOME/ahpd-update-check/bin:$PATH
export XDG_CONFIG_HOME=$HOME/ahpd-update-check/config XDG_STATE_HOME=$HOME/ahpd-update-check/state XDG_DATA_HOME=$HOME/ahpd-update-check/data
npm i -g @ahpd/server@0.14.0
ahpd plugin install @ahpd/agent-cofold
ahpd start --port 39300
```

## The check answers

1. Run `ahpd update --check`.
2. Check that it prints the installed and the latest version, and that the update may run.
3. Run `ahpd update --version 0.13.0`, and check that it is refused.

## A daemon from ahpd start moves

1. Run `ahpd update`.
2. Check that `ahpd status` shows the latest version.
3. Check that `ahpd plugin list` shows `@ahpd/agent-cofold` with the new `@ahpd/sdk`.

## A daemon under the systemd unit moves

1. Run `npm i -g @ahpd/server@0.14.0` again, then `ahpd service install`.
2. Run `ahpd update`.
3. Check that `systemctl --user status ahpd` shows the daemon running, and that `ahpd status` shows the latest version.

## HTTP and AHP

1. Send `POST http://127.0.0.1:39300/api/update` with `{"check": true}` and a person's token, and check that the answer is 403.
2. Send the same request with the deployment token, and check that it answers the versions.
3. From ahpc as a person, call `x-ahpd/update`, and check that it is refused with `-32009`.

## Windows

1. On Windows, run `npm i -g @ahpd/server@0.14.0`, then `ahpd start --port 39300`.
2. Run `ahpd update`.
3. Wait until `daemon.log` says "the daemon is up".
4. Check that `ahpd status` shows the latest version.

## Reply

Write "pass" for each section, or what you saw.
