---
title: The docs say a value never reaches a command line
status: todo
depends: [task-01-docker-takes-every-value-by-name.md, task-02-the-dev-container-cli-takes-every-value-by-name.md, task-04-a-need-value-answers-set.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the Security section"
---

## Objective

`docs/COMPUTER.md` says, under Security, that environment values reach a machine by name and are not visible in the host's process list, and that a need value in the plugin's options answers `<set>`.
It says a value named from the vault is never given at create, so `docker inspect` does not hold it, and that it is passed on each `docker exec` instead.
Under Profiles, it documents `secretUnreadable`: when a vault-named value cannot be read again after a restart, `"fail"`, the default, fails every exec into the machine with a line naming the need, and `"drop"` runs the exec without that variable and logs the line.

## Files

- `UPDATE: docs/COMPUTER.md` - one paragraph under Security, and `secretUnreadable` under Profiles.

## Steps

1. Add the paragraph; one sentence per line, no em dash.
2. Add `secretUnreadable` to the profile fields, with both values and its default.

## Validation

- Read by hand against the code.

## Resume
