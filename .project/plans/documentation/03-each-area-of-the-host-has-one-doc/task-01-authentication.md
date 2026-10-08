---
title: Authentication has its own doc
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts) - tokens, the issuer and principals"
  - "[code://packages/server/src/commands/authorize.ts](../../../../packages/server/src/commands/authorize.ts) - the deployment token"
---

## Objective

`docs/AUTHENTICATION.md` says how a client proves who it is: the door, tokens, the deployment token, the issuer, trusted folders, and who may connect. USERS.md keeps people, roles and teams.

## Files

- `CREATE: docs/AUTHENTICATION.md`.
- `UPDATE: docs/USERS.md` - "The door and the authorization", "An issuer, when a client needs one", "Trusted folders" and "What is readable before signing in" move out.
- `UPDATE: docs/DAEMON.md` - "Who may connect" moves out.

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
