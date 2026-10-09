---
title: Authentication has its own doc
status: implemented
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

`docs/AUTHENTICATION.md` is written, 285 lines: what it is and its terms one line each; the table of what each credential answers; the door; the deployment token; a person's token; `authenticate`; an issuer with its three subsections; trusted folders; what is readable before signing in; the config keys with each option; the `user` and `team` commands one line each; the grants table; and what to read next.

Moved out of `docs/USERS.md`, each leaving a stub heading and a link: "The door and the authorization" (the comparison table became "What each one answers" in the new doc), "An issuer, when a client needs one" with its four subsections, "Trusted folders", and "What is readable before signing in". `docs/USERS.md` keeps people, roles, teams, the record it advertises and the clients.

Moved out of `docs/DAEMON.md`: "Who may connect", which leaves one line and a link and is now the new doc's "The door".

Links fixed: `docs/AHP.md` twice (the `root/configChanged` row's `workspaceTrust` link, and the `authenticate` section's connection-token link), `packages/agent-claude/README.md` and `packages/agent-pi/README.md` (both pointed at `docs/USERS.md#trusted-folders`), and the `trust` row of `docs/USERS.md`'s grants table, which linked its own moved anchor.

Found: `docs/USERS.md`'s "The record the host advertises" said there is no `authorization_servers` and that "an issuer option that would fill it honestly is a later plan". The option is in the tree - `packages/sdk/src/users.ts:326` `signInRecord` adds the field whenever an issuer is passed, `packages/server/src/commands/run.ts:249` passes `options.issuer`, and `packages/sdk/src/issuers.ts` builds one from `github` or an OIDC URL - so the paragraph now says the field is absent until an issuer is configured and otherwise carries the issuers this host answers for.

Found: the moved "Trying it" list named five third-party identity products. The new doc says "a real identity provider, named by its issuer URL" instead, since no third-party project may be cited. The moved issuer text also cited "the field plan 07 left empty on purpose" and that phrase is gone; `docs/USERS.md`'s "Clients" still says "Plan 07's research file records ...", which is untouched and not a claim about code.

Drift: `.project/plans/**` cites `docs/USERS.md` and `docs/DAEMON.md` by `#L<n>` line anchor in twelve places. None of them points into a moved section (checked the ranges the four USERS.md sections and DAEMON.md's "Who may connect" occupied), but every anchor below a removed section now names a different line.
