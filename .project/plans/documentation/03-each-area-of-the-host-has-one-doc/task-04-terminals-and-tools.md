---
title: Terminals and tools have their own docs
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/host/terminals.ts](../../../../packages/sdk/src/host/terminals.ts) - terminals"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - tools and MCP servers"
---

## Objective

`docs/TERMINALS.md` says what a terminal is, who opens one, where it runs, and its grants. `docs/TOOLS.md` says what tools a session is offered: host tools, plugin tools, MCP servers in root config with each field, and compact prompts.

## Files

- `CREATE: docs/TERMINALS.md`, `CREATE: docs/TOOLS.md`.

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
