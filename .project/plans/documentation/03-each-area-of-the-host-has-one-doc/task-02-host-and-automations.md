---
title: The host and automations have their own docs
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts) - root config"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - automations"
---

## Objective

`docs/HOST.md` says what the host is: the root resource, its config keys with each option, the schemes it serves, and what it announces. `docs/AUTOMATIONS.md` says what an automation is: triggers, trigger types from plugins, runs, owners, and the commands. DAEMON.md keeps running the daemon.

## Files

- `CREATE: docs/HOST.md`, `CREATE: docs/AUTOMATIONS.md`.
- `UPDATE: docs/DAEMON.md` - "Automations" moves to AUTOMATIONS.md; the root config half of "Configuration" moves to HOST.md.

## Steps

1. Read the sources in Files and the area's code; list its terms, config keys, commands and grants.
2. Write each doc in the plan's shape, checking every claim against its code.
3. Move the named sections; leave one line and a link where each was.
4. Run `rg -n "DAEMON.md#|USERS.md#|AHP.md#" .` and fix each link that moved.
5. Find the area's decisions with `rg -ln "code://packages/<area path>" .project/decisions/` and link the ones a reader needs for why.

## Validation

- Each claim names a file it was read in; read by hand against that file.
- Softov reads the diff before commit.

## Resume
