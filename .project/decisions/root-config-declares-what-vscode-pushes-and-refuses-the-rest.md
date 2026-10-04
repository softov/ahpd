---
title: The root config declares every key VS Code pushes, as the reference declares it, and refuses a key nobody declares
status: accepted
date: 2026-10-03
supersedes: decisions/root-config-grows-two-keys.md
refs:
  - "[code://packages/sdk/src/host.ts#L6087-L6116](../../packages/sdk/src/host.ts#L6087-L6116) - `rootConfig`, which keeps everything pushed, and `ROOT_CONFIG_SCHEMA`, which declares three keys"
  - "[code://packages/sdk/src/host.ts#L9852-L9990](../../packages/sdk/src/host.ts#L9852-L9990) - the `root/configChanged` handler, which applies every key it is sent"
  - "git://7516b04bc94 - VS Code 1.140, the UPSTREAM.md checkpoint: `platformRootSchema` (`src/vs/platform/agentHost/common/agentHostSchema.ts#L806-L1030`), `agentMergeRootConfigSchema` (`common/agentMerge.ts#L159-L197`), `automationRootConfigSchema` (`common/automationConfig.ts#L14-L26`)"
  - "git://7516b04bc94 - `src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L170-L190`, the client pushing every mirrored setting whatever the host declares"
  - "git://7516b04bc94 - `src/vs/platform/agentHost/node/agentConfigurationService.ts#L490-L540`, the reference restoring only declared keys at start, key by key"
  - git://45dd7fa1f8b - VS Code removing the compact artifact prompt experiment and its `artifactToolsCompactPrompts` key
  - git://3b2b948b52d - VS Code removing `deferredTitleGeneration` and `activeAgentTitleGeneration`, deferred titles becoming the default
---

## Context

VS Code pushes about forty settings into root config on every connect, by `root/configChanged`, whether or not the host declares them.
ahpd keeps every pushed key in `rootConfig` and shows it in `values`, while its schema declares three, so a client reads values with no property to draw them from.
The decision this replaces said a declared key is a promise that pushing it changes something, and a key declared without behaviour behind it is a bug.

## Decision

The root config schema declares every key a VS Code client pushes into it, with the property the reference host declares for that key: its title, type, default and description as upstream wrote them, whether or not ahpd acts on the key.
A `root/configChanged` key that neither the host's schema nor the daemon's declares is refused: it is not applied, not kept and not echoed.
`artifactToolsCompactPrompts`, `deferredTitleGeneration` and `activeAgentTitleGeneration` are not declared, because VS Code removed them before the checkpoint: the compact artifact wording goes, and deferred titles are every session's strategy with no key to change it.

Source: Softov, 2026-10-03, asked "what happens to the ~40 settings VS Code pushes into root config ... that ahpd stores and broadcasts but declares no schema for?": "Declare them, as upstream".
Source for the removed keys: Softov, 2026-10-03, asked "VS Code dropped both keys before the checkpoint: the compact-prompt experiment was removed (git://45dd7fa1f8b, 2026-09-23), and deferred titles became the default with no setting (git://3b2b948b52d, 2026-09-25). What should ahpd do?": "Follow upstream".

## Consequences

Every value a client reads has a property, so a settings screen can draw every row, and a key pushed by a client newer or older than the schema stops reading as a setting the host has.
A declared key is no longer a promise of behaviour: `automationsEnabled` says what VS Code means by it, and ahpd's automations run whatever it holds.
A later VS Code that adds a pushed key has it refused until the schema is brought up to the next UPSTREAM.md pass.

## Options

- **Keep and broadcast everything, declare nothing more**: the state this decision ends, values with no property.
- **Drop undeclared keys without declaring VS Code's**: the window's settings would be refused by a host that has room for them.
- **Declare only the keys ahpd acts on**: the replaced decision's rule, under which most of what VS Code pushes would be refused.
