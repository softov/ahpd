---
title: A preset that cannot be resolved skips only itself
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L111-L162](../../../../packages/agent-claude/src/plugin.ts#L111-L162) - `optionsOf` and `apply`"
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - the `env` declaration, which takes `secretAtUse`"
  - "[code://packages/computer/src/plugin.ts#L57-L61](../../../../packages/computer/src/plugin.ts#L57-L61) - `needValue`, the `secretAtUse` pattern"
  - "[code://packages/agent-claude/test/agent-claude-presets.test.ts#L230-L244](../../../../packages/agent-claude/test/agent-claude-presets.test.ts#L230-L244) - the case to rewrite"
---

## Objective

A preset that `presetSchema` refuses, a missing `fromEnv` variable included, or whose `$secret` cannot be read, is left out of the variants with one `host.log` line, and every other variant registers.

## Files

- `UPDATE: packages/agent-claude/src/options.ts` - a preset `env` value is declared `secretAtUse: true`, so the loader hands `{ "$secret": "<name>" }` through as written; `heldTo` accepts that shape beside a string, `null` and `{ fromEnv }`.
- `UPDATE: packages/agent-claude/src/plugin.ts:123-162` - `optionsOf` becomes async, reads each preset `env` `$secret` with `host.secret(name)`, and collects the presets `presetSchema` refuses instead of throwing on the first, logs each through `host.log`, and builds the variants from the rest; with none left it throws naming every skipped preset. Its comment on `presets` says what happens now.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts:230-244` - the cases below.
- `UPDATE: packages/agent-claude/README.md:69` - "which must be set when the plugin loads" says a preset whose variable or `$secret` is missing is skipped with a log line, and shows `{ "$secret": "host:<name>" }` as a value.

## Steps

1. Keep the top-level `provider`, `displayName`, `models`, `keepCliModels` refusal as it is.
2. Check each preset with `presetSchema`; a refused id is kept with its message and not passed to `variantsOf`, whose built-in is dropped the same way when `presets.claude` is the one refused.
3. Read each `env` value written `{ "$secret": "<name>" }` with `host.secret(name)`; a read that throws, or a name in `user:` or `team:` scope, skips that preset with the reason. The value read replaces the reference in the variant's `env`.
4. Log each skipped preset once, with the message `presetSchema` answered.
5. With no variant left, throw one error that names the skipped presets' messages.

## Validation

- `agent-claude-presets.test.ts`: with the variable unset, `{ claude: {}, router: { env: { ANTHROPIC_AUTH_TOKEN: { fromEnv: 'AHPD_PRESET_KEY' } } } }` loads with no problems, registers `claude` and not `router`, and logs one line ending `options.presets.router.env.ANTHROPIC_AUTH_TOKEN reads AHPD_PRESET_KEY, which the daemon's environment does not have`.
- The same file: `router.extraArgs.debug: { fromEnv: 'PATH' }` is skipped the same way, logging `is not a string`.
- The same file: `router.env.ANTHROPIC_AUTH_TOKEN: { "$secret": "host:or" }` registers `router` with the value when the vault holds it, and skips only `router` when the secret is missing and when the host has no vault.
- The same file: `{ claude: false, router: <missing variable> }` fails the load with the message.
- The test's `load` passes a `log` that records lines, not `() => {}`, so the skip line is asserted.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
