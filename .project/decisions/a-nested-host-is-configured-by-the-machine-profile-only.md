---
title: A nested host is configured by the machine's profile only
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/plugin.ts#L422-L434](../../packages/computer/src/plugin.ts#L422-L434) - `nestedHost`, which starts `<host> --stdio --plugin <each>` with no plugin options"
  - "[code://packages/agent-cofold/src/plugin.ts](../../packages/agent-cofold/src/plugin.ts) - `optionsOf`, the options the outer host's cofold plugin was given"
  - "[code://.project/decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md](cofold-config-reaches-a-machine-at-a-fixed-target.md) - how cofold's configuration and keys reach the machine"
---

## Context

The outer host loads its backend plugin with options (`baseUrl`, `model`, `tools`, `store`, a renamed `provider`), and the nested host inside a machine is started with `--plugin <spec>` and nothing else.
None of those options reach the inner host, which loads the plugin with its defaults and reads what the machine holds.

## Decision

Nothing beyond the machine's profile reaches the inner host: it loads its plugin with its defaults, and reads cofold's configuration from where the profile's needs mount it.
Source: Softov, 2026-09-26, asked "What of the outer plugin's options (`baseUrl`, `model`, `tools`, `store`, a renamed `provider`) reaches the inner host: serialized into the `--plugin` spec, a config file in the machine, or nothing beyond the profile?": "Profile only".

## Consequences

A machine behaves the same whichever outer host starts a session in it, because its configuration is its profile and what that mounts.
An outer option that should hold inside a machine belongs in cofold's configuration file, which [reaches the machine at a fixed target](cofold-config-reaches-a-machine-at-a-fixed-target.md), not in the outer plugin's options.
The inner host registers the backend under the plugin's default provider name, so the proxy creates the inner session under the provider the inner host serves, not the outer one's name.

## Options

- **Serialize the outer options into the `--plugin` spec.** The inner backend matches the outer one, but options such as `store` name paths on the outer host, and the argv is visible in the machine's process list.
- **Write a config file into the machine.** Keeps argv clean, but is a second copy of the outer configuration to keep in step.
