---
title: A message runs on the custom agent it picked
domain: claude
status: planned
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
refs:
  - "[code://packages/sdk/src/types/session.ts#L219-L225](../../../../packages/sdk/src/types/session.ts#L219-L225) - `MessageFrom`, which carries no agent"
  - "[code://packages/sdk/src/host.ts#L6743-L6764](../../../../packages/sdk/src/host.ts#L6743-L6764) - `messageFrom`, read on each send, which answers undefined when a message has neither `origin` nor `_meta`"
  - "[code://packages/sdk/src/host.ts#L1240-L1246](../../../../packages/sdk/src/host.ts#L1240-L1246) - `about(provider)`, whose `models` are what the variant offers"
  - "[code://packages/sdk/src/host.ts#L8401-L8523](../../../../packages/sdk/src/host.ts#L8401-L8523) - `chat/turnStarted` for a resumed and a live session"
  - "[code://packages/sdk/src/host.ts#L4455-L4470](../../../../packages/sdk/src/host.ts#L4455-L4470) - `beginOrRun`"
  - "[code://packages/agent-claude/src/session.ts#L185-L345](../../../../packages/agent-claude/src/session.ts#L185-L345) - `customizationsOf`: every agent, a built-in too, gets a `file://~/.claude/agents/<name>.md` uri"
  - "[code://packages/agent-claude/src/session.ts#L2180-L2243](../../../../packages/agent-claude/src/session.ts#L2180-L2243) - `beginTurn`, where the model is applied"
  - "[code://packages/agent-claude/src/session.ts#L2009-L2153](../../../../packages/agent-claude/src/session.ts#L2009-L2153) - the `query()` call"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L1774-L1780 - every send calls `changeAgent` with `message.agent`, absent included
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1216-L1238 - `setAgent`: the SDK reads `agent` at startup, so a change rebuilds the query
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L730-L771 - the rebuild, resuming the same session with the new agent
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L179-L252 - `nonEditableUri` and `resolveClaudeAgentName`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L90-L198 - `agent` projected onto `Options.agent`
---

## Goal

A person picks one of the agents a Claude session lists, and the next message runs on it, as in VS Code.
Built-in agents are listed the way VS Code lists them, and the SDK's default agent is not offered as a choice.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
client: message.agent = { uri } -> host chat/turnStarted -> messageFrom(message) drops it -> session.begin(turn, text, model, from)
                                                                                              -> query() started with no agent
```

### Gaps

- The sdk's message type has no `agent`, and the host never reads `message.agent`.
- agent-claude never passes `agent` to `query()`.
- A built-in agent's uri names a file that does not exist, and `general-purpose` is listed.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every send carries the agent it picked; an absent one means the default agent | https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L1774-L1780 | 01 |
| A picked agent that differs from the one the query started with rebuilds the query on that send, resuming the same session | https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L730-L771 | 03 |
| A built-in agent's uri is `claude-internal:/agent/<name>`, and `general-purpose` is not listed | https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L339-L393 | 02 |
| A uri resolves to the file's frontmatter `name`, its basename when that fails, or the last segment of a `claude-internal:` uri; a file removed since passes its basename | https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L206-L252 | 03 |
| The agent is not stored per session: the next message carries it again | (defaulted: the protocol sends it on every message, so nothing is lost across a restart) | 03 |
| A restored session reopens on its saved model and reports it, as VS Code restores `claude.model` | Softov, 2026-09-30, asked "A restored Claude session doesn't report its last model until the next message. Should I add a task so it reopens on its saved model, as VS Code does?": "Add to claude/09"; https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSessionMetadataStore.ts#L75 | 05 |
| A stored model is chosen only when the variant offers it (`about(provider).models`); otherwise the session opens with none chosen | (defaulted: a variant's endpoint may not serve a model another variant stored, and a stored id must not reach a CLI that refuses it) | 05 |
| A message that carries only `agent`, with neither `origin` nor `_meta`, still hands the backend a `from` | (defaulted: `messageFrom` returning undefined for such a message would drop the pick) | 01 |

## Proposed architecture

- **Data flow** - `message.agent` -> `MessageFrom.agent` -> `begin`/`queue` -> agent-claude resolves the name -> `query({ agent })`.
- **Layer responsibilities** - sdk: the type and the three send paths · agent-claude: the uris, the name and the rebuild.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The picked agent reaches the backend](task-01-the-picked-agent-reaches-the-backend.md) | todo | - |
| [02 - Built-in agents are listed as VS Code lists them](task-02-built-in-agents-are-listed-as-vscode-lists-them.md) | todo | - |
| [03 - The query runs on the picked agent](task-03-the-query-runs-on-the-picked-agent.md) | todo | 01, 02 |
| [04 - Docs](task-04-docs.md) | todo | 03, 05 |
| [05 - A restored session reopens on its model](task-05-a-restored-session-reopens-on-its-model.md) | todo | - |

## Risks and tradeoffs

- A rebuild between turns costs a CLI restart on the send that switches agent; only a switch pays it.
- A replayed message after a restart does not know which agent it ran on; the history shows none.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-picked-agent-reaches-the-backend.md](task-01-the-picked-agent-reaches-the-backend.md).
- **Open questions:** none.
- **Watch out for:** the queued-message path (`host.ts` near 8972) reads `message.model` too and must read `agent` the same way.

## Final verification checklist

- [ ] In ahpapp and VS Code, picking `Plan` and sending runs the turn on it; picking none runs the default.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
