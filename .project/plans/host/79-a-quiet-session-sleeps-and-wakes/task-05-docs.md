---
title: Docs
status: todo
depends: [task-02-a-sleeping-session-wakes.md, task-03-a-backend-says-what-keeps-it-awake.md, task-04-an-agent-schedules-its-own-wake.md]
layer: "docs"
refs:
  - "[code://docs/SESSIONS.md](../../../../docs/SESSIONS.md) - where a session's life is described"
  - "[code://docs/HOST.md](../../../../docs/HOST.md) - the host options"
  - "[code://docs/TOOLS.md](../../../../docs/TOOLS.md) - the host tools an agent calls"
  - "[code://docs/AUTOMATIONS.md](../../../../docs/AUTOMATIONS.md) - pinned automations"
---

## Objective

The docs say when a session sleeps, what keeps it awake, what wakes it, and how an agent schedules its own wake.

## Files

- `UPDATE: docs/SESSIONS.md` - a section on sleep and wake: the timeout, what keeps a session awake, what wakes it.
- `UPDATE: docs/HOST.md` - the `sleepAfterMinutes` and `sessionResidencyLimit` options, their defaults and 0.
- `UPDATE: docs/TOOLS.md` - the `schedule_wakeup` tool and its arguments.
- `UPDATE: docs/AUTOMATIONS.md` - a pinned automation wakes a sleeping session.
- `UPDATE: packages/sdk/README.md` - `busy()` on `Session`, for a backend author.

## Steps

1. Write the sleep and wake section in `docs/SESSIONS.md`.
2. Add `sleepAfterMinutes` and `sessionResidencyLimit` to `docs/HOST.md`.
3. Add `schedule_wakeup` to `docs/TOOLS.md`.
4. Add one sentence on a sleeping pinned session to `docs/AUTOMATIONS.md`.
5. Document `busy()` for backend authors in `packages/sdk/README.md`.

## Validation

- Read each section against the built code.
- Check that `sleepAfterMinutes` and `schedule_wakeup` read the same in the docs and in the server options.

## Resume
