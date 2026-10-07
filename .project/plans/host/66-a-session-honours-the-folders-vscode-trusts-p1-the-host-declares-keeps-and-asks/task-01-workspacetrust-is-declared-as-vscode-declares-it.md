---
title: workspaceTrust is declared as VS Code declares it
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L162-L184](../../../../packages/sdk/src/host/root.ts#L162-L184) - `ROOT_CONFIG_SCHEMA`"
  - "[code://packages/sdk/test/root-config.test.ts](../../../../packages/sdk/test/root-config.test.ts) - the schema cases"
  - "[code://.project/plans/host/45-root-config-declares-every-value-it-holds/task-01-the-root-config-declares-the-keys-vscode-pushes.md#L41](../../../../.project/plans/host/45-root-config-declares-every-value-it-holds/task-01-the-root-config-declares-the-keys-vscode-pushes.md#L41) - the row moved here"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostSchema.ts#L864-L877 - the property
---

## Objective

Root state's `config.schema.properties.workspaceTrust` is `{ type: 'object', title: 'Workspace Trust', properties: { enabled: boolean 'Enabled', trustedUris: array of string 'Trusted Folders' / 'Folder URI' }, required: ['enabled', 'trustedUris'], readOnly: true }`, with no default.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:162-184` - the property beside `defaultShell`, with a comment naming the upstream line; today the key is not declared, so a client draws nothing for the value VS Code pushes.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the case below.

## Steps

1. Failing case first: the root snapshot's schema has `workspaceTrust` equal to the property above. Today it is absent.
2. Copy it from `agentHostSchema.ts:864-877`, the English strings out of `localize`.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/root-config.test.ts`.

## Resume
