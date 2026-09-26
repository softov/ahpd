---
title: A need and a mount at one target are refused at create
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/manifest.ts#L578-L600](../../packages/computer/src/manifest.ts#L578-L600) - the target check among needs, and the mount list the needs are appended to"
  - "[code://packages/computer/src/runtime.ts#L630-L634](../../packages/computer/src/runtime.ts#L630-L634) - every mount and the folder, as `-v` flags"
---

## Context

Two needs landing on one target are refused at create.
A need and a mount from the plugin, the profile or the body landing on one target are not compared, and Docker refuses the container with "Duplicate mount point" after the host has accepted it.

## Decision

Every mount a machine would carry (the plugin's, the profile's, the body's, the needs' and the session folder) is checked for a shared target at create, and a shared target is refused with a sentence naming both.
Source: Softov, 2026-09-26, asked "A profile mount and a need at the same target: refuse at create, or let the profile's mount win and drop the need?": "refuse at create".

## Consequences

A profile that mounted Claude's configuration by hand and now names `claude` in `agents` has to drop the hand-written mount or point the need at it.
The docs stop saying that a later mount wins.

## Options

- **The profile's mount wins and the need is dropped.** A profile keeps working unchanged, and the agent's own need is silently replaced.
