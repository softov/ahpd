---
title: Claude keeps its state in a volume
status: done
depends: [task-01-claude-runs-from-its-part.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L373-L387](../../../../packages/agent-claude/src/claude.ts#L373-L387) - the config dir and `.claude.json` needs"
  - "[code://packages/sdk/src/host/machines.ts#L201-L209](../../../../packages/sdk/src/host/machines.ts#L201-L209) - `machine()` is asked of the session's own variant"
---

## Objective

Claude's `machine()` answers a state need at its config dir, seeded with `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/` and `.claude.json` keeping `mcpServers`; the two host mounts are marked `when: 'host'`.
Claude's secrets are not machine needs: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` reach the CLI per exec from the variant's own `env` (task 09), never as container env, so a key one variant signs in with never reaches another variant on the same machine.
Each variant declares its state need at its own `computerConfigDir`, which defaults to `/ahpd/<provider>` (`/ahpd/claude` for the built-in), so each provider has its own state volume per profile (container/05 p6, Softov, 2026-10-05: "One per provider"), and its key reaches the CLI only from its own `env` per exec (task 09).

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:373-387` - the needs.
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts` - the cases below.

## Steps

1. Keep `computerConfigDir` as the state target; `false` still means no configuration.
2. Declare no env need for `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`: a variant signs in through its own `env`, as `{ "$secret" }` or `{ "fromEnv" }`, which task 09 passes per exec. A machine whose variant has neither is made, and Claude's own sign-in refusal is what a person sees, with the docs naming both variables.
3. The state need is the same object for every variant, with no variant key in its target or name, so the needs of two variants are identical and collapse.

## Validation

- Mode `volume`: the state need and its seeds; no host mounts; no env need for either secret; no seed is `.credentials.json`.
- Mode `host`: today's needs.
- The built-in variant and a variant answer state needs equal field by field.

## Resume
