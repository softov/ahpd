---
title: A host-wide root setting needs config:write, and a person's own needs only a sign-in
status: accepted
date: 2026-09-25
refs:
  - "[code://packages/sdk/src/host.ts#L271-L281](../../packages/sdk/src/host.ts#L271-L281) - `dispatchNeeds`, which reads the root action as well as the channel"
  - "[code://packages/sdk/src/host.ts#L6846](../../packages/sdk/src/host.ts#L6846) - the dispatch gate, which asks only for a sign-in when no grant is needed"
  - "[code://packages/sdk/src/users.ts#L35](../../packages/sdk/src/users.ts#L35) - `SUBJECTS`, with `config` added"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostRootConfigForwarder.ts - VS Code pushes only keys the host's schema lists, one per action
---

## Context

`root/configChanged` on `ahp-root://` was gated as `file:write`.
That let anybody who may save a file change what every session is told (`artifactToolsCompactPrompts`, `deferredTitleGeneration`), and it also refused a guest's own `defaultShell`, which reaches nobody else.
The handoff listed it as open: "somebody who may save a file may also change what every session is told."
The user asked for it on 2026-09-25: "do 8. **A capability for host configuration.**"

## Decision

`config` is a host subject, with `config:write` as its grant.
A `root/configChanged` that only sets `PER_CONNECTION` keys needs a sign-in and no grant.
One that sets any other key, known or not, or that replaces the config, needs `config:write`.
No built-in role but `admin` (through `*:*`) has it.

## Consequences

A `member` can no longer change host-wide root settings; a deployment that wants that adds `config:write` to a role.
Anybody signed in, a guest included, can hold their own `defaultShell`.
VS Code pushes `defaultShell` alone on connect, so a member's window is not refused; its settings UI sends one key per action, so a refusal names the key's grant rather than rolling back a mix. A `replace` from that UI needs `config:write`, because it clears the host's keys.

## Options

- **Keep `file:write`.** Rejected: saving a file and changing every session's instructions are different permissions, which is what the grant model separates.
- **Give `member` `config:write`.** Rejected (defaulted: the writer's choice, reversible): the point is that a working role does not reconfigure the host.
