---
title: A grant is a subject and a verb
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/types/users.ts#L21-L32](../../packages/sdk/src/types/users.ts#L21-L32) - `Capability` and `Grant`, the six areas and the scheme-scoped pair this replaces"
  - "[code://packages/sdk/src/host.ts#L137-L175](../../packages/sdk/src/host.ts#L137-L175) - `NEEDS`, one grant per method, where listing and acting share a name"
  - "[code://packages/sdk/src/host.ts#L220-L226](../../packages/sdk/src/host.ts#L220-L226) - `dispatchNeeds`, keyed by channel"
  - "[code://packages/sdk/src/host.ts#L4621-L4637](../../packages/sdk/src/host.ts#L4621-L4637) - `capabilityFor`, which derives a scheme-scoped grant from a URI"
  - "[code://packages/sdk/src/users.ts#L21-L24](../../packages/sdk/src/users.ts#L21-L24) - the built-ins, and `principalOf`, whose `can` is a set lookup"
  - https://www.rfc-editor.org/rfc/rfc6749#section-3.3 - a scope is one or more strings, which is the whole of what OAuth says about their grammar, so the grammar is a convention rather than a rule
---

## Context

A capability is one of six areas, and an area has one grant. So listing and acting are the same permission: `listSessions` and `createSession` both need `session`, `listAutomationTriggerDefinitions` and `runAutomation` both need `automation`. A role that may look at something must also be able to do it.

`read` and `write` look like verbs, and were, but they mean files: resource methods are the only ones that carry a URI, and `capabilityFor` derives `read:<scheme>` or `write:<scheme>` from it. Everything else is an area name with no verb at all.

That leaves no way to ask for what an operator actually wants: a person who sees the sessions and the automations and can change nothing. Adding a seventh area (`watch`) would cover the two list methods but not `terminal:read`, and it keeps the shape that made this awkward.

The convention for a scope string is a subject and a verb, verb last: `contents:read` and `issues:write` in GitHub Apps, `channels:read` and `chat:write` in Slack, `s3:GetObject` in IAM, `charges_read` in Stripe. Verb-first appears in GitHub's legacy OAuth list (`read:org`) beside subject-first entries in the same list (`repo:status`, `user:email`), so it is not a convention at all. AHP itself says nothing about authorization; its one related field is `ProtectedResourceMetadata.scopes_supported`, which is an OAuth scope list.

## Decision

A grant is `<subject>:<verb>`, with the verb last.
The verbs are `read` and `write`.
The subjects are the host's own five - `file`, `session`, `automation`, `terminal`, `diagnostics` - and a plugin's URI scheme, which is what the scheme-scoped grant was already for.
`*` is allowed in either position: `*:read` is every subject's read, `session:*` is every verb on sessions, and `*:*` is everything.
There are no bare tokens: `read` becomes `file:read` and `write` becomes `file:write`, and `read:computer` becomes `computer:read`.
The built-ins become `admin` = `*:*`, `member` = `file:read`, `file:write`, `session:read`, `session:write`, `terminal:read`, `terminal:write`, and `guest` = `session:read`, `automation:read`.
`ahpd user add` with no `--role` adds a `guest`, and a role that is neither built in nor defined in the file is refused rather than accepted and resolved to nothing.

## Consequences

An operator can say "look but do not touch" per area, and `terminal:read` - watching a shell's output without typing into it - becomes expressible at all.
`admin` becomes genuinely everything, including a plugin's scheme, where before even an admin had to name `read:computer`. That is a real change and the one to want from a role called admin.
Every existing role has to be rewritten, and the six capability names stop existing. The packages are pre-1.0 and the file is the only place roles live, so the migration is the built-ins and the docs.
The gate maps each method to a pair rather than to an area, so `NEEDS` stops reading as a list of areas. The URI-derived scoping stays, now spelled `<scheme>:read` and `<scheme>:write`.
A grant whose shape is wrong is reported once and dropped, rather than sitting in a file looking like a permission.

## Options

- **Keep the six areas and add `watch`.** Rejected: it covers sessions and automations and not terminals, and it leaves the shape that could not say "list but do not run" in the first place.
- **Grant by method name.** Rejected: the type's own comment says a capability is deliberately not a method name, so that a renamed handler does not silently move who may call it.
- **Verb first, keeping `read:computer`.** Rejected: that is the spelling this repository invented, and the convention is the other way round.
- **Bare `read` and `write` as aliases for the file pair.** Rejected: two spellings for one thing is how a role ends up meaning something nobody intended, and every role is being rewritten anyway.
