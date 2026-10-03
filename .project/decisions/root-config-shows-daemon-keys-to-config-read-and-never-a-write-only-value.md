---
title: Daemon and plugin keys reach only connections with config:read, and a write-only value never leaves the host
status: accepted
date: 2026-09-29
supersedes: decisions/served-answers-hide-plugin-option-values-and-url-credentials.md
refs:
  - "[code://packages/sdk/src/host.ts#L1655-L1674](../../packages/sdk/src/host.ts#L1655-L1674) - `seenBy`, the per-connection envelope"
  - "[code://packages/server/src/commands/config.ts#L24-L44](../../packages/server/src/commands/config.ts#L24-L44) - `withoutOptionValues` and `withoutSecrets`, the served masks"
  - https://json-schema.org/draft/2020-12/json-schema-validation#section-9.4 - `writeOnly`
---

## Context

Root state reaches every signed-in connection, a guest included.
The served answers mask every plugin option value as `<set>`, so a form built from them could never show a current value.
Only some options are credentials: an API key, a webhook secret.

## Decision

The daemon and plugin keys of root config, schema and values, reach only a connection that holds `config:read`; others see the host's own keys as today.
A property whose schema says `writeOnly: true` is answered as `<set>` when it has a value, in root state and in every served answer, and any other plugin option is answered as the file holds it.
`connectionToken` and the userinfo of a plugin spec written as a URL stay `<set>`, as before.
A write-only value is kept in `config.json` as plain text, as today.

Source: Softov, 2026-09-29, asked "Who sees the daemon and plugin keys in root config?": "config:read holders"; asked "How should secret plugin options work in root config?": "Write-only"; asked how they are stored on disk: "plain file as today.. proposal or idea for a vault".

## Consequences

A form shows every current value but a secret, and a secret can be replaced without being read.
A plugin author marks each credential `writeOnly` in its options schema; an unmarked credential is shown to `config:read`.
A secret store is [vault/01](../plans/vault/01-secrets-live-in-a-vault/plan.md).

## Options

- **Everyone signed in sees the keys**: a guest reads the host's paths and plugin options.
- **Every option value stays `<set>`**: the form can set a value but never shows one.
