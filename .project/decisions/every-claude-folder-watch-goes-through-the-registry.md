---
title: Every Claude folder watch goes through the registry, not only the personal folder's
status: accepted
date: 2026-11-09
refs:
  - "[code://packages/agent-claude/src/session/watch.ts#L96-L108](../../packages/agent-claude/src/session/watch.ts#L96-L108) - `opened`, the one place a watcher opens a handle"
  - "[code://packages/agent-claude/src/session/watch.ts#L162-L178](../../packages/agent-claude/src/session/watch.ts#L162-L178) - the personal scope, the project scope and the working directory"
---

## Context

The personal folder is the one every probe and every session watches.
Sessions in the same project also watch that project's `.claude` and its working directory once each.
A scope that is not there yet is watched for from its parent folder.

## Decision

Every handle the watcher opens goes through the registry: the personal scope, each project's `.claude`, the working directory, and the parent watch of a scope that is not there yet.
Source: Softov, 2026-11-09, asked which folders should be shared: "Every folder".

## Consequences

N sessions in one project hold that project's handles once.
All of the watcher's handles go through one path in `opened`, so there is no second way to open one.

## Options

- Share only the personal scope, the one watched K + N times: a smaller change, but N sessions in one project would still watch it N times.
