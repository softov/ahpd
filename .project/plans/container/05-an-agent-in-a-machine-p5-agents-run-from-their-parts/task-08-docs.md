---
title: The docs say agents run from their parts
status: todo
depends: [task-04-claude-keeps-its-state-in-a-volume.md, task-05-acp-and-cofold-declare-their-state.md, task-07-pi-declares-its-state.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - \"Claude Code in a machine\" and \"A backend that runs nested\""
---

## Objective

`docs/COMPUTER.md` says each agent's CLI comes from its part and its configuration from a state volume, shows `computerExecutable: "host"` and `state: "host"`, drops the Dockerfile that installs ahpd from the nested section in favour of the part, and adds `@ahpd/agent-pi` to the table of backends in a machine as one that runs nested.

## Files

- `UPDATE: docs/COMPUTER.md`.

## Steps

1. Replace the `claudeExecutable` row; keep it under the option.
2. The nested section's image example becomes "any glibc image".

## Validation

- Read by hand against the code.

## Resume
