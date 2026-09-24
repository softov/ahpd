---
title: A machine is made by a resource write
status: done
depends: []
layer: packages/computer
refs:
  - "[code://packages/computer/src/provider.ts#L1-L70](../../../../packages/computer/src/provider.ts#L1-L70) - `split`, `at`, `absent` and the options a provider holds"
  - "[code://packages/computer/src/runtime.ts#L30-L45](../../../../packages/computer/src/runtime.ts#L30-L45) - `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L173-L182](../../../../packages/computer/src/runtime.ts#L173-L182) - `run`, which builds the argument list"
  - "[code://packages/sdk/src/types/resources.ts#L61-L75](../../../../packages/sdk/src/types/resources.ts#L61-L75) - `Write`: `data`, `encoding`, `mode`, `createOnly`"
  - "[code://packages/sdk/src/resources.ts#L27](../../../../packages/sdk/src/resources.ts#L27) - `-32010`, the create-onto-something-there code"
  - "[code://packages/sdk/src/host.ts#L4626-L4660](../../../../packages/sdk/src/host.ts#L4626-L4660) - `capabilityFor`, which gates this write as `computer:write`"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - the fixture runtime the cases drive"
---

## Objective

`resourceWrite` to `computer://<name>` with a JSON manifest starts a machine, a manifest that is not one is refused with a sentence, and a create onto a name that is already there is `-32010`.

## Files

- `CREATE: packages/computer/src/manifest.ts` - `manifestOf(uri, content, defaults)`, which parses the body, applies the provider's defaults, validates each field, and answers a `MachineSpec` or throws an `RpcError`.
- `UPDATE: packages/computer/src/provider.ts` - a `write(uri, content)` that calls `manifestOf` and `runtime.run`, and `capabilities` naming the manifest.
- `UPDATE: packages/computer/src/provider.ts` - the `ComputerProvider` interface, which extends `ResourceProvider` and now declares `write`.
- `UPDATE: test/computer.test.ts` - the fixture runtime gains `run`, and the cases.
- `UPDATE: test/computer-resource.test.ts` if the resource cases grow past a screen; otherwise the same file.

## Steps

1. Read the body as JSON out of `content.data`, honouring `encoding: 'base64'`, and refuse anything that is not an object with a sentence naming what a manifest is.
2. Take `runtime` and refuse a value this package does not have; take `image` and fall back to the provider's default; take `cpus` and `memory` as strings, and refuse a value the runtime would reject before the runtime is asked.
3. Refuse a name that is empty, has a slash, or is not a name a URI can carry, and refuse a create onto a machine that exists when `content.createOnly` is set, with `-32010`.
4. Call `runtime.run` and answer; a runtime failure is a refusal carrying the runtime's own sentence, not a thrown string.
5. Keep the provider's `max`, refusing a create past it with a sentence saying so.

## Validation

- `test/computer.test.ts` - a write with a full manifest calls `run` with the name, image and limits; a write with only a name uses the provider's image; `createOnly` onto an existing name is `-32010`; a body that is not JSON, one with no `image` and no default, and one naming an unknown runtime are each refused with a sentence.
- `test/users-gate.test.ts` or a host case - `resourceWrite` to `computer://` is gated as `computer:write`, and a `file:write` holder is refused `-32009`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
The manifest's field list is the interface: `runtime`, `image`, `cpus`, `memory`, and whatever plan `plugin/11` adds for a workspace.
