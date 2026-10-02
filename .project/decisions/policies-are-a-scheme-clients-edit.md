---
title: Policies are kept behind a port and edited through a policy scheme
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/people.ts](../../packages/sdk/src/people.ts) - the people schemes a client lists and edits, the pattern this follows"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - the rules draft the row shape comes from"
---

## Context

A policy says which agents, computers and models a person may use, and how much.
Someone has to write them, and a host may want them in a database later.

## Decision

Policies are rows behind a `policies` port, with a file store in the config folder as the default, served as a `policy:` resource scheme a client lists, reads and writes under `policy:read` and `policy:write`.
Source: Softov, 2026-10-02, asked "How are policies written and changed?": "A policy: scheme".

## Consequences

A client such as ahpapp edits policies the way it edits people, and a sqlite or postgresql plugin can take the port over.
The scheme and its grants exist from the first plan, before any limits are enforced.

## Options

- **A hand-edited file, scheme later**: rejected.
