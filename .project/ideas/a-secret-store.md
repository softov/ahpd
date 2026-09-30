---
title: A plugin's secret options live in a secret store, not in the config file
created: 2026-09-29
---

Raised with daemon/11, which keeps a secret option as plain text in `config.json`, as it is today, and never sends its value to a client.

A secret option would be written to a store of its own, and `config.json` would hold a reference in its place, such as `{ "$secret": "agent-cofold.apiKey" }`. The daemon resolves the reference when it loads the plugin, so the plugin still receives the value.

## What it would buy

- `config.json` can be shared, copied into a machine or committed without carrying a key.
- A key is changed in one place for every plugin that names it.

## Questions it leaves

- Where the store lives: a file beside `config.json` with tighter permissions, the operating system's keychain, or both.
- Whether a reference to an environment variable (`{ "env": "NAME" }`) is enough on its own, and cheaper.
- What `ahpd plugin config` shows for a secret: only whether it is set.
