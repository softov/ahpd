---
title: The docs say who a tunnel visitor is
status: todo
depends: [task-03-tunnel-streams-come-into-the-process.md]
layer: "docs"
refs:
  - "[code://docs/plugins/tunnel-devtunnel.md](../../../../docs/plugins/tunnel-devtunnel.md) - the plugin's page"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the release notes"
---

## Objective

The plugin's page says who a tunnel visitor is, and the release notes say the change.

## Files

- `UPDATE: docs/plugins/tunnel-devtunnel.md` - the `person` setting, and who a visitor is on a host with users and on one without.
- `UPDATE: docs/updates/v0_15.md` - one line: a tunnel visitor gets the named person's grants, and no local port listens.

## Steps

1. Add `person` to the settings table of `tunnel-devtunnel.md`.
2. Write who a visitor is in three cases: with a person, with no users, and with users and no person.
3. Remove any text that says the hop listens on a port.
4. Add the line to `v0_15.md`.

## Validation

- Read the page against the behaviour of task 03, case by case.

## Resume

