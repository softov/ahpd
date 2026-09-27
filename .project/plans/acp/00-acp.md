---
title: acp - what exists today
domain: acp
revalidated: 2026-09-26
---

`packages/agent-acp` (`@ahpd/agent-acp`) is the ACP bridge: it spawns one Agent Client Protocol server per configured spec, acts as its ACP client over `@agentclientprotocol/sdk`, and turns what the server says into AHP `chat/*` and `session/*` actions (decisions [acp-bridge-uses-the-protocol-sdk](../../decisions/acp-bridge-uses-the-protocol-sdk.md) and [acp-ports-come-through-start](../../decisions/acp-ports-come-through-start.md)).
Every agent that speaks ACP is configuration for this one package, not a package of its own (decision [agent-package-only-when-it-brings-a-runtime](../../decisions/agent-package-only-when-it-brings-a-runtime.md)).

## Packages

- [`code://packages/agent-acp`](../../../packages/agent-acp) - entry point `src/index.ts`; the plugin and its options `src/plugin.ts`; the `Agent` `src/agent.ts`; the spawn and the client handlers `src/connection.ts`; a session and its turns `src/session.ts`; update translation `src/mapping.ts`; the listing `src/catalog.ts`; transcripts `src/transcript.ts`.

## Contracts

- [`code://packages/sdk/src/types/agent.ts`](../../../packages/sdk/src/types/agent.ts) - `Agent` and `Start`, including the resources, terminals and computers ports.
- [`code://packages/sdk/src/types/session.ts`](../../../packages/sdk/src/types/session.ts) - `Session`, whose `confirm(toolCallId, approved)` carries no option id today.
- [`code://packages/agent-acp/src/types.ts#L42-L60`](../../../packages/agent-acp/src/types.ts#L42-L60) - `AcpOptions`, what one spec may say.

## Runtime path

```
spec -> acpAgent() -> Agent.create(start) -> first begin() -> connectAcp (spawn, initialize)
  -> session/new | session/load -> prompt -> session/update -> mapping.ts mapUpdate() -> chat/* actions
  -> stop reason ends the turn -> watched updates kept for Agent.transcript
```

## Tests

- [`code://packages/agent-acp/test`](../../../packages/agent-acp/test) - the bridge against a scripted ACP server fixture.

## What stays

These are what this bridge does well, and no plan in this domain may lose them:

- an ACP agent served to many AHP clients with queueing, reordering and drafts ([`code://packages/agent-acp/src/session.ts#L999-L1045`](../../../packages/agent-acp/src/session.ts#L999-L1045));
- `terminal/*` answered with host terminals every client can watch ([`code://packages/agent-acp/src/session.ts#L328-L343`](../../../packages/agent-acp/src/session.ts#L328-L343));
- `fs/*` answered through the store that decides what may be read ([`code://packages/agent-acp/src/session.ts#L294-L316`](../../../packages/agent-acp/src/session.ts#L294-L316));
- capabilities advertised only for handlers that exist ([`code://packages/agent-acp/src/connection.ts#L72-L90`](../../../packages/agent-acp/src/connection.ts#L72-L90));
- never an `always` the person did not choose ([`code://packages/agent-acp/src/session.ts#L387-L400`](../../../packages/agent-acp/src/session.ts#L387-L400));
- a resume the server cannot load fails rather than starting afresh ([`code://packages/agent-acp/src/session.ts#L490-L493`](../../../packages/agent-acp/src/session.ts#L490-L493));
- a turn on a model nobody chose fails rather than running ([`code://packages/agent-acp/src/session.ts#L678-L696`](../../../packages/agent-acp/src/session.ts#L678-L696));
- nothing spawned for a session nobody used ([`code://packages/agent-acp/src/session.ts#L61-L66`](../../../packages/agent-acp/src/session.ts#L61-L66));
- `!command` run in a host shell as a turn of the chat ([`code://packages/agent-acp/src/session.ts#L742-L848`](../../../packages/agent-acp/src/session.ts#L742-L848));
- a transcript rebuilt through the live mapper, so the two cannot disagree ([`code://packages/agent-acp/src/transcript.ts#L30-L65`](../../../packages/agent-acp/src/transcript.ts#L30-L65)).

## Known gaps

In the order they are worked; plugin 18 (resume, fork, elicitation) is part of this order though it lives in the plugin domain.

1. A missing command ends the daemon, stderr is thrown away, and a dying agent loses the conversation; plan [01](01-the-bridge-survives-its-agent/plan.md).
2. Load replay is written into the next new turn; plan [02](02-replay-lands-in-history/plan.md), then [plugin 18](../plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md).
3. Cancel leaves permissions pending, and `max_tokens` or `refusal` ends as a finished turn; plan [03](03-a-turn-ends-as-the-agent-ended-it/plan.md).
4. The bridge never signs in; plan [04](04-the-bridge-signs-in/plan.md).
5. Every spec is written out by hand; plan [05](05-presets/plan.md).
6. Tool calls are readied too early, lose their diffs and terminals, and edits skip review; plan [06](06-tool-calls-say-what-happened/plan.md).
7. The agent's own permission options are reduced to approve and deny; plan [07](07-the-agents-own-permission-options/plan.md).
8. Usage, title, plan and mode changes are dropped; plan [08](08-session-updates-reach-the-client/plan.md).
9. Only the model and a legacy mode are controls; plan [09](09-every-config-option-is-a-control/plan.md).
10. A prompt is one text block, and directories are sent unasked; plan [10](10-a-prompt-carries-what-the-agent-accepts/plan.md).
11. The agent gets no MCP servers; plan [11](11-the-agent-gets-mcp-servers/plan.md), a draft.
12. The bridge is on a deprecated SDK entry and lists one page with a process per call; plan [12](12-the-bridge-is-on-the-current-sdk/plan.md).

Not planned: one agent process shared by several sessions. Each session owns its process today, which is what keeps a crash to one session; revisit if spawn cost is measured as a problem.
