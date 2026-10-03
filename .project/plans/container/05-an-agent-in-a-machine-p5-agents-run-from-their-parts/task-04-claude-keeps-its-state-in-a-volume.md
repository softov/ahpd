---
title: Claude keeps its state in a volume
status: todo
depends: [task-01-claude-runs-from-its-part.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L373-L387](../../../../packages/agent-claude/src/claude.ts#L373-L387) - the config dir and `.claude.json` needs"
  - "[code://packages/sdk/src/host.ts#L5321-L5330](../../../../packages/sdk/src/host.ts#L5321-L5330) - `machine()` is asked of the session's own variant"
---

## Objective

Claude's `machine()` answers a state need at its config dir, seeded with `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/` and `.claude.json` keeping `mcpServers`, plus secret env needs `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY`; the two host mounts are marked `when: 'host'`.
Every variant of one load declares the same state need at `computerConfigDir` (`/ahpd/claude`), so variants share one state volume per profile, and `container/05-p6` task 05 collapses the identical needs at create.
For now the secret env needs are per variant: a variant whose own `env` names `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` declares neither.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:373-387` - the needs.
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts` - the cases below.

## Steps

1. Keep `computerConfigDir` as the state target; `false` still means no configuration.
2. The secrets are not required: a machine with neither is made, and Claude's own sign-in refusal is what a person sees, with the docs naming both routes.
3. A secret need has no default of the daemon's: its value is the profile's or the plugin's need value, which the vault resolves when it is written as a `{ "$secret" }`.
4. One function, `secretNeedsOf(variant)`, answers the two secret env needs, or none when the variant's `env` names `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`; it is the one place the rule is made.
5. The state need is the same object for every variant, with no variant key in its target or name, so the needs of two variants are identical and collapse.

## Validation

- Mode `volume`: the state need, its seeds and the two secrets; no host mounts; no seed is `.credentials.json`.
- Mode `host`: today's needs.
- A variant with `env: { ANTHROPIC_AUTH_TOKEN: ... }` answers the state need and no secret env need; the built-in variant answers both.
- The built-in variant and a variant answer state needs equal field by field.

## Resume
