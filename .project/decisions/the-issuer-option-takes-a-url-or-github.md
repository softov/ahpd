---
title: The issuer option names an OpenID Connect issuer by URL, with GitHub as a preset
status: superseded
superseded-by: decisions/an-issuer-may-be-plain-http-on-loopback.md
date: 2026-09-23
refs:
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395) - a client resolves a provider by matching the issuer identifier"
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L777-L800](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L777-L800) - the interactive fallback is the GitHub Copilot dialog, which is why GitHub is the one that works with no client work"
  - https://www.rfc-editor.org/rfc/rfc8414 - the issuer identifier is an https URL with no query or fragment, and its metadata is discovered at a well-known path
---

## Context

`authorization_servers` holds RFC 8414 issuer identifiers, and which ones a host should accept is a real choice.
A client matches the entries against the authentication providers it has, so the useful set is not the same for every deployment: a stock client has GitHub and an enterprise has an identity provider of its own.
The reference client can create a provider dynamically from an issuer's metadata, but only on its MCP path, so for agent resources the issuer has to be one a provider is already installed for.

GitHub is the one that works with no client work at all, and an OpenID Connect issuer named by URL is the one an operator with an enterprise identity provider actually has.

## Decision

The `issuer` option takes either the word `github` or an https URL, and a URL is an OpenID Connect issuer: the host discovers its metadata and asks its `userinfo` endpoint who a token belongs to.
`github` is the same verifier with the endpoint fixed at `https://api.github.com/user` and the subject taken from `login`, because GitHub's OAuth has no discovery document and no `sub`.
Both are one implementation of the same question, so a deployment names the issuer it has and the host does the same thing either way.

A token is checked by asking the issuer's `userinfo` endpoint rather than by verifying a JWT locally: it works for GitHub, which issues opaque tokens, and for an OpenID Connect issuer that supports the endpoint, without a signing-key dependency or a key cache in this repository.
A discovered `userinfo` endpoint must be https, because the issuer is a value from a remote document and following a plain-http one would send a person's token somewhere it should not go.

## Consequences

An operator with GitHub configured gets a stock client working; an operator with an enterprise issuer names it and gets whichever clients support that issuer.
Verification costs one network call to discover the metadata (once, cached on success) and one per sign-in attempt, which the host makes only after no local secret matched.
A provider that does not publish `userinfo` cannot be used, which excludes some OpenID Connect deployments; the local directory remains the answer for them, and a later plan can add local JWT verification with a key set.
Nothing verifies the token's audience or scopes beyond the issuer having answered for it, because `userinfo` answers for a token it accepts and the host trusts the issuer it was configured with.

## Options

- **GitHub only.** Rejected: it is the one that needs no client work, but it makes every deployment's identity a GitHub account, which is the opposite of what an issuer option is for.
- **Verify JWTs locally against the issuer's key set.** Rejected for now: it is the smaller network cost and the larger code, needing JOSE parsing, a key cache and clock handling, and it does not help GitHub at all. It is the natural second verifier behind the same option.
- **A free-form token endpoint plus a field name.** Rejected: it is a configuration language for what two named kinds already cover, and the two kinds are the ones clients actually resolve.
