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

A Claude session in a machine runs its CLI with an exec env built from that variant's own preset `env` alone, then a pushed credential, then `CLAUDE_CONFIG_DIR`, passed per exec by name (p1) and never as container env.
The daemon's `ANTHROPIC_*` variables, and its `CLAUDE_CODE_OAUTH_TOKEN`, do not cross into a machine unless the variant's `env` names them (`{ "fromEnv": "ANTHROPIC_API_KEY" }`); the daemon's `HOME`, `PATH` and every other variable never do.
Two variants sharing one machine, the built-in one and an OpenRouter one, each get only their own keys, because `docker exec` cannot unset a variable set on the container.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:2189-2253` - inside a machine, the `env` handed to the SDK is the variant's own keys, a pushed credential over them, and `CLAUDE_CONFIG_DIR` last; the `CLAUDE_*` and `ANTHROPIC_*` filter over `process.env` (`:2201-2203`) goes for a machine, and the daemon's other `CLAUDE_*` settings cross only when the variant names them too.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts` - the cases below.

## Steps

1. Keep the variant's own keys apart from the daemon environment `toQuery` spreads under them, so a machine gets only those keys.
2. A `$secret` in the variant's `env` is read with `host.secret` when the session starts (claude/16 makes preset env `secretAtUse`), and the value goes into this exec env only; a secret that cannot be read fails that session's start with a line naming the preset and the variable.
3. A key the variant unsets with `null` is absent in the machine too.
4. Off a machine, nothing changes.

## Validation

- A variant with `env: { ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_AUTH_TOKEN: { fromEnv: "T" } }` in a machine hands the CLI both, `CLAUDE_CONFIG_DIR`, and no `HOME` or `PATH`.
- The built-in variant with no `env`, in a machine, with `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` set in the daemon, hands the CLI neither; with `env: { ANTHROPIC_API_KEY: { fromEnv: "ANTHROPIC_API_KEY" } }` it hands the CLI that one.
- The built-in variant and an OpenRouter variant on one machine: the OpenRouter variant's exec env has no `ANTHROPIC_API_KEY`, and no `-e` of it is on its `docker exec`, while the built-in variant's exec has it by name.
- A pushed credential in a machine is laid over the filtered env, not over the daemon's whole one, which is what L2253 does today.
- `pnpm --filter @ahpd/agent-claude test` green.

## Resume
