---
title: The docs and specs say so
status: todo
depends:
  - task-01-the-host-holds-the-window-keys.md
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L190-L217](../../../../docs/sdk/AHP.md#L190-L217) - the `root/configChanged` row and what this host acts on"
  - "[code://.project/specs/workspace-trust.md](../../../../.project/specs/workspace-trust.md) - trust, read for each connection"
  - "[code://.project/specs/people-roles-and-grants.md#L192-L198](../../../../.project/specs/people-roles-and-grants.md#L192-L198) - the grants a root config change needs"
---

## Objective

Every doc and spec that keeps the window keys on a connection says they are the host's one value.
Each names the grants a push needs.

## Files

- `UPDATE: docs/sdk/AHP.md:190-217` - the `root/configChanged` row and the keys this host acts on.
- `UPDATE: docs/sdk/HOST.md:130-190` - root config's keys and the grants a push needs.
- `UPDATE: docs/sdk/AUTHENTICATION.md:245-260` - trusted folders.
- `UPDATE: docs/sdk/TERMINALS.md:100-110` - `defaultShell`.
- `UPDATE: docs/sdk/USERS.md:440-475` - the root config's grants and the shell.
- `UPDATE: .project/specs/workspace-trust.md` - trust is the host's, read for the session owner's turns.
- `UPDATE: .project/specs/people-roles-and-grants.md:192-198` - a push of a window key needs `config:change`.

## Steps

1. Rewrite each paragraph that keeps a window key on a connection, from the code as it stands.
2. Name `config:change` for a push of a window key, and `trust:push` for `workspaceTrust` alone.
3. Run the prose lint on the two specs.

## Validation

- `rg -n "per connection|connection's own" docs .project/specs` names no window key.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs .project/specs/workspace-trust.md .project/specs/people-roles-and-grants.md` is clean.

## Resume

Not started.
