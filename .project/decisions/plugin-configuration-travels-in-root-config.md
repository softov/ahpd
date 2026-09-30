---
title: A plugin's configuration travels in root config, not in customizations
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/sdk/src/host.ts#L4954-L5044](../../packages/sdk/src/host.ts#L4954-L5044) - `rootConfig`, `ROOT_CONFIG_SCHEMA` and `rootState`"
  - "[code://packages/sdk/src/host.ts#L8086-L8145](../../packages/sdk/src/host.ts#L8086-L8145) - the `root/configChanged` handler"
  - "[code://packages/server/src/commands/options.ts#L117-L263](../../packages/server/src/commands/options.ts#L117-L263) - `serverFields` and `configSchema`, the daemon keys"
---

## Context

A client should be able to show a form for the daemon's own settings and for each plugin's options, and send it back.
The protocol has three configuration schemas: root config for the host, session config for one session, and a `configSchema` per model.
An agent as a provider has none, and customizations are what one agent session loads (skills, agents, MCP servers), read per session.

## Decision

The daemon's settings and every configured plugin's `enabled` and options are keys of root config.
A client draws them from `state.config.schema` and writes them with `root/configChanged` on `ahp-root://`.

Source: Softov, 2026-09-29: "So its a plan for server config, plugin expose type object with its name and they config... could be used instead customizations.. so we can disable the plugin.. enable it. create acp etc? I think that's the intent of root config... and not customizations".

## Consequences

One form serves the daemon and its plugins, and creating an ACP agent is adding an entry to agent-acp's options.
VS Code draws a host's declared root config keys as settings, so these keys reach VS Code too.
Root config reaches every connection, so who sees these keys and which values never leave the host are decided separately.

## Options

- **Customizations**: per session and loaded by the agent, so a plugin that is off has nowhere to be turned on.
- **An ahpd-only channel or HTTP form**: a second schema format and a second write path beside the one the protocol has.
