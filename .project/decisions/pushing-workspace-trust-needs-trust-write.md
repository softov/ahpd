---
title: Pushing workspaceTrust needs trust:write, and the member role has it
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/gate.ts#L271-L280](../../packages/sdk/src/host/gate.ts#L271-L280) - `dispatchNeeds`, which is what a `workspaceTrust` push is held to"
  - "[code://packages/sdk/src/users.ts#L30](../../packages/sdk/src/users.ts#L30) - the built-in member role"
---

## Context

`workspaceTrust` is kept per connection, beside `defaultShell`, and a key in that set needs no grant.
A release review found that this lets any signed-in connection decide what its sessions load from a folder, without anything the operator gave it.
`defaultShell` is a preference; `workspaceTrust` decides whether project settings, hooks and ACP agents run.

## Decision

A `root/configChanged` that carries `workspaceTrust` needs `trust:write`.
`trust` is a new subject, and the built-in `member` role has `trust:write`.
`defaultShell` alone still needs no grant.

Source: Softov, 2026-10-07, asked "Any signed-in connection may push its own workspaceTrust without a grant. Keep that?" and chose "Needs a grant"; then asked "Which scope, and does the built-in member role have it?" and chose "trust:write, member has it".

## Consequences

- A member works as before; an operator can write a role without `trust:write`, and that role's sessions run untrusted.
- A refused push is a `rejectionReason` on the root channel, and the connection keeps the trust it had.
- On a host with no people directory every connection may push it, as every grant is held there.

## Options

- Keep it grant-free and document it: the client's word decides, as in VS Code.
- Needs `config:write`: members, who lack it, would all run untrusted.
- An operator setting that locks trust to a list: a second mechanism beside the grant.
