---
title: The root config declares every key VS Code pushes, as the reference declares it, and keeps every key a client pushes
status: accepted
date: 2026-11-07
refs:
  - git://c6634b2b6 - the superseded decision, as committed
  - "[code://packages/sdk/src/host/actions.ts](../../packages/sdk/src/host/actions.ts) - the `root/configChanged` handler, which applies every key it is sent"
  - "[code://packages/sdk/src/host/root.ts](../../packages/sdk/src/host/root.ts) - `rootConfig`, which keeps everything pushed, and `ROOT_CONFIG_SCHEMA` with VS Code's properties"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L176-L193 - the client pushing every mirrored setting at connect, whatever the host declares
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2878-L2898 - the host applying a root patch whatever keys it carries, a patch that changes nothing skipped
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1371-L1399 - the host restoring its persisted values at a start schema by schema, so the declared keys alone come back
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2830-L2840 - a remote client's change to a property the host holds read-only, refused
---

## Context

VS Code pushes about forty settings into root config on every connect, by `root/configChanged`.
It pushes them whether or not the host declares them.
The host keeps one root config for every window connected to it.
A client draws a setting from the property the schema declares for it.
It reads back the value the root holds.

## Decision

The root config schema declares every key a VS Code client pushes into it.
Each takes the property the reference host declares for that key, as upstream wrote it.
A key is declared whether or not ahpd acts on it.
Every key a `root/configChanged` carries is applied and kept, declared or not, as VS Code's host applies a root patch.
What the host has, a client learns from the declared properties.
A start brings back the declared keys alone, as VS Code's host restores its persisted values by its schemas.
The daemon's keys come back from its configuration file, and the host's own from each window's next push.
A backend's account is the harness's to say.
A push that moves one is refused in the words VS Code's host uses for a read-only property.
Those words are "Host configuration property is read-only: <key>".
VS Code removed `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `activeAgentTitleGeneration` before the checkpoint, so none is declared.
A client older than that has them kept as it pushed them, values no control is drawn for.

Source: the host audit's row P2BJ-0059: "a client's root/configChanged applied with every key it carries, as VS Code's host applies it".
It was built on the coordinator's word of 2026-11-07.
That word reads both reasons for refusing an undeclared key as met by the schema in VS Code's pattern.
One reason was that every value has a property.
The other was that a key from a newer or older client reads as no setting the host has.
In VS Code's pattern a client learns what the host has from the declared properties.
Source for the declarations: Softov, 2026-10-03: "Declare them, as upstream".
Source for the removed keys: Softov, 2026-10-03: "Follow upstream".

## Consequences

A client newer or older than the schema has every key it pushes applied and echoed.
Its patch reaches the host whole.
A declared key is no promise of behaviour: `automationsEnabled` says what VS Code means by it.
ahpd's automations run whatever it holds.
A value with no property is one a settings screen draws no control for.
A later VS Code that adds a pushed key has it kept until the next UPSTREAM.md pass declares it.

## Options

- **Refuse a key nobody declares** (git://c6634b2b6): every value has a property. A newer or older client's keys are lost.
- **Keep and broadcast everything, declare nothing more**: the forty settings VS Code declares have no property.
- **Declare only the keys ahpd acts on**: most of what VS Code pushes has no property to draw it from.
