---
title: A backend that runs nested names its plugin, and the inner host is configured by the profile only
status: todo
depends: [task-06-docs.md]
layer: "sdk | agent-cofold"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L439](../../../../packages/sdk/src/types/agent.ts#L439) - `runsNested?: boolean`"
  - "[code://packages/sdk/src/validate.ts#L69](../../../../packages/sdk/src/validate.ts#L69) - `runsNested` checked as a boolean at plugin load"
  - "[code://packages/sdk/src/host.ts#L3618-L3620](../../../../packages/sdk/src/host.ts#L3618-L3620) - the host chooses the proxy when `runsNested === true`"
  - "[code://packages/sdk/src/nested.ts#L95-L103](../../../../packages/sdk/src/nested.ts#L95-L103) - `nestedAgent`, which derives `@ahpd/agent-<provider>`"
  - "[code://packages/sdk/src/nested.ts#L376-L381](../../../../packages/sdk/src/nested.ts#L376-L381) - the inner `createSession`, under the outer provider name"
  - "[code://packages/agent-cofold/src/agent.ts#L673](../../../../packages/agent-cofold/src/agent.ts#L673) - cofold's `runsNested: true`"
  - "[code://packages/computer/test/computer-refusal.test.ts#L52-L98](../../../../packages/computer/test/computer-refusal.test.ts#L52-L98) - the cases that read `runsNested` as a boolean"
---

## Objective

`runsNested` is `{ plugin }`, the inner host loads that package whatever the provider is called, and the inner session is created under the provider the inner host serves, per [the plugin decision](../../../decisions/a-backend-that-runs-nested-names-its-plugin.md) and [the profile decision](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md).

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:439` - `runsNested?: { plugin: string }`, with a doc comment saying what `plugin` names.
- `UPDATE: packages/sdk/src/validate.ts:69` - an object with a non-empty string `plugin`.
- `UPDATE: packages/sdk/src/host.ts:3618-3620` - the proxy when `runsNested` is present, handed `runsNested.plugin`.
- `UPDATE: packages/sdk/src/nested.ts:62-103` - `NestedOptions.plugins` default and its doc comment; the provider-string form of `nestedAgent`.
- `UPDATE: packages/sdk/src/nested.ts:376-381` - the provider named in the inner `createSession`.
- `UPDATE: packages/agent-cofold/src/agent.ts:667-673` - `runsNested: { plugin: '@ahpd/agent-cofold' }`, and its comment.
- `UPDATE: packages/computer/test/computer-refusal.test.ts:52-98` and `packages/sdk/test/nested-proxy.test.ts:348-387` - the checks that read a boolean.

## Steps

1. Change the type and the validation; `runsNested: true` is refused at plugin load with a sentence saying it takes `{ plugin }`.
2. The host passes `{ plugins: [agent.runsNested.plugin] }` to `nestedAgent`; remove the `@ahpd/agent-${name}` default (`nested.ts:98`), so a caller without a plugin is a type error, not a guess. The default is wrong for every variant (`claude-openrouter` is not a package), and container/05 p9 task 03 reaches every backend through `nestedAgent`, so how a backend that does not declare `runsNested` names its package waits on the plan's open question; cofold's `{ plugin }` does not.
3. Pass no outer plugin options into the machine: the inner host loads the plugin with its defaults, and cofold reads its configuration where [the fixed target](../../../decisions/cofold-config-reaches-a-machine-by-a-path-variable.md) mounts it.
4. Create the inner session under the provider the inner host serves: after `initialize`, read the inner root's `agents` and use the outer provider name when it is there. Fall back to the single agent the inner host serves only when the outer agent is the plugin's default provider (the agent it registers without a preset, under whatever name it was given, as `cofold-work` is); more than one candidate ends the session with a sentence naming them (Softov confirmed, 2026-09-26). A variant the inner host does not serve (`claude-openrouter` beside an inner `claude`) ends the session with a sentence naming the variant, and is never run as the plain agent.
5. cofold declares its package, and the comment above it says what the member is, not how it came to be.

## Validation

- `packages/computer/test/computer-refusal.test.ts`: cofold's `runsNested` is `{ plugin: '@ahpd/agent-cofold' }`; a plugin whose agent declares `runsNested: true` is refused at load.
- `packages/sdk/test/nested-proxy.test.ts`: an inner host that serves only `claude` and an outer variant `claude-openrouter` end the session with a sentence naming `claude-openrouter`, and no inner `createSession` is sent; an outer `claude` against the same inner host is created there.
- `packages/sdk/test/nested-proxy.test.ts`: a backend registered as `cofold-work` with `runsNested: { plugin: '@ahpd/agent-cofold' }` asks the port for `@ahpd/agent-cofold`, and its inner `createSession` names the provider the inner host serves (`cofold`); today it asks for `@ahpd/agent-cofold-work` and names `cofold-work`.
- `node_modules/.bin/vitest run packages/computer/test/computer-refusal.test.ts packages/sdk/test/nested-proxy.test.ts` and `node_modules/.bin/tsc -p tsconfig.json --noEmit` pass.

## Resume
