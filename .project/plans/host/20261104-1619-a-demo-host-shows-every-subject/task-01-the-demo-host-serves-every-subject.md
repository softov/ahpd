---
title: The demo host serves every subject
status: todo
depends: []
layer: "examples"
refs:
  - "[code://examples/notes/main.ts](../../../../examples/notes/main.ts) - the host to copy"
  - "[code://examples/notes/agent.ts#L775-L782](../../../../examples/notes/agent.ts#L775-L782) - the `probe` the wrap replaces"
---

## Objective

`pnpm demo` starts a host with the wrapped `notes` agent, files, terminals, git branches, git changes and automations.
Its agent offers models and customizations, so a client's pickers have something to list.

## Files

- `CREATE: examples/demo/agent.ts` - `demo`, which wraps `notes` and replaces its `probe`.
- `CREATE: examples/demo/main.ts` - the host: `notes/main.ts` with `automations: memoryAutomations()`.
- `CREATE: examples/demo/README.md` - what the demo serves, and how to start it.
- `UPDATE: package.json:22-23` - add `demo` and `demo:bun`, as `notes` and `notes:bun`.
- `UPDATE: docs/sdk/AGENT.md:311-324` - *The two examples* names the demo as a third.
- `CREATE: packages/sdk/test/demo.test.ts` - the cases in *Validation*.

## Steps

1. Write `demo(options)` in `examples/demo/agent.ts`: call `notes(options)`, and return it with `provider: 'demo'` and `displayName: 'Demo'`.
2. Replace its `probe` with one that offers two or three models, the `notes` commands and two customizations.
3. Give every model and customization a neutral name, such as `demo-fast`.
4. Copy `examples/notes/main.ts` to `examples/demo/main.ts`, with `demo` for `notes`.
5. Add `automations: memoryAutomations()` to its `createHost` options.
6. Add the `demo` and `demo:bun` scripts to `package.json`.
7. Write the README, and add the demo to *The two examples* in `docs/sdk/AGENT.md`.
8. Write the test cases in *Validation*, as `notes.test.ts` drives `notes`.

## Validation

- `packages/sdk/test/demo.test.ts`: the root state lists the `demo` agent with its models.
- `packages/sdk/test/demo.test.ts`: the host lists an automation that a client creates.
- `pnpm demo -- --port 9210 --path <scratch>` starts, and `ahpc --host ws://127.0.0.1:9210 session list` answers.
- The repository's typecheck and tests pass.

## Resume
