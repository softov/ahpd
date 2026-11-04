---
title: Check daemon/31 under systemd and launchd
plans:
  - plans/daemon/31-the-service-manager-starts-the-daemon/plan.md
---

# Check daemon/31 under systemd and launchd

daemon/31 is on main. Its tests use a fake service manager. Debian passed on 2026-10-20. macOS with a real launchd is left.

## Set up

On the Mac, as your own user, not root:

```bash
git clone git@github.com:softov/ahpd.git ~/ahpd-check && cd ~/ahpd-check && pnpm install && pnpm build
alias ahpd="node $HOME/ahpd-check/packages/server/dist/main.js"
ahpd stop
```

## Debian results

Softov ran the Debian sections on 2026-10-20. The log is in `/home/softov/projects/reports/daemon-31.txt`.

- Install starts the daemon: pass. The output names no token file, because no token is configured.
- Stop and restart leave one daemon or none: pass.
- Install is refused beside a started daemon: pass.
- Uninstall leaves nothing: pass.
- A login starts it again: pass. After a reboot, `ahpd status` showed pid 1458 under systemd, and the pid before was 14115.

## macOS: install starts the daemon

1. Run `ahpd service install`.
2. Check that it prints the address and the token file, and no token.
3. Open `~/Library/LaunchAgents/dev.ahpd.daemon.plist`.
4. Check that it names the full path of `node`, the full path of `main.js`, the configuration file and the log.
5. Check that it has `RunAtLoad`, a `KeepAlive` on a crash, and a `PATH`.
6. Run `ahpd status`, and check that its first line ends with `under launchd`.
7. Run `launchctl print gui/$(id -u)/dev.ahpd.daemon`, and check that the service is running.
8. Check that `~/.config/ahpd/daemon.log` holds the daemon's start lines.

## macOS: a login starts it again

1. Log out, then log in.
2. Run `ahpd status`.
3. Check that it shows a daemon under launchd, with a new pid.

## macOS: stop and restart leave one daemon or none

1. Run `ahpd restart`.
2. Check that `ahpd status` shows a new pid.
3. Check that `pgrep -fl dist/main.js` shows one daemon process.
4. Run `ahpd stop`.
5. Check that `ahpd status` says `None running.`, and that `pgrep -fl dist/main.js` shows nothing.

## macOS: uninstall leaves nothing

1. Run `ahpd service install`, then `ahpd service uninstall`.
2. Check that `~/Library/LaunchAgents/dev.ahpd.daemon.plist` is gone.
3. Check that `~/.config/ahpd/daemon.json` is gone.
4. Check that `launchctl print gui/$(id -u)/dev.ahpd.daemon` finds no service.
5. Check that `pgrep -fl dist/main.js` shows nothing.

## Reply

Write "pass" for each macOS section, or what you saw. A pass ticks the matching line in the plan.
