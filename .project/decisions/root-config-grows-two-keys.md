---
title: The root config grows the artifact prompt switch and deferred title generation
status: accepted
date: 2026-09-19
refs:
  - code://packages/sdk/src/host.ts#L3358-L3372 - `ROOT_CONFIG_SCHEMA`, which declares `defaultShell` and nothing else
  - code://packages/sdk/src/sessiontools.ts#L497 - `rename_chat` today, always offered and always carrying `automatic`
  - src/vs/platform/agentHost/common/artifactToolsConfiguration.ts - the window setting mapped onto the artifact key, inside the clone
  - src/vs/platform/agentHost/common/agentHostSchema.ts#L549-L575 - the root keys the reference declares, inside the clone
---

## Context

The window forwards a host's own root configuration: a VS Code setting carries an `agentHost: { key }` mapping, and the settings document it builds is made from the root config the host declares, so a key this host does not declare is a key nothing can set.
Two keys became relevant in the pass at `.project/review/2026-09-19-upstream-pass-4.md`: `artifactToolsCompactPrompts`, which selects a shorter wording for the artifact tools and changes no availability, and `deferredTitleGeneration` with the title strategy that follows it, under which `rename_chat` is refused for a utility strategy and loses its `automatic` property when generation is deferred.
This host declares neither, and its `rename_chat` is fixed.

Asked on 2026-09-19 which keys to declare, the answer was: "Both, and implement deferred title generation too."

## Decision

`ROOT_CONFIG_SCHEMA` declares both keys.
`artifactToolsCompactPrompts` selects between the current artifact instruction and a compact wording.
`deferredTitleGeneration` turns on titled-by-request behaviour: a session's title generation strategy becomes visible to the tool layer, `rename_chat` is not offered under a utility strategy, and under a deferred one it drops its `automatic` property and is re-described.

## Consequences

The window's two settings stop being inert, and a person can choose the short artifact wording and deferred titles the way they can against the reference host.
Deferred generation is the larger half: it adds a strategy to a session and a scheduling decision about when a title is asked for, which is more than a schema declaration and has to be built rather than declared.
Declaring a key is a promise that pushing it changes something, so both keys need a behaviour behind them, and a key declared without one is a bug rather than a stub.

## Options

Declaring only `artifactToolsCompactPrompts` was rejected by the answer above: it is the smaller change and it leaves deferred titles unavailable here.
Declaring neither was rejected: the settings exist in the window and would map to nothing, which is the state this decision ends.
