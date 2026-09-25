---
title: The computer is versioned with the release and not published by it
status: superseded
superseded-by: decisions/the-whole-workspace-is-published.md
date: 2026-09-23
refs:
  - code://.github/workflows/release.yml - `PUBLISHED`, and the tag check that still names six
  - code://packages/computer/package.json - the package that stays unpublished
  - code://.project/plans/plugin/09-computer-provider/implemented.md - what is built and what is not
  - code://docs/COMPUTER.md - the operator's half, which is ahead of the provider
---

## Context

`@ahpd/computer` is a sixth workspace package at the tag's version, and `release.yml` was widened to stage six when it arrived.
It has never been published, which means the one thing the workflow cannot do for itself: npm configures a trusted publisher on a package, so a name with no first version needs one token publish and a 2FA approval before OIDC can stage anything.

The package is also the least proven of the six.
Its provider is not wired to a live machine, no container or VM has been started by it through the scheme, and the parts that would be tested need a hypervisor or a Docker daemon.
Publishing it now would put a version on npm that nothing has run.

The user, 2026-09-23: "not a task... if released is without the computer... since its not tested."

## Decision

One tag stages the five packages that have been published, named once in `PUBLISHED`, and `@ahpd/computer` is not among them.
It stays in the workspace at the tag's version and the tag check still names six, so its version does not drift and the step that says "these move together" stays true.
Publishing it later is one line in `PUBLISHED` and the token bootstrap, in that order.

## Consequences

`0.6.4` has no token bootstrap and no 2FA step in the middle of an OIDC release, which is what the workflow was built for.
`@ahpd/computer` can be changed, broken and rebuilt without a release decision, and nothing on npm is stale for it.
The package is one release behind by construction: it will first publish at whatever tag is current when it is tried, not at the tag it was built under.
The tag check naming six while five are staged is a deliberate mismatch to keep in mind: a version bump for every package still happens together.

## Options

- **Publish it now, with the token bootstrap.** Rejected: an untested version on npm is a version somebody can install and depend on, and the bootstrap needs a 2FA approval for no benefit yet.
- **Mark the package `private: true`.** Rejected: it leaves the publish list and the tag check with it, so the version stops moving with the tag and the workspace quietly has a package nobody remembers to release.
- **Give it its own tag and workflow.** Rejected: a second release process for one package that ships from the same commit and the same SDK as the rest, which is the option `release-versions-move-together` already rejected once.
