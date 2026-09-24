---
title: What a client reads says what can be asked
status: done
depends:
  - task-01-a-machine-is-made-by-a-resource-write.md
layer: packages/computer
refs:
  - "[code://packages/computer/src/provider.ts#L78-L145](../../../../packages/computer/src/provider.ts#L78-L145) - `capabilities` and the two leaves"
  - "[code://packages/computer/src/runtime.ts#L60-L70](../../../../packages/computer/src/runtime.ts#L60-L70) - `RuntimeCapabilities`"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the operator's page, which says a machine is made by a tool"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - where the cases go"
---

## Objective

`computer://<name>/capabilities` says what this host accepts in a create body, with the fields and the limits, and `docs/COMPUTER.md` says a person makes a machine with a resource write rather than a tool.

## Files

- `UPDATE: packages/computer/src/provider.ts` - `capabilities` reports the runtime, the manifest fields it accepts, the default image and the limits, and `capabilities` names `create` and `destroy` rather than the tool words.
- `UPDATE: docs/COMPUTER.md` - the create body with an example, the grant it needs, and what `scripts/computer.mjs` is still for.
- `UPDATE: docs/USERS.md` - the `computer` subject already exists in the grant table; add that `computer:write` is what makes and destroys one.
- `UPDATE: test/computer.test.ts` - the two leaves.

## Steps

1. Build the `capabilities` body from the provider's own options and `runtime.capabilities()`, so a field a create accepts is a field this resource names.
2. Name the actions in the words a person uses (`create`, `destroy`, `exec`), not the tool names.
3. Write the body down in `docs/COMPUTER.md` as an example, with the `resourceWrite` call and the `computer:write` grant.
4. Say in the same page that the three tools still exist for a model, that each declares it needs advanced permission, and that the resource route is the person's.

## Validation

- `test/computer.test.ts` - a machine's `capabilities` read names the runtime, the default image and the limits; a root listing names every machine; a name that is not there is `-32008`.
- `pnpm test` green, and the docs link check over `.project` and `docs`.

## Resume

Not started.
