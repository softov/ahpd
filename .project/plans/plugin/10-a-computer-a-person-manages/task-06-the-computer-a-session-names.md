---
title: The computer a session names
status: done
depends:
  - task-05-a-plugin-contributes-a-session-key.md
layer: packages/computer
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the `apply` that registers the provider and the tools"
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts) - `registerSessionConfig`, from task 05"
  - "[code://packages/sdk/src/types/agent.ts#L96-L97](../../../../packages/sdk/src/types/agent.ts#L96-L97) - `Start.settings`, where the value ends up"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the naming the value must match"
  - "[code://test/computer-plugin.test.ts](../../../../test/computer-plugin.test.ts) - the plugin cases"
---

## Objective

The computer plugin contributes a `computer` session key whose value is a `computer://<id>`, so a client draws it when it creates a session, the value is stored with the session, and a backend receives it in `Start.settings`.

## Files

- `UPDATE: packages/computer/src/plugin.ts` - `host.registerSessionConfig('computer', { type: 'string', title: 'Computer', description: ... })` from the plugin's options, and a `sessionDefault` option when the operator wants one.
- `UPDATE: packages/computer/src/plugin.ts` - the option parsing for the default, beside the existing keys.
- `UPDATE: test/computer-plugin.test.ts` - the key is on the session schema, the default is its value, and the plugin can be loaded without the key when the option says so.
- `UPDATE: test/computer.test.ts` - a value that is not a `computer://` URI is refused where it is set.

## Steps

1. Register the key from `apply`, after the provider, with the schema a client draws: a string, the title, and a description that says what a value looks like.
2. Default it to nothing, so a session without one is a session on the host, which is what every session is today.
3. Add a `sessionDefault` option, so an operator can make one machine the default for new sessions without making it the only one.
4. Validate the value's shape where the plugin can: a `computer://<id>` URI or nothing, and a sentence for anything else.

## Validation

- `test/computer-plugin.test.ts` - the session schema from a host that loaded the plugin has `computer`; `sessionDefault` becomes the schema's default; a plugin loaded with the key switched off contributes no key.
- `test/computer.test.ts` - a malformed value is refused.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
This task contributes the key and proves it is drawn; a backend reading it is plan `plugin/11`'s task 03.
