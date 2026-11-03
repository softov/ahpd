---
title: Check that ahpc connects again after a restart from a client
plans:
  - plans/daemon/20261030-0635-a-client-restarts-the-daemon/plan.md
---

# Check that ahpc connects again after a restart from a client

daemon/20261030-0635 is on main (#145). On 2026-11-03 a test daemon passed the checks over the protocol. `x-ahpd/restart` restarted it, and while a turn ran it refused and named the session. With `force: true` it restarted. One check is left: a client connects again by itself.

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude
ahpc
```

## Steps

1. In a second terminal, restart the test daemon from a client:

```bash
node /github/ahpd.worktrees/pending-check/.project/pending/rpc.mjs x-ahpd/restart '{}'
```

2. Check that it prints `{"restarting":true,"pid":...}`.
3. Check that ahpc in the first terminal connects again, with no key pressed.
4. Close ahpc, and stop the test daemon with `ahpd stop`.

## Reply

Write "pass", or what you saw.
