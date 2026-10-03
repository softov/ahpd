---
title: A Claude variant's env reaches its machine without the daemon's
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2189-L2208](../../../../packages/agent-claude/src/session.ts#L2189-L2208) - the env a CLI in a machine gets: the daemon's `CLAUDE_*` and `ANTHROPIC_*`, and `CLAUDE_CONFIG_DIR`"
  - "[code://packages/agent-claude/src/session.ts#L2252-L2253](../../../../packages/agent-claude/src/session.ts#L2252-L2253) - `fromPreset` and a pushed credential, laid after it"
  - "[code://packages/agent-claude/src/options.ts#L100-L116](../../../../packages/agent-claude/src/options.ts#L100-L116) - the variant's `env` becomes the daemon's whole environment with its own keys over it"
---

## Objective

A Claude session in a machine runs its CLI with the daemon's `CLAUDE_*` and `ANTHROPIC_*`, then the variant's own `env` keys, then a pushed credential, and never the daemon's `HOME`, `PATH` or any other variable, whichever variant it runs.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:2189-2253` - inside a machine, the `env` handed to the SDK is the filtered one with the variant's own keys and a pushed credential over it, and `CLAUDE_CONFIG_DIR` last.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts` - the cases below.

## Steps

1. Keep the variant's own keys apart from the daemon environment `toQuery` spreads under them, so a machine gets only those keys.
2. A key the variant unsets with `null` is absent in the machine too.
3. Off a machine, nothing changes.

## Validation

- A variant with `env: { ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_AUTH_TOKEN: { fromEnv: "T" } }` in a machine hands the CLI both, `CLAUDE_CONFIG_DIR`, and no `HOME` or `PATH`.
- The built-in variant in a machine with no pushed credential hands the CLI exactly what it does today.
- A pushed credential in a machine is laid over the filtered env, not over the daemon's whole one, which is what L2253 does today.
- `pnpm --filter @ahpd/agent-claude test` green.

## Resume
