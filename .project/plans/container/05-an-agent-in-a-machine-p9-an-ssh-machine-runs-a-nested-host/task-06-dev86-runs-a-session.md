---
title: dev86, set up by hand, runs a session as an ssh machine
status: todo
depends: [task-04-the-ssh-fixture-and-tests.md]
layer: "computer (by hand)"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - how ahpd and a plugin are installed"
---

## Objective

dev86 runs ahpd installed by hand, is listed in this host's options as an ssh machine, and a session on it answers a turn, with no hypervisor code anywhere.

## Files

- None in the repository; the configuration used is written into this task's Resume.

## Steps

1. On dev86 (`softov@dev86.brbyte.com`, Debian 13): install Node and `npm i -g @ahpd/server` at this host's version, with `ahpd plugin install` for the agents to test; give it the model key by hand on dev86, never from this host.
2. On this host: `ssh.machines.dev86 = { destination: 'softov@dev86.brbyte.com', workdir: '/home/softov/work' }`.
3. Start a cofold session and a Claude session on `computer://ssh.dev86`; each answers a turn; `ps` on dev86 shows `ahpd --stdio`.
4. `ahpd restart` on this host; each session continues its conversation.
5. Record what failed and what had to be set by hand.

## Validation

- By hand, as above; the Resume names the versions and the config used.

## Resume
