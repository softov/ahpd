---
title: The host advertises only what is true about how to sign in
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/users.ts#L29-L52](../../packages/sdk/src/users.ts#L29-L52) - `DEFAULT_RESOURCE`, the record every agent carries and the one that names a documentation page as an authorization server"
  - "[code://packages/sdk/src/host.ts#L2144-L2150](../../packages/sdk/src/host.ts#L2144-L2150) - `resourcesOf`, which appends that record to every agent"
  - https://www.rfc-editor.org/rfc/rfc9728.txt - `authorization_servers` is a list of RFC 8414 issuer identifiers and is optional, `resource` is an https URL, and `resource_documentation` is the field for a page
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L373-L395](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L373-L395) - VS Code resolves a provider from `authorization_servers`, so a documentation URL on github.com is matched against GitHub's provider"
---

## Context

The record in `DEFAULT_RESOURCE` is advertised on every agent, and two of its fields say things that are not true.
`authorization_servers` holds `https://github.com/softov/ahpd/blob/main/docs/USERS.md`, which is a page and not an RFC 8414 issuer identifier.
`resource` is `ahpd://users`, and RFC 9728 requires a resource identifier that uses the https scheme.

The format already has the field the page belongs in: `resource_documentation`.
It also makes `authorization_servers` optional, so a host with no authorization server has nothing it is obliged to invent.

This is not cosmetic.
VS Code matches each entry in `authorization_servers` against the authentication providers it has, so an entry on `github.com` can resolve GitHub's provider and send a person to sign in to GitHub for a credential this host will then refuse.
The person sees a failure that names neither the real problem nor the host.

## Decision

The host advertises only what is true.
`authorization_servers` is omitted unless an issuer is configured, in which case it holds that issuer's identifier and nothing else.
The documentation page moves to `resource_documentation`.
`resource` is an https identifier, named by the operator when they name one and derived from the addresses the daemon listens on when they do not, so a deployment without an https identifier says so rather than publishing a scheme it does not have.

## Consequences

A client that reads the record can no longer be sent to the wrong issuer.
A spec-following client sees a resource it can identify, and a client that signs in through `authenticate` must name the identifier it reads from root state rather than the one that used to be hard-coded.
A credential a client stored under `ahpd://users` is keyed by a string that no longer matches, so a person signs in once more after an upgrade, which is worth a line in the release notes.
Until the issuer option lands, `authorization_servers` is absent rather than wrong, and a client with no provider to resolve behaves exactly as it does now.

## Options

- **Keep the documentation URL.** Rejected: it names a page where the format requires an issuer, and it points at a third party's origin, so a client can be made to sign in to a service that knows nothing about this host.
- **Point at `https://github.com/login/oauth` directly.** Rejected: this host is not GitHub's resource server, and naming GitHub would make every install claim an issuer whose tokens the host does not accept.
- **Serve RFC 8414 metadata and a token endpoint, and name the daemon as its own issuer.** Rejected for now: it needs an HTTP surface, TLS and a token exchange the host does not have, and a client that only resolves installed providers still has none for that origin.
- **Drop `resource_documentation` and say nothing about the page.** Rejected: the page is useful, the format has a field for it, and a documentation link nobody publishes is a documentation link nobody finds.
