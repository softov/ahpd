---
title: ahpd and ahpc share no package, and carry deliberate copies instead
status: accepted
date: 2026-09-18
refs:
  - code://.project/ideas/deliberate-duplication.md - the idea this restates, the first instance
  - git://ff332ad - the fixture and the runner that check the first copy
  - code://packages/sdk/src/resources.ts#L225 - the comment that names the other copy
  - https://github.com/softov/ahpc - the client, which does not depend on `@ahpd/sdk`
---

## Context

`resourceWrite` is symmetrical, so both repositories implement the whole of it.
`ahpc` does not depend on `@ahpd/sdk` and is not going to, because a client that imports the host's SDK is a client tied to one host.
The update check is the second thing both need in the same shape.

## Decision

Anything both repositories need is written twice, each copy carrying a comment naming the other.
Where the two copies must agree, a fixture checked into both repositories byte for byte runs against each, and each CI diffs the other's copy over HTTP.
No shared package is created for it.

Source: Softov, ROADMAP.md "Deliberate duplication", 2026-09-06, restated for this plan on 2026-09-18.

## Consequences

The update check's version comparison gets a fixture of its own in both repositories, or the same table in both test files.
A change to one copy is a change to make in the other repository the same day.

## Options

A third package (`@softov/versioncheck` or similar) would be one more thing to publish, approve and pin, for two functions.
