---
title: Claude keeps its state in a volume
status: todo
depends: [task-01-claude-runs-from-its-part.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L382-L396](../../../../packages/agent-claude/src/claude.ts#L382-L396) - the config dir and `.claude.json` needs"
---

## Objective

Claude's `machine()` answers a state need at its config dir, seeded with `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/` and `.claude.json` keeping `mcpServers`, plus secret env needs `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY`; the two host mounts are marked `when: 'host'`.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:382-396` - the needs.
- `UPDATE: packages/agent-claude/test/` the machine test.

## Steps

1. Keep `computerConfigDir` as the state target; `false` still means no configuration.
2. The secrets are not required: a machine with neither is made, and Claude's own sign-in refusal is what a person sees, with the docs naming both routes.

## Validation

- Mode `volume`: the state need, its seeds and the two secrets; no host mounts.
- Mode `host`: today's needs.

## Resume
