---
title: "@cofold/tools is released as 0.1.x with a ^0.1 peer range, and ahpd takes ^0.1"
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/package.json#L61-L66](../../packages/agent-cofold/package.json#L61-L66) - `@cofold/tools` at `^0.0.1`, which is exactly 0.0.1"
  - "file:///github/cofold/packages/tools/package.json - version `0.0.1` and a peer requirement of exactly `0.1.0` on `@cofold/agents`"
---

## Context

`^0.0.1` matches only 0.0.1, so ahpd never picks up a fix to `@cofold/tools` without a manifest edit.
`@cofold/tools` peer-requires `@cofold/agents` at exactly `0.1.0`, while ahpd asks for `^0.1.0`, so an agents patch release would break the peer requirement.

## Decision

`@cofold/tools` is released as 0.1.x, with a `^0.1` peer range on `@cofold/agents`, and `@ahpd/agent-cofold` depends on `@cofold/tools` at `^0.1`.
The release is Softov's.
Source: Softov, 2026-09-26, asked "How should `@cofold/tools` be pinned: `^0.0.1` (which is exactly 0.0.1), a wider range, or a 0.1.x release that lines up with `@cofold/agents`, whose exact `0.1.0` peer requirement a `^0.1.0` range can outgrow?": "Release tools 0.1.x".

## Consequences

A patch to either package reaches ahpd through its lockfile without a manifest change.
The first 0.1.x release of `@cofold/tools` carries the fixes of this plan's cofold task.

## Options

- **Keep `^0.0.1`.** Every fix needs a manifest edit, and the exact peer requirement stays.
- **A wider range on 0.0.x.** Semver gives a 0.0.x caret no room, so it would have to be a hand-written range.
