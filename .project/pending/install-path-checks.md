---
title: Check that an installed ahpd is found outside bash
plans:
  - plans/daemon/20261031-0555-ahpd-is-found-outside-bash/plan.md
---

# Check that an installed ahpd is found outside bash

daemon/20261031-0555 is on main (#167), and not in `v0.14.0`, so the script comes from main. These checks need the GNOME desktop and a test user who cannot write `/usr/local`, so your own `~/.bashrc` and `~/.profile` stay as they are.

## Set up

```bash
sudo adduser --gecos '' ahpdtest
git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:scripts/install/install.sh > /tmp/ahpd-install.sh && chmod 644 /tmp/ahpd-install.sh
```

## Steps

1. Install as the test user, and check the marked lines:

```bash
sudo -iu ahpdtest bash /tmp/ahpd-install.sh --no-onboard
sudo -iu ahpdtest grep -n ahpd .bashrc .profile
```

2. Expect the install in `~ahpdtest/.npm-global`, and one marked PATH line in each file.
3. Log in to GNOME as `ahpdtest`. Open ahp-desk. Expect it to find `ahpd` and not to offer a second install. Log out.
4. Remove the marked lines from `.profile` only, run the install again, and check that the line is back:

```bash
sudo -iu ahpdtest sed -i '/ahpd/d' .profile
sudo -iu ahpdtest bash /tmp/ahpd-install.sh --no-onboard
sudo -iu ahpdtest grep -n ahpd .profile
```

5. Uninstall, and expect no `@ahpd/server` and no marked line:

```bash
sudo -iu ahpdtest bash /tmp/ahpd-install.sh --uninstall
sudo -iu ahpdtest ls .npm-global/lib/node_modules
sudo -iu ahpdtest grep -n ahpd .bashrc .profile
```

6. Remove the test user with `sudo deluser --remove-home ahpdtest`.
7. On a daemon that runs under an nvm Node, install a plugin from a client. While it installs, run `ps -ef | grep npm-cli`, and expect that Node with its own `npm-cli.js`, not `/usr/bin/npm`.

## Reply

Write "pass", or what went wrong at which step.
