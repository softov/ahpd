---
title: A machine is destroyed by a resource delete
status: done
depends:
  - task-01-a-machine-is-made-by-a-resource-write.md
layer: packages/computer
refs:
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the provider this adds `remove` to"
  - "[code://packages/computer/src/runtime.ts#L184-L186](../../../../packages/computer/src/runtime.ts#L184-L186) - `stop` and `remove`, which are `docker stop` and `docker rm -f`"
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../../../packages/sdk/src/types/resources.ts#L204-L211) - `remove` in the optional write half"
  - "[code://packages/sdk/src/host.ts#L5550-L5580](../../../../packages/sdk/src/host.ts#L5550-L5580) - `resourceWrite`, the shape `resourceDelete` mirrors"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - where the cases go"
---

## Objective

`resourceDelete` on `computer://<name>` destroys the machine, a name that is not there is `-32008`, and the delete is gated as `computer:write`.

## Files

- `UPDATE: packages/computer/src/provider.ts` - `remove(uri)`, and `remove` in the `ComputerProvider` interface.
- `UPDATE: test/computer.test.ts` - destroy, absent, and the root URI.
- `UPDATE: test/computer-plugin.test.ts` if the plugin-level case needs it.

## Steps

1. Resolve the URI with the existing `at`, and refuse a leaf under a machine, since a machine is what is destroyed and a file inside it is not.
2. Refuse `computer://` itself, because the root is a listing and not a machine.
3. Ask `runtime.inspect` first and answer `-32008` when it is not there, so a delete of a name that never existed is distinguishable from a runtime failure.
4. Call `runtime.remove` and answer; a runtime failure is a refusal carrying its sentence.

## Validation

- `test/computer.test.ts` - deleting a machine calls `remove` once with the name; deleting an absent one is `-32008`; deleting `computer://` and `computer://box/status` is a refusal.
- A host case: `resourceDelete` on `computer://` needs `computer:write`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
