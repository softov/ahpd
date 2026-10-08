---
title: Resources and usage have their own docs
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/host/resourcemethods.ts](../../../../packages/sdk/src/host/resourcemethods.ts) - resource commands"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts) - usage"
---

## Objective

`docs/RESOURCES.md` says what a resource is: schemes, read, write, list and the rest, who may read what, and how a plugin serves a scheme. `docs/USAGE.md` says what usage is: pools, costs, the provider's reported cost and the input and output split, and `usage:read`.

## Files

- `CREATE: docs/RESOURCES.md`, `CREATE: docs/USAGE.md`.
- `UPDATE: docs/USERS.md` - "People as resources" and "Policies as resources" keep their text and link RESOURCES.md.

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
