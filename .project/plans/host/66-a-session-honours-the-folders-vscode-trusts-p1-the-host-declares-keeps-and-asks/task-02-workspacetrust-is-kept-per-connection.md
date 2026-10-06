---
title: workspaceTrust is kept per connection
status: todo
depends: [task-01-workspacetrust-is-declared-as-vscode-declares-it.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/gate.ts#L289-L302](../../../../packages/sdk/src/host/gate.ts#L289-L302) - `PER_CONNECTION`"
  - "[code://packages/sdk/src/host/actions.ts#L263-L296](../../../../packages/sdk/src/host/actions.ts#L263-L296) - where a push is split"
  - "[code://packages/sdk/src/host.ts#L465-L525](../../../../packages/sdk/src/host.ts#L465-L525) - `seenBy`"
---

## Objective

A pushed `workspaceTrust` is kept on the connection that pushed it, echoed only to that connection, and absent from `rootConfig`, as `defaultShell` is.
A helper answers whether a folder is trusted under one connection's value: `enabled: false` trusts everything, otherwise a trusted URI that is the folder or its parent.

## Files

- `UPDATE: packages/sdk/src/host/gate.ts:302` - `PER_CONNECTION` holds `workspaceTrust`; today it is `defaultShell` alone, so a push lands in `rootConfig` and the last window to connect sets everyone's trust.
- `UPDATE: packages/sdk/src/host/gate.ts:289-301` - the comment names both keys.
- `CREATE: packages/sdk/src/host/trust.ts` - `trusted(folder, value)`, comparing `localPath`s as VS Code's `isEqualOrParent` does.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the cases below.

## Steps

1. Failing case first: two connections; A pushes `workspaceTrust` `{ enabled: true, trustedUris: [uriOf('/a')] }`. Today B's root snapshot shows A's value; after, B sees none and A sees its own.
2. Cases for `trusted`: `/a/b` under `/a` is trusted, `/ab` is not, anything under `enabled: false` is, anything under no value is not ([the decision](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md)).

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/root-config.test.ts`.

## Resume
