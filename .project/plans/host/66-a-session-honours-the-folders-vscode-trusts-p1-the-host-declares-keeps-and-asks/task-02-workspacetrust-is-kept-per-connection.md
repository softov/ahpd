---
title: workspaceTrust is kept per connection
status: done
depends: [task-01-workspacetrust-is-declared-as-vscode-declares-it.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/gate.ts#L289-L302](../../../../packages/sdk/src/host/gate.ts#L289-L302) - `PER_CONNECTION`"
  - "[code://packages/sdk/src/host/actions.ts#L263-L296](../../../../packages/sdk/src/host/actions.ts#L263-L296) - where a push is split"
  - "[code://packages/sdk/src/host.ts#L465-L525](../../../../packages/sdk/src/host.ts#L465-L525) - `seenBy`"
---

## Objective

A pushed `workspaceTrust` stays on the connection that pushed it, and no other connection sees it.
It is absent from `rootConfig`, as `defaultShell` is.
A helper answers whether a folder is trusted under one connection's value.
`enabled: false` trusts everything; otherwise a trusted URI that is the folder or its parent does.
Two folders are compared as the folders they name, so `..` and a symlink out of a trusted folder do not walk past it.
An entry that names no folder here - the empty string, `file://`, another machine's host - vouches for nothing.

## Files

- `UPDATE: packages/sdk/src/host/gate.ts:302` - `PER_CONNECTION` holds `workspaceTrust`; today it is `defaultShell` alone, so a push lands in `rootConfig` and the last window to connect sets everyone's trust.
- `UPDATE: packages/sdk/src/host/gate.ts:289-301` - the comment names both keys.
- `CREATE: packages/sdk/src/host/trust.ts` - `trusted(folder, value)`, reading each side as the folder it names, as VS Code's `isEqualOrParent` does.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the cases below.

## Steps

1. Failing case first: two connections; A pushes `workspaceTrust` `{ enabled: true, trustedUris: [uriOf('/a')] }`. Today B's root snapshot shows A's value; after, B sees none and A sees its own.
2. Cases for `trusted`: the helper trusts `/a/b` under `/a`, and refuses `/ab` beside it. `enabled: false` trusts every folder, and no value trusts nothing ([the decision](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md)).
3. A folder written as `<trusted>/../../etc`: the helper answers false.
4. A symlink inside a trusted folder that points outside it: false, and a folder under that link too.
5. `''` and `file://` in `trustedUris`: they vouch for nothing.
6. `file://elsewhere/home/a`: it vouches for nothing here, and `file://localhost/home/a` still does.

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/root-config.test.ts`.

## Resume
