---
title: A devcontainer source may name any allowed folder, not only the session's own
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/plugin.ts#L471-L505](../../packages/computer/src/plugin.ts#L471-L505) - the `devcontainer://` create, which reads the folder from the setting"
  - "[code://packages/computer/src/plugin.ts#L685-L693](../../packages/computer/src/plugin.ts#L685-L693) - the picker row, offered for the session's own folder"
---

## Context

The picker offers `devcontainer://<folder>` for the asking session's own folder, but a session setting, an automation or a client may name any folder.
The create does not compare the folder with the session's working directory.

## Decision

A `devcontainer://<folder>` setting may name any folder the operator's dev container allowlist allows; it is not tied to the session's own folder.
The picker still offers the row for the session's own folder only.
Source: Softov, 2026-09-26, asked "Should `devcontainer://` accept any folder, or only the session's own folder?": "any folder, within that allowlist".

## Consequences

A session can run in the container of a sibling repository without the picker having offered it.
The allowlist in [a dev container is made only from a folder the operator allows](a-dev-container-is-made-only-from-a-folder-the-operator-allows.md) is the only gate on the folder.

## Options

- **Only the session's own folder.** Rejected: the allowlist already bounds what can be named, and a second rule would refuse a setting the operator allowed.
