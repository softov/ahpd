---
title: A plugin starts a session as a named owner, through the steps an automation's run takes
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/automations.ts#L657-L732](../../packages/sdk/src/host/automations.ts#L657-L732) - an automation's run starts a session as its owner"
  - "[code://packages/sdk/src/types/plugin.ts#L358](../../packages/sdk/src/types/plugin.ts#L358) - `startSession` on `PluginHost`, through which a plugin starts a session as an owner"
---

## Context

The bot plugin starts a session when a bot is made.
`PluginHost` has no method for it.
An automation's run already starts a session as its owner, with the owner's grants and policies checked.
plugin/20 plans a plugin as a client of its host, as the principal `plugin:<name>`.

## Decision

`PluginHost` gains `startSession`, which starts a session as the owner it is given, through the same steps an automation's run takes.
Those steps move into one function that both call.
Source: (defaulted: the bot's session belongs to the person who made the bot, and plugin/20's sessions belong to the plugin).

## Consequences

A bot's session is listed, charged and gated as its owner's, like a session that person made.
A plugin that holds `startSession` can act as any owner it names.
Only a plugin the host loads gets it, as with every other `PluginHost` method.

## Options

- **plugin/20, a plugin as its own principal**: not taken here, its sessions are owned by `plugin:bot`, not by the bot's maker.
