---
title: The README says pi asks
status: implemented
depends: [task-02-a-mode-says-which-calls-ask.md]
layer: "docs"
refs:
  - "[code://packages/agent-pi/README.md#L56](../../../../packages/agent-pi/README.md#L56) - the tool-confirmation bullet"
---

## Objective

`packages/agent-pi/README.md` says which calls a pi session asks about, and how a person changes that.

## Files

- `UPDATE: packages/agent-pi/README.md:56` - the bullet moves from what does not map to what does.

## Steps

1. Rewrite the bullet in the file's own style, with no em dashes, as task 02 built it.

## Validation

- Read against the code once tasks 01 and 02 are done.

## Resume

Built.
`packages/agent-pi/README.md` moved tool confirmation from what does not map to what maps: a session asks a person before a call its `permissionMode` says to ask about, the call is shown `pending-confirmation`, the session is `InputNeeded`, and the answer runs or blocks it, with the same six modes Claude and cofold offer and `default` asking before a write, the network or destruction.

- Validation was reading the bullet against the code in tasks 01 and 02; no code or test changed.
- `pnpm test` 102 files, 1380 tests; `pnpm typecheck` and `pnpm boundary` green.
