---
title: A fixed key is shown read-only once the session runs
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/host.ts#L2615](../../packages/sdk/src/host.ts#L2615) - the schema a running session publishes"
  - "[code://packages/sdk/src/host.ts#L3203-L3211](../../packages/sdk/src/host.ts#L3203-L3211) - `sessionSchema`, shared by the running session, a browsed row and `resolveSessionConfig`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts#L1586 - a running session draws a chip only for `sessionMutable` keys, and `isolation` and `branch`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts#L1160-L1162 - the chip is read-only when the property is `readOnly`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/agentHost/browser/agentSessionSettingsFileSystemProvider.ts#L89 - the settings view lists only `sessionMutable` keys that are not `readOnly`
---

## Context

After the first send VS Code draws a chip for a running session only when the key is `sessionMutable`, with `isolation` and `branch` as the exceptions it names.
Every other fixed key disappears: the computer a session runs on, Claude's thinking, pi's project resources.
Softov asked where the computer was shown and could not find it.

## Decision

The schema a running session publishes marks every fixed key `sessionMutable: true` and `readOnly: true`, so VS Code draws it as a chip that cannot be opened.
The schema `resolveSessionConfig` answers is unchanged, so the key stays pickable in New.
The host's own gate keeps reading the unpublished schema, where the key is still `sessionMutable: false`, and refuses a change after the first turn.

## Consequences

A running session shows every value it was created with, in the same place it was picked.
The published `sessionMutable: true` is not literally true; a client that ignores `readOnly` offers a control the host refuses.
The settings view still leaves these keys out, since it excludes `readOnly`, and that is VS Code's choice.

## Options

- **Leave them hidden.** What VS Code does for its own fixed keys, but then nothing says where a session runs.
- **Say it in the title or `_meta`.** Visible, but a second place for a value the picker already owns, and only a client written for it reads `_meta`.
