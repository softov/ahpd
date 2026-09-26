---
title: A backend that runs nested names its plugin, and the inner host is configured by the profile only
status: todo
depends: [task-06-docs.md]
layer: "sdk | agent-cofold"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L356](../../../../packages/sdk/src/types/agent.ts#L356) - `runsNested?: boolean`"
  - "[code://packages/sdk/src/validate.ts#L69](../../../../packages/sdk/src/validate.ts#L69) - `runsNested` checked as a boolean at plugin load"
  - "[code://packages/sdk/src/host.ts#L2940-L2942](../../../../packages/sdk/src/host.ts#L2940-L2942) - the host chooses the proxy when `runsNested === true`"
  - "[code://packages/sdk/src/nested.ts#L95-L103](../../../../packages/sdk/src/nested.ts#L95-L103) - `nestedAgent`, which derives `@ahpd/agent-<provider>`"
  - "[code://packages/sdk/src/nested.ts#L376-L381](../../../../packages/sdk/src/nested.ts#L376-L381) - the inner `createSession`, under the outer provider name"
  - "[code://packages/agent-cofold/src/agent.ts#L634](../../../../packages/agent-cofold/src/agent.ts#L634) - cofold's `runsNested: true`"
  - "[code://test/computer-refusal.test.ts#L55-L97](../../../../test/computer-refusal.test.ts#L55-L97) - the cases that read `runsNested` as a boolean"
---

## Objective

`runsNested` is `{ plugin }`, the inner host loads that package whatever the provider is called, and the inner session is created under the provider the inner host serves, per [the plugin decision](../../../decisions/a-backend-that-runs-nested-names-its-plugin.md) and [the profile decision](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md).

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:356` - `runsNested?: { plugin: string }`, with a doc comment saying what `plugin` names.
- `UPDATE: packages/sdk/src/validate.ts:69` - an object with a non-empty string `plugin`.
- `UPDATE: packages/sdk/src/host.ts:2940-2942` - the proxy when `runsNested` is present, handed `runsNested.plugin`.
- `UPDATE: packages/sdk/src/nested.ts:62-103` - `NestedOptions.plugins` default and its doc comment; the provider-string form of `nestedAgent`.
- `UPDATE: packages/sdk/src/nested.ts:376-381` - the provider named in the inner `createSession`.
- `UPDATE: packages/agent-cofold/src/agent.ts:628-634` - `runsNested: { plugin: '@ahpd/agent-cofold' }`, and its comment.
- `UPDATE: test/computer-refusal.test.ts:55-97` and `test/nested-proxy.test.ts:342-381` - the checks that read a boolean.

## Steps

1. Change the type and the validation; `runsNested: true` is refused at plugin load with a sentence saying it takes `{ plugin }`.
2. The host passes `{ plugins: [agent.runsNested.plugin] }` to `nestedAgent`; remove the `@ahpd/agent-${name}` default, so a caller without a plugin is a type error, not a guess.
3. Pass no outer plugin options into the machine: the inner host loads the plugin with its defaults, and cofold reads its configuration where [the fixed target](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md) mounts it.
4. Create the inner session under the provider the inner host serves: after `initialize`, read the inner root's `agents`, use the outer provider name when it is there and otherwise the single agent the inner host serves; more than one candidate ends the session with a sentence naming them (Softov confirmed, 2026-09-26).
5. cofold declares its package, and the comment above it says what the member is, not how it came to be.

## Validation

- `test/computer-refusal.test.ts`: cofold's `runsNested` is `{ plugin: '@ahpd/agent-cofold' }`; a plugin whose agent declares `runsNested: true` is refused at load.
- `test/nested-proxy.test.ts`: a backend registered as `cofold-work` with `runsNested: { plugin: '@ahpd/agent-cofold' }` asks the port for `@ahpd/agent-cofold`, and its inner `createSession` names the provider the inner host serves (`cofold`); today it asks for `@ahpd/agent-cofold-work` and names `cofold-work`.
- `node_modules/.bin/vitest run test/computer-refusal.test.ts test/nested-proxy.test.ts` and `node_modules/.bin/tsc -p tsconfig.json --noEmit` pass.

## Resume
