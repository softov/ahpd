---
title: A nested host loads the plugin that registered the agent, and the inner host is configured by the profile only
status: todo
depends: [task-06-docs.md]
layer: "sdk | agent-cofold"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L439](../../../../packages/sdk/src/types/agent.ts#L439) - `runsNested?: boolean`"
  - "[code://packages/sdk/src/plugins.ts#L500-L507](../../../../packages/sdk/src/plugins.ts#L500-L507) - `registerAgent`, where the plugin that registers an agent is known"
  - "[code://packages/sdk/src/types/plugin.ts#L454-L470](../../../../packages/sdk/src/types/plugin.ts#L454-L470) - `Loaded.spec`, what configuration named for that plugin"
  - "[code://packages/sdk/src/host/spawn.ts#L332-L334](../../../../packages/sdk/src/host/spawn.ts#L332-L334) - the host chooses the proxy when `runsNested === true`"
  - "[code://packages/sdk/src/nested.ts#L95-L103](../../../../packages/sdk/src/nested.ts#L95-L103) - `nestedAgent`, which derives `@ahpd/agent-<provider>`"
  - "[code://packages/sdk/src/nested.ts#L376-L381](../../../../packages/sdk/src/nested.ts#L376-L381) - the inner `createSession`, under the outer provider name"
  - "[code://packages/agent-cofold/src/agent.ts#L673](../../../../packages/agent-cofold/src/agent.ts#L673) - cofold's `runsNested: true`"
  - "[code://packages/computer/test/computer-refusal.test.ts#L52-L98](../../../../packages/computer/test/computer-refusal.test.ts#L52-L98) - the cases that read `runsNested` as a boolean"
---

## Objective

The host knows which plugin spec registered each agent, the inner host loads that plugin whatever the provider is called and wherever the plugin came from, and the inner session is created under the provider the inner host serves, per [the plugin decision](../../../decisions/the-host-records-which-plugin-registered-each-agent.md) and [the profile decision](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md).

## Files

- `UPDATE: packages/sdk/src/plugins.ts:500-507` - each agent a plugin registers is kept with the name of that plugin's spec.
- `UPDATE: packages/sdk/src/host/spawn.ts:332-334` - the proxy handed the recorded plugin of the agent.
- `UPDATE: packages/sdk/src/nested.ts:62-103` - `NestedOptions.plugins` default and its doc comment; the provider-string form of `nestedAgent`.
- `UPDATE: packages/sdk/src/nested.ts:376-381` - the provider named in the inner `createSession`.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the cases below.

## Steps

1. When a plugin registers an agent, record the name of that plugin's spec (`Loaded.spec`, the string or its `name`) against the agent's provider, so every variant of one plugin maps to that plugin; an agent handed to `createHost` directly, not through a plugin, has no record.
2. The host passes `{ plugins: [<recorded spec>] }` to `nestedAgent`; remove the `@ahpd/agent-${name}` default (`nested.ts:98`), so a caller without a plugin is a type error, not a guess. An agent with no record that is asked to run nested ends the session with a sentence saying the host does not know which plugin serves it. `runsNested` stays a boolean.
3. Pass no outer plugin options into the machine: the inner host loads the plugin with its defaults, and cofold reads its configuration where [the fixed target](../../../decisions/cofold-config-reaches-a-machine-by-a-path-variable.md) mounts it.
4. Create the inner session under the provider the inner host serves: after `initialize`, read the inner root's `agents` and use the outer provider name when it is there. Fall back to the single agent the inner host serves only when the outer agent is the plugin's default provider (the agent it registers without a preset, under whatever name it was given, as `cofold-work` is); more than one candidate ends the session with a sentence naming them (Softov confirmed, 2026-09-26). A variant the inner host does not serve (`claude-openrouter` beside an inner `claude`) ends the session with a sentence naming the variant, and is never run as the plain agent.
5. A session whose plugin the inner host cannot load ends with a sentence naming the plugin; making a plugin loaded from a path present in the machine is the ahpd part's (container/05 p3, p5), not this task's.

## Validation

- `packages/sdk/test/plugins.test.ts` (or the file that tests `registerAgent`): two agents registered by one plugin named `some-scope/agents` both map to `some-scope/agents`, and one loaded from a path maps to that path.
- `packages/sdk/test/nested-proxy.test.ts`: an inner host that serves only `claude` and an outer variant `claude-openrouter` end the session with a sentence naming `claude-openrouter`, and no inner `createSession` is sent; an outer `claude` against the same inner host is created there.
- `packages/sdk/test/nested-proxy.test.ts`: a backend registered as `cofold-work` by the plugin `@ahpd/agent-cofold` asks the port for `@ahpd/agent-cofold`, and its inner `createSession` names the provider the inner host serves (`cofold`); today it asks for `@ahpd/agent-cofold-work` and names `cofold-work`.
- `packages/sdk/test/nested-proxy.test.ts`: an agent with no recorded plugin, asked to run nested, ends the session with a sentence and starts no inner host.
- `node_modules/.bin/vitest run packages/sdk/test/nested-proxy.test.ts` and `node_modules/.bin/tsc -p tsconfig.json --noEmit` pass.

## Resume
