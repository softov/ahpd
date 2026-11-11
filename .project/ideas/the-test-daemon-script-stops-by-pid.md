---
title: The test daemon script stops its own daemon by pid
created: 2026-11-11
refs:
  - "[code://.project/pending/test-daemon.sh](../pending/test-daemon.sh) - runs `ahpd stop` before it starts"
---

`test-daemon.sh` runs `ahpd stop` with the test `XDG_*` variables, which stops only the test daemon.
An agent's permission check cannot see that, and refused the script on 2026-11-11.
The script could read the pid from the test daemon's own record, and stop that pid.
Then nothing in it reads as a stop of Softov's daemon.
