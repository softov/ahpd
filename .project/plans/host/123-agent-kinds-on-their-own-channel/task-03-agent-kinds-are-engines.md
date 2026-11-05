---
title: Agent kinds are engines
status: done
depends:
  - task-02-a-kind-has-its-plugin-icon.md
layer: "sdk, server, agent plugins, docs"
refs:
  - "[code://packages/sdk/src/agents/kinds.ts](../../../../packages/sdk/src/agents/kinds.ts) - the channel, its scheme and its title"
  - "[code://packages/sdk/src/types/agents.ts#L96-L148](../../../../packages/sdk/src/types/agents.ts#L96-L148) - `AgentKind` and `ServedAgentKind`"
  - "[code://packages/sdk/src/agents/channel.ts#L119](../../../../packages/sdk/src/agents/channel.ts#L119) - the `kind` field of an agent record"
  - "[code://packages/sdk/src/agents/channel.ts#L556](../../../../packages/sdk/src/agents/channel.ts#L556) - `x-ahpd/agents/put` reads `params.kind`"
  - "[code://packages/sdk/src/plugins/validate.ts#L655-L690](../../../../packages/sdk/src/plugins/validate.ts#L655-L690) - `checkAgentKind` and its messages"
  - "[code://packages/sdk/src/plugins/plugins.ts#L539-L550](../../../../packages/sdk/src/plugins/plugins.ts#L539-L550) - the fold of `agentKinds`"
  - "[code://packages/server/src/agents/migrate.ts](../../../../packages/server/src/agents/migrate.ts) - the move from presets writes `kind` on each record"
  - "[code://packages/agent-claude/package.json#L78-L81](../../../../packages/agent-claude/package.json#L78-L81) - the contract key `agentKinds`"
  - "[code://CHANGELOG.md#L21](../../../../CHANGELOG.md#L21) - the same rename for adapters, the line to copy"
---

## Objective

The word "engine" replaces "agent kind" everywhere in ahpd: the channel, the agent record, the sdk, the plugins and the docs.
None of these names is in 0.13.0, so the rename has no compatibility path.
A stored agent record that says `kind` and not `engine` reads as `unavailable`, as a stored connector that says `kind` does.

## Files

