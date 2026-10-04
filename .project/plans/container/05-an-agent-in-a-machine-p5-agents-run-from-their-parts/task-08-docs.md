---
title: The docs say agents run from their parts
status: todo
depends: [task-04-claude-keeps-its-state-in-a-volume.md, task-05-acp-and-cofold-declare-their-state.md, task-07-pi-declares-its-state.md, task-09-a-claude-variants-env-reaches-its-machine.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - \"Claude Code in a machine\" and \"A backend that runs nested\""
---

## Objective

`docs/COMPUTER.md` says each agent's CLI comes from its part and its configuration from a state volume, shows the host-binary opt-in and `state: "host"`, says a Claude variant takes its own `env` into its machine, drops the Dockerfile that installs ahpd from the nested section in favour of the part, and adds `@ahpd/agent-pi` to the table of backends in a machine as one that runs nested.
It documents `computerCliFallback`: `"refuse"`, the default, refuses a Claude session whose machine could not get the `claude` part, naming the part, and `"host"` mounts the host binary instead and logs that it did.
It says pi's key variables are the ones pi's provider list names, and that a custom variable in pi's settings is added as a need in the profile.

## Files

- `UPDATE: docs/COMPUTER.md`.

## Steps

1. Replace the `claudeExecutable` row; keep it under the opt-in.
2. The nested section's image example becomes "any glibc image".
3. Add `computerCliFallback` beside `computerCli`, with both values and its default.
4. Show a profile that adds a custom pi key variable as a need.

## Validation

- Read by hand against the code.

## Resume
