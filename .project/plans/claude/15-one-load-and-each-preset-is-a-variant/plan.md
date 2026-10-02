---
title: A Claude plugin is loaded once, and each preset is a variant with its own name and models
domain: claude
status: built
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/claude/10-a-claude-session-runs-on-a-preset/plan.md
  - plans/claude/12-a-second-claude-runs-on-another-endpoint/plan.md
  - plans/claude/13-a-claude-harness-offers-the-models-it-is-told/plan.md
decisions:
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
  - decisions/claude-options-are-declared-once-for-sessions-and-presets.md
refs:
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts) - `optionsSchema`, `optionsOf` and `apply`, which registers one agent"
  - "[code://packages/agent-claude/src/claude.ts#L60-L148](../../../../packages/agent-claude/src/claude.ts#L60-L148) - `ClaudeOptions`: top-level `provider`, `displayName`, `models`, `keepCliModels`, `presets`"
  - "[code://packages/agent-claude/src/claude.ts#L229-L250](../../../../packages/agent-claude/src/claude.ts#L229-L250) - the session `preset` key that leaves"
  - "[code://packages/agent-claude/src/claude.ts#L466-L472](../../../../packages/agent-claude/src/claude.ts#L466-L472) - the endpoint probe, which reads the daemon's `ANTHROPIC_BASE_URL`"
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - the declared options a preset holds, `presetValues` and `presetSchema`"
  - "[code://packages/server/src/plugins.ts#L660-L678](../../../../packages/server/src/plugins.ts#L660-L678) - the repeated-name check keyed by `provider`"
  - "[code://packages/server/src/rootconfig.ts#L109-L114](../../../../packages/server/src/rootconfig.ts#L109-L114) - root config entries, keyed through `keyed`"
  - "[code://packages/server/src/commands/config.ts#L105-L118](../../../../packages/server/src/commands/config.ts#L105-L118) - `keyed`, which builds `plugins.<name>#<provider>`"
  - "[code://packages/sdk/src/plugins.ts#L340-L344](../../../../packages/sdk/src/plugins.ts#L340-L344) - `registerAgent` already takes several agents per plugin with distinct providers"
---

## Goal

`@ahpd/agent-claude` is written once in `plugins`.
Its built-in preset is Claude Code as it runs today, and every other preset is a variant that shows in the picker as its own entry, with its own name, models and options, such as "Claude OpenRouter".
Loading the same plugin twice is refused, so a plugin has one root config key again.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "registerAgent" packages/*/src` - every agent plugin registers exactly one agent; the SDK already allows several per plugin.
- `rg -n "a-repeated-plugin-is-keyed" .` - the check in `server/src/plugins.ts`, the key in `server/src/commands/config.ts`, the test `agent-claude/test/agent-claude-presets.test.ts` and the fixture `server/test/fixtures/plugin-provider`.
- `rg -n "preset" packages/agent-claude/README.md docs/DAEMON.md` - the README documents presets as a session choice and the second load for OpenRouter.

### Runtime path

```
config plugins[] -> server loadPlugins (one per name) -> agent-claude apply -> one registerAgent per preset -> root agents[] (provider, displayName, models) -> picker
```

### Gaps

- A preset cannot name itself or carry models; both are top-level and apply to the whole load.
- The endpoint probe reads the daemon's `ANTHROPIC_BASE_URL`, not the preset's.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | 01, 02 |
| [A Claude option is declared once, and both the session schema and the preset schema are made from it](../../../decisions/claude-options-are-declared-once-for-sessions-and-presets.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| A preset's key is its provider id; the built-in is `claude` | Softov, 2026-10-02: "any new is a new agent on wire" | 01 |
| `presets.claude: false` drops the built-in; an object there is laid over it | Softov, 2026-10-02, asked "How is the built-in Claude preset switched off?": "presets.claude: false" | 01 |
| A preset's `name` is what a client reads; the built-in's is `Claude Code`, any other's defaults to its key | Softov, 2026-10-02: "move name to inside the present. Claude OpenRouter." | 01 |
| `models` and `keepCliModels` move inside the preset, with claude/13's meaning unchanged | Softov, 2026-10-02: "model also inside the preset." | 01 |
| Top-level `provider`, `displayName`, `models` and `keepCliModels` are removed; written there, the load fails naming `presets.<id>` | (defaulted: ignoring them would run the built-in where the operator meant another endpoint) | 01 |
| The session `preset` key is removed; a stored value falls back as host/31 built | (defaulted: the variant is now the agent the session was created on) | 01 |
| Presets that leave nothing to register fail the load | (defaulted: a Claude plugin that registers nothing is a mistake, not a choice) | 01 |
| The endpoint probe reads the preset's `ANTHROPIC_BASE_URL` before the daemon's | (defaulted: a preset on another endpoint is probed there) | 01 |
| A plugin name written twice in `plugins` fails the start; root config keys every plugin `plugins.<name>` | Softov, 2026-10-02: "droping loading the same plugin more times... and use the options to make more agents" | 02 |
| agent-acp takes presets in a later plan; until then it loads once | Softov, 2026-10-02, asked "Does agent-acp take the same presets shape in this plan?": "Claude now, ACP after" | - |

## Proposed architecture

- **Data flow** - `optionsOf` resolves `presets` into a list of variants: the built-in `{ id: 'claude', name: 'Claude Code' }` unless `false`, with an object under `claude` laid over it, then every other key in written order. `apply` calls `registerAgent(claude({ ...shared, ...variant }))` once per variant.
- **State flow** - `ClaudeOptions` takes one variant: `provider`, `displayName`, `models`, `keepCliModels` and a `preset` bag of declared options, replacing the `presets` map. The plugin-wide options (`paths`, `computerExecutable`, `computerConfigDir`, `workerStop`) are shared by every variant.
- **Layer responsibilities** - agent-claude: variants and their agents · server: one load per plugin name, one key per plugin.
- **Source-of-truth files** - [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts), [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts), [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each Claude preset registers its own agent](task-01-each-preset-registers-its-own-agent.md) | done | - |
| [02 - A plugin is loaded once and keyed by its name](task-02-a-plugin-is-loaded-once.md) | done | - |
| [03 - The docs show one load with a built-in and a variant](task-03-the-docs-show-one-load.md) | done | 01, 02 |

## Risks and tradeoffs

- Softov's `config.json` loads agent-claude twice and fails the start once this lands - the implemented note gives the rewritten block, and he edits his own config.
- Two Claude agents list the same CLI catalogue - host/37 already lists such a session once, under the harness it runs on.
- ACP loses two servers in one daemon until its own presets plan - only one ACP server is configured today.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] One agent-claude entry with `claude` and `claude-openrouter` presets shows two picker entries, each with its own name and models.
- [x] `presets.claude: false` leaves only the variants.
- [x] A top-level `models` or `provider` fails the load naming `presets.<id>`.
- [x] A plugin written twice fails the start.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