- `CREATE: packages/sdk/src/agents/engines.ts` - the channel from `kinds.ts`, with the scheme `x-ahpd-engines`, the title "Engines", and the names `enginesChannel`, `EnginesChannel` and `EnginesChannelOptions`.
- `DELETE: packages/sdk/src/agents/kinds.ts` - `engines.ts` replaces it.
- `UPDATE: packages/sdk/src/types/agents.ts:96-148` - `AgentKind` is `Engine`, `ServedAgentKind` is `ServedEngine`, and the record field `kind` is `engine`.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerAgentKind` is `registerEngine`, and the contribution key `agentKinds` is `engines`.
- `UPDATE: packages/sdk/src/types/host.ts` - the host option `agentKinds` is `engines`.
- `UPDATE: packages/sdk/src/types/index.ts` - export the new type names.
- `UPDATE: packages/sdk/src/index.ts` - export `enginesChannel` from `agents/engines.js`.
- `UPDATE: packages/sdk/src/agents/channel.ts` - the record field, the `put` param, the doc comment and every message say `engine`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the fold, the contract key and the messages say `engines`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:655-690` - `checkAgentKind` is `checkEngine`, and its messages name `registerEngine`.
- `UPDATE: packages/server/src/commands/run.ts` - the channel, the fold and their variables say `engines`.
- `UPDATE: packages/server/src/commands/configure.ts` - `ahpd configure` writes and reads `engine` on an ACP record.
- `UPDATE: packages/server/src/found.ts` - the configured agents are the records whose `engine` is `acp`.
- `UPDATE: packages/server/test/server-configure.test.ts` - records say `engine`.
- `UPDATE: packages/server/src/agents/migrate.ts` - write `engine` on each record, and name the types `PresetEngine` and `PRESET_ENGINES`.
- `UPDATE: packages/agent-claude/src/plugin.ts` - call `registerEngine`.
- `UPDATE: packages/agent-acp/src/plugin.ts` - call `registerEngine`.
- `UPDATE: packages/agent-cofold/src/plugin.ts` - call `registerEngine`.
- `UPDATE: packages/agent-pi/src/plugin.ts` - call `registerEngine`.
- `UPDATE: packages/agent-claude/package.json:80` - the contract key is `engines`.
- `UPDATE: packages/agent-acp/package.json` - the contract key is `engines`.
- `UPDATE: packages/agent-cofold/package.json` - the contract key is `engines`.
- `UPDATE: packages/agent-pi/package.json` - the contract key is `engines`.
- `CREATE: packages/sdk/test/engines-channel.test.ts` - the tests from `agent-kinds-channel.test.ts`, with the new names, and the two new tests.
- `DELETE: packages/sdk/test/agent-kinds-channel.test.ts` - `engines-channel.test.ts` replaces it.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - records and puts say `engine`.
- `UPDATE: packages/server/test/agents-migrate.test.ts` - a moved record says `engine`.
- `CREATE: packages/agent-claude/test/engine.test.ts` - the tests from `kind.test.ts`, with the new names.
- `DELETE: packages/agent-claude/test/kind.test.ts` - `engine.test.ts` replaces it.
- `CREATE: packages/agent-acp/test/engine.test.ts` - the tests from `kind.test.ts`, with the new names.
- `DELETE: packages/agent-acp/test/kind.test.ts` - `engine.test.ts` replaces it.
- `CREATE: packages/agent-cofold/test/engine.test.ts` - the tests from `kind.test.ts`, with the new names.
- `DELETE: packages/agent-cofold/test/kind.test.ts` - `engine.test.ts` replaces it.
- `CREATE: packages/agent-pi/test/engine.test.ts` - the tests from `kind.test.ts`, with the new names.
- `DELETE: packages/agent-pi/test/kind.test.ts` - `engine.test.ts` replaces it.
- `UPDATE: packages/agent-acp/test/agent-acp-plugin.test.ts` - the new names; the other agent plugin tests that `git grep` finds change the same way.
- `UPDATE: packages/sdk/test/plugin-fold.test.ts` - a plugin whose contracts say `agentKinds` cannot register an engine.
- `UPDATE: packages/sdk/test/container-relay.test.ts` - the nested daemon keeps its folders under the test folder, not under the home of the person who runs it.
- `UPDATE: packages/agent-acp/README.md` - the record says `engine`; the other three agent plugin READMEs change the same way.
- `UPDATE: docs/plugins/COMPUTERS.md` - the example records say `engine`.
- `UPDATE: docs/plugins/PLUGINS.md` - the `x-ahpd-engines` section, the `x-ahpd-agents` record field, `registerEngine` and the contract key.
- `UPDATE: docs/sdk/HOST.md` - the grant row names `x-ahpd-engines`.
- `CREATE: .project/pending/host-123-engines-checks.md` - Softov edits his stored records and checks ahpw.

## Steps

1. Rename the scheme to `x-ahpd-engines` and the channel title to "Engines".
2. Keep the grant `agent:list` on the channel.
3. Rename the types, functions, variables and files as the Files list says.
4. Rename the agent record field `kind` to `engine`, on the record, on `x-ahpd/agents/put` and on each row.
5. Read a stored record without `engine` as `unavailable`, with a reason that names the missing `engine`.
6. Rename the contract key `agentKinds` to `engines` in the sdk and in the four agent plugin manifests.
7. Refuse to load a plugin whose manifest declares `agentKinds`, as the host does for `connectors`.
8. Write `engine` on each record that the move from presets makes.
9. Change "agent kind" and "kind" to "engine" in the docs, the doc comments and the messages.
10. Keep "kind" where it names something else, such as the `Kind` type in `validate.ts`.
11. Write the pending check file with the steps below.
12. Run the gate, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- `git grep -nE "AgentKind|agentKind|agent-kinds|registerAgentKind|Agent kinds" -- ':!.project' ':!packages/sdk/test/plugin-fold.test.ts'` prints nothing.
- A subscribe to `x-ahpd-engines://` on a test daemon lists `acp`, `claude`, `cofold` and `pi`, each with a `data:` icon.
- A subscribe to `x-ahpd-agent-kinds://` answers `-32001`.
- A test shows that a stored record with `kind` and no `engine` reads as `unavailable`.
- A test shows that the host does not load a plugin whose manifest declares `agentKinds`.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Pending check

The pending file holds these steps for Softov.

1. Stop the daemon.
2. In each file in `~/.config/ahpd/agents/`, rename the key `kind` to `engine`.
3. Start the daemon on main.
4. Check that no agent is `unavailable`.
5. Open the agents page in ahpw, and add an agent from an engine.
