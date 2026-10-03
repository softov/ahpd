---
title: A shared target is refused at create only when what lands there differs
status: accepted
date: 2026-10-03
supersedes: decisions/a-need-and-a-mount-at-one-target-are-refused.md
refs:
  - "[code://packages/computer/src/manifest.ts#L595-L605](../../packages/computer/src/manifest.ts#L595-L605) - the target check among needs, by target alone"
  - "[code://packages/agent-claude/src/claude.ts#L373-L397](../../packages/agent-claude/src/claude.ts#L373-L397) - every Claude variant of one load declares the same needs"
---

## Context

Every mount a machine would carry is checked for a shared target at create, and a shared target is refused.
Two Claude variants on one profile declare the same needs, so the check refuses a machine where nothing conflicts.

## Decision

Mounts and needs that land at one target and are the same (kind, source, target, `readOnly`) are one entry.
A shared target is refused at create, with a sentence naming both, only when what lands there differs.
Source: Softov, 2026-09-26, asked "A profile mount and a need at the same target: refuse at create, or let the profile's mount win and drop the need?": "refuse at create"; Softov, 2026-10-03, asked whether Claude variants share their state: "Share; dedupe identical needs".

## Consequences

Variants of one plugin share one state on a profile.
A profile that mounts Claude's configuration by hand at the need's target with the same source keeps working; with a different source it is refused.

## Options

- Refuse any shared target: two variants of one plugin cannot share a profile.
- Keep a separate state per variant at `/ahpd/<provider>`: each variant signs in on its own.
