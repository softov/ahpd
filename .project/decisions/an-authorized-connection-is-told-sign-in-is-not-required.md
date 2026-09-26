---
title: A connection that is already authorized is told the host's sign-in is not required
status: accepted
date: 2026-09-25
refs:
  - "[code://packages/sdk/src/users.ts#L67-L82](../../packages/sdk/src/users.ts#L67-L82) - `DEFAULT_RESOURCE`, `required: true` for every connection"
  - "[code://packages/sdk/src/host.ts#L2237-L2243](../../packages/sdk/src/host.ts#L2237-L2243) - `resourcesOf`, which lists the host's sign-in resource on every agent"
  - "[code://packages/sdk/src/host.ts#L2264-L2282](../../packages/sdk/src/host.ts#L2264-L2282) - `agentsFor`, the per-connection rewrite this decision is about"
  - "[code://packages/sdk/src/host.ts#L5775](../../packages/sdk/src/host.ts#L5775) - `authenticate` already answers a root connection as accepted without a credential"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L47-L60 - `modelRequiresAgentAuthentication`, which prompts for any resource with `required !== false`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L5626-L5637 - `_ensureRequiredAuthentication`, which throws before `createSession` is sent
---

## Context

With a users directory configured, every agent lists the host's sign-in resource with `required: true`.
VS Code reads that from the root state and refuses to create a session until it has a token for the resource, before sending anything to the host.
A connection admitted on the deployment's token is root and the host would accept the session, but the client never asks.
On 2026-09-25 this blocked VS Code on a host whose issuer was not running: "I used the root token on vscode... this was not sufficient?"

## Decision

A connection that is already authorized, meaning root or carrying a principal, is told the host's sign-in resource is `required: false`.
Every other connection is told `required: true`, as today.
Only the host's own sign-in resource changes; a backend's resources and GitHub's are listed as they are.

## Consequences

The root state's `agents` is no longer the same for every connection, so the snapshot, the live `root/agentsChanged` and the replay of it are each rewritten for the connection they go to.
The sequence number and the number of envelopes stay one per dispatch, so the conformance constraint on echoes still holds.
A connection that signs in mid-way reads `false` from its next delivery on, and is not sent a fresh copy for it.

## Options

- **Leave the resource out for an authorized connection.** Rejected: `authenticate` must name a resource the host advertised, and a root connection that sends one anyway would then be refused instead of answered as accepted.
- **Mark it `required: false` for everybody.** Rejected: a client on a personal token would defer the sign-in and then every command would fail with `-32007`, which is what `DEFAULT_RESOURCE` warns about.
