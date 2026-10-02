---
title: A request that names no team and project uses the person's primary
status: accepted
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L115](../../packages/sdk/src/types/users.ts#L84-L115) - `UserRecord`, where `primary` goes"
---

## Context

A proxy request can name its team and project in a header or a query string, and an AHP session through a picker.
Some harnesses can set neither a header nor a query string.

## Decision

A person may have a `primary` membership, a concrete `team:project` or `team` that is one of their memberships, and set it themselves.
A request that names a scope must match one of the person's memberships, or it is refused; the primary is not a fallback for a wrong one.
A request that names none uses the primary; with no primary, it uses the person's only concrete membership, and with several it is refused, listing what can be named.
Source: Softov, 2026-10-01, asked "A user with several memberships sends a request naming none. What happens?": "use the users primary.... like luiz is working on ahpd... so default project and default team. so harnesses that does not support custom header or custom query strings could use the default one setted by the user. but only if user not informmed.. if informmed wrong is invalid. if not informed and no default.. its the same as first... no default."

## Consequences

A harness pointed at the proxy with only a key and a base URL is charged to the person's primary.
Moving to another project is one command for the person, not a header for every tool.

## Options

- **Refuse whenever nothing is named and there is more than one membership**: rejected, it locks out harnesses that cannot send a header.
- **A default team and a default project as two fields**: rejected, together they could name a pair the person does not belong to.
