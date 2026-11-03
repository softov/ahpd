---
title: A connector field picks from the connectors
domain: plugin
status: active
priority: medium
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://9edf5c1b - main when the plan was written
  - "[code://packages/sdk/src/agents/channel.ts#L134-L139](../../../../packages/sdk/src/agents/channel.ts#L134-L139) - `markedAdapter`, which reads the mark"
  - "[code://packages/sdk/src/agents/channel.ts#L612-L640](../../../../packages/sdk/src/agents/channel.ts#L612-L640) - `refuseConnectors`, the agent put's check"
  - "[code://packages/sdk/src/automations/automations.ts#L331-L398](../../../../packages/sdk/src/automations/automations.ts#L331-L398) - `checkReferences`, the automation save's check"
  - "[code://packages/sdk/src/automations/automations.ts#L84-L99](../../../../packages/sdk/src/automations/automations.ts#L84-L99) - `sameOwnerOrHost`, the owner rule"
  - "[code://packages/sdk/src/tunnels/channel.ts#L245-L270](../../../../packages/sdk/src/tunnels/channel.ts#L245-L270) - `operationsOf`, which sends the kind's schema as the input of create and update"
  - "[code://packages/sdk/src/tunnels/channel.ts#L405-L420](../../../../packages/sdk/src/tunnels/channel.ts#L405-L420) - create checks the settings against the schema only"
  - "[code://packages/sdk/src/agents/engines.ts#L50-L80](../../../../packages/sdk/src/agents/engines.ts#L50-L80) - `rowOf`, which sends an engine's schema"
  - "[code://packages/sdk/src/host/automations.ts#L1522-L1534](../../../../packages/sdk/src/host/automations.ts#L1522-L1534) - `listAutomationTriggerDefinitions`, which sends each trigger's config schema"
  - "[code://packages/sdk/src/connectors/channel.ts#L379-L388](../../../../packages/sdk/src/connectors/channel.ts#L379-L388) - where the connector refs are read"
  - "[code://packages/server/src/commands/run.ts#L951-L957](../../../../packages/server/src/commands/run.ts#L951-L957) - `tunnelsChannel` wired"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1639-L1700](../../../../packages/sdk/src/host/sessionmethods.ts#L1639-L1700) - the pattern: `sessionConfigCompletions`, where a failure is an empty list"
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-session/state.ts#L612-L629 - `enumDynamic`, where `enum` holds seed values, read 2026-11-03
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/common/state.ts#L245-L270 - `ConfigPropertySchema`, with `enumLabels`, read 2026-11-03
---

## Goal

A schema field marked `x-ahpd-connector` is checked at each save, and a client draws it as a list to pick from.
The tunnel save checks it, as the agent put and the automation save do.
The host gives the field its choices in `enum` and `enumLabels`.
Where a reader may also use connectors of their own, the host marks the field `enumDynamic`, and one command answers the reader's choices.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "x-ahpd-connector" packages` - three fields carry the mark: the devtunnel kind's `connector`, the webhook trigger's `connector`, and the items of the Claude engine's `logins`.
- `rg -n "sameOwnerOrHost" packages` - the agents channel, the connectors channel, the bindings, the host automations and `agent-claude` use the owner rule.
- `rg -n "configSchema" packages/sdk/src` - a trigger's config schema reaches a client only through `listAutomationTriggerDefinitions`.

### Runtime path

```
tunnel create -> invokeOperation -> tunnels run -> check the schema -> check the connector fields -> write the record
client reads x-ahpd-tunnels:// -> operations -> create input -> connector field with enum and enumLabels
client reads x-ahpd-engines:// or listAutomationTriggerDefinitions -> marked field with enum, enumDynamic and x-ahpd-completions -> x-ahpd/completions -> the reader's connectors
```

### Gaps

- The tunnel save has no list of connectors, so it keeps a field that names no connector.
- The agent and automation checks are two copies of one loop. The automation copy does not read a marked list.
- No schema a client is sent has choices for a marked field.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host fills `enum` and `enumLabels`, and also marks a field `enumDynamic` and answers a command | Softov, 2026-11-03: "Both ways together (Recommended)" | 02, 03 |
| The tunnel save checks the mark in both ways | Softov, 2026-11-03: "ok implement both" | 01 |
| One generic command, `x-ahpd/completions`, for every form. The host stamps the field with the command and a ref, and the client sends the ref back | Softov, 2026-11-03: "One generic command (Recommended)" | 03 |
| `enum` holds the host's connectors, which every reader may use. A reader's own come from the command | (defaulted: the protocol says `enum` holds seed values under `enumDynamic`, and a schema sent to every reader must not list one person's connectors) | 02 |
| A tunnel field has the host's connectors only and no `enumDynamic`, because a tunnel is host work and the list is whole | (defaulted: the agent put's rule for a host record) | 01, 02 |
| A field with no host connector of its adapter gets no `enum` | (defaulted: an empty list cannot be picked from) | 02 |
| The label of a choice is the connector's title, or its id when it has none | (defaulted: the connectors list shows the same) | 02, 03 |
| The command answers the host's connectors and the caller's own, by the save's owner rule | (defaulted: `sameOwnerOrHost`) | 03 |
| The command needs `connector:list`, or `connector:all` | (defaulted: the grants of the connectors list) | 03 |
| The clients are not in this plan. scena reads `x-enumOptions` and not `enumLabels`, and ahpw and ahpc do not ask `x-ahpd/completions` yet | (defaulted: ahpw's tunnel form is in another session's work) | - |

## Proposed architecture

- **Layer responsibilities** - sdk: the check, the fill and the command, in `connectors/fields.ts`. server: gives the connectors to the tunnels and engines channels. It also serves the command.
- **Source-of-truth files** - [`code://packages/sdk/src/connectors/fields.ts`](../../../../packages/sdk/src/connectors/fields.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - One connector check for every save](task-01-one-connector-check-for-every-save.md) | implemented | - |
| [02 - The host fills the connector choices](task-02-the-host-fills-the-connector-choices.md) | implemented | 01 |
| [03 - The completions command answers a reader](task-03-the-completions-command-answers-a-reader.md) | implemented | 02 |

## Risks and tradeoffs

- A client that holds `enum` as the whole list refuses a person's own connector on an agent or automation form. The protocol says `enum` is a seed list under `enumDynamic`.
- The operation input is checked against the raw kind schema, not the filled one, so a check message names the connector and not the enum.

## Resume state

- **Done so far:** tasks 01, 02 and 03 are implemented. The docs in `docs/plugins/PLUGINS.md`, `docs/sdk/AUTOMATIONS.md`, `docs/sdk/HOST.md` and `docs/updates/v0_14.md` describe the check, the choices and the command.
- **Next action:** review the PR.
- **Open questions:** none.
- **Watch out for:** a system tunnel and a record read back at a start are not checked, because the connectors can open after the tunnels.

## Final verification checklist

- [x] `pnpm typecheck` passes.
- [x] The sdk tests for the agents, automations, tunnels, engines and connectors pass.
- [x] A tunnel create that names no host connector of the adapter is refused.
- [x] The tunnels state shows the host's devtunnel connectors in the create input.
- [x] `x-ahpd/completions` answers the caller's connectors and the host's.
