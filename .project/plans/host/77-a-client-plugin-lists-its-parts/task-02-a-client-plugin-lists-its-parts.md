---
title: A client plugin lists its parts
status: todo
depends: [task-01-a-copied-plugins-parts-are-read.md]
layer: sdk
refs:
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ContainerCustomizationBase.children`; `ChildCustomizationBase.enabled`; `McpServerCustomization.enablement`
---

## Objective

Once host/49 loads a client plugin, its entry in the session's customizations carries `children` from task 01, with each server's enablement from `childEnablement`.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts` - `entryOf` adds `children` to a loaded client plugin.
- `UPDATE: packages/sdk/test/clientplugins.test.ts` - a loaded plugin lists its parts, and a loading one has no `children`.

## Steps

1. Call `partsOf` on the plugin's copied folder when its load ends.
2. Leave `children` absent while the plugin loads.
3. Set an MCP server's `enablement` from `childEnablement`, keyed by the server's name.

## Validation

- `clientplugins.test.ts` covers a loaded plugin's parts and a server switched off in `childEnablement`.
- The gates pass.

## Resume
