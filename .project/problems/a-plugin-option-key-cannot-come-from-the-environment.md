---
title: A plugin option's key cannot come from the daemon's environment
status: open
date: 2026-11-11
severity: minor
refs:
  - "[code://packages/server/src/plugins.ts#L1210-L1250](../../packages/server/src/plugins.ts#L1210-L1250) - a plugin option resolves a `$secret` and nothing else"
  - "[code://packages/sdk/src/channels/owners.ts#L400-L470](../../packages/sdk/src/channels/owners.ts#L400-L470) - a host record resolves a `$secret` and a `fromEnv`"
---

## Symptom

A test daemon at `7cf919e4b` on 2026-11-11 had `@ahpd/agent-cofold` with `"apiKey": { "fromEnv": "OPENROUTER_API_KEY" }` in its options.
The log said "plugin agent-cofold skipped: plugins.agent-cofold.options.apiKey must be text", and no cofold agent was offered.

## Cause

A host record's secret field takes `{ "$secret" }` or `{ "fromEnv" }`. A plugin option takes `{ "$secret" }` only, and the schema check then sees an object where it wants text.

## Impact

An operator who keeps keys in the daemon's environment writes them into the vault for a plugin option, and not for a record.
One wrong option skips the whole plugin, so every agent of its engine goes.

## Workaround

`ahpd vault set host:<name>`, and `{ "$secret": "host:<name>" }` in the option.

## Fix

Candidates, none chosen: read `fromEnv` in plugin options as host records do; or say in the docs that a plugin option takes `$secret` only.
