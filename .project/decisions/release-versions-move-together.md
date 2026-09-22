---
title: Every published package carries the tag's version
status: accepted
date: 2026-09-22
refs:
  - code://.github/workflows/release.yml - the tag check and the two package loops this settles
  - code://packages/agent-cofold/package.json - a new package that moved onto the tag version
  - code://packages/agent-acp/package.json - the other one
  - code://packages/sdk/package.json - the version the rest follow
  - code://docs/PLUGINS.md - where the two agents are documented as plugins
---

## Context

`release.yml` publishes from one tag: it checks that the tag equals every package's version and stages each one at that version.
`packages/agent-cofold` and `packages/agent-acp` were built this session as `private: true` packages at `0.0.1`, and preparing them for release raised the question the workflow could not answer: a brand-new package at `0.1.0` does not equal a tag of `0.6.2`, so a single tag could not release five packages whose versions disagreed.

## Decision

Every package this repository publishes carries the tag's version.
Both agents moved to `0.6.2` with `sdk`, `agent-claude` and `server`, and `release.yml` now checks five versions, packs five tarballs, stages five and lists five on the approval page.
`git tag v0.6.2 && git push --tags` releases the whole set, and no second tag scheme or second job exists.

Source: the user, 2026-09-22, choosing between the listed options: "Move both agents onto the tag version".

## Consequences

A new package's first published version is the current repository version rather than `0.1.0`, so the number says what the whole tree says and not what the package has lived through.
`release.yml` names the five packages in three places - the tag check, the staging loop and the rehearsal loop - and all three have to move together when a package is added or renamed.
The agents' `peerDependencies["@ahpd/sdk"]` stays `^0.6`, which `0.6.2` satisfies, so the range did not have to move with them.
`HANDOFF.md` records the flow: tag, then approve the five staged versions in order, `sdk` first.

## Options

- **Move every package onto the tag version**, which is the direction taken.
- **Stage the agents at their own `0.1.0` in a second job.**
  Rejected: one tag would then release two different versions and the approval page would mix them, and the workflow would need a guard against re-staging a version already on npm.
- **Give the agents their own tags**, such as `agent-acp-v0.1.0`.
  Rejected: it is a second release process for two packages that ship from the same commit and the same SDK version as the rest.
- **Leave the workflow and publish the two agents by hand once.**
  Rejected: it makes the release path depend on somebody remembering the exception, and the next agent package repeats it.
