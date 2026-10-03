---
title: A Claude preset that cannot be resolved skips only itself
domain: claude
status: planned
priority: high
created: 2026-10-03
requires:
  - plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md
decisions:
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L111-L162](../../../../packages/agent-claude/src/plugin.ts#L111-L162) - `optionsOf` checks every preset before registering any, and `apply` throws on the first"
  - "[code://packages/agent-claude/src/options.ts#L201-L220](../../../../packages/agent-claude/src/options.ts#L201-L220) - `heldTo`, where a missing `fromEnv` variable is reported"
  - "[code://packages/agent-claude/test/agent-claude-presets.test.ts#L230-L244](../../../../packages/agent-claude/test/agent-claude-presets.test.ts#L230-L244) - the test that expects a missing variable to fail the load"
  - "[code://packages/sdk/src/types/plugin.ts#L107](../../../../packages/sdk/src/types/plugin.ts#L107) - `log`, the one channel a plugin has for a line that is not a failure"
  - "[code://packages/sdk/src/types/plugin.ts#L172-L180](../../../../packages/sdk/src/types/plugin.ts#L172-L180) - `secret(name, work?)`, how a plugin reads a `secretAtUse` value"
  - "[code://packages/server/src/plugins.ts#L557-L574](../../../../packages/server/src/plugins.ts#L557-L574) - `resolveSecrets`: a `$secret` outside `secretAtUse` is read at load, and a failure skips the whole plugin"
  - "[code://packages/computer/src/plugin.ts#L57-L61](../../../../packages/computer/src/plugin.ts#L57-L61) - `needValue`, the `secretAtUse` pattern to mirror"
---

## Goal

One agent-claude load registers every preset it can.
A preset whose `fromEnv` variable is missing, whose `$secret` cannot be read, or whose contents are wrongly written, is skipped with one log line naming `options.presets.<id>`, and the others register.
The load fails only when no variant is left to register.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "environment does not have" packages` - the one message, in `options.ts`, and the one test that expects it to fail the load.
- `rg -n "a missing variable fails the load" .project` - claude/12 task 02, written when each preset was its own load.

### Runtime path

```
config plugins[] -> server loadPlugins -> agent-claude apply -> optionsOf (presetSchema per preset, throws on the first) -> registerAgent per variant
```

### Gaps

- claude/12 made a missing variable fail the load when each preset was a load of its own; claude/15 made every preset one load and kept the rule, so a daemon started without `OPENROUTER_API_KEY` loses the built-in `claude`, which reads no key.
- A preset `env` value written `{ "$secret": "host:or" }` is read by the loader before `apply`, and a missing secret or a host with no vault skips the whole plugin the same way.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| A missing `fromEnv` variable and a wrongly written preset both skip only that preset, with one log line | Softov, 2026-10-03, asked "which preset failures skip only that preset instead of failing the whole agent-claude plugin?": "Any preset failure" | 01 |
| A `$secret` the loader cannot read fails only its own item: a preset's `env` values are `secretAtUse`, and the plugin reads them itself | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" | 01 |
| A preset's `$secret` is read once at load in host scope; a `user:` or `team:` name there skips that preset | (defaulted: a preset is the daemon's, not a person's; reading per session owner is a later choice) | 01 |
| An `extraArgs` value that is not a string or `null` reaches the CLI as its JSON text | Softov, 2026-10-03, asked "should an extraArgs value written as a JSON object or array be accepted and passed to the CLI as its JSON text?": "Accept, stringify" | 02 |
| `{ fromEnv }` stays refused under `extraArgs` | (defaulted: it is claude/12's `env`-only form, and stringifying it would pass a literal `{"fromEnv":...}` to the CLI) | 02 |
| A top-level `provider`, `displayName`, `models` or `keepCliModels` still fails the load | (defaulted: it is plugin-wide, not one preset's) | 01 |
| No variant left to register fails the load, naming every skipped preset | claude/15, "Presets that leave nothing to register fail the load" | 01 |

## Proposed architecture

- **Data flow** - `optionsOf` becomes async and checks each preset on its own: `presetSchema`, then each `env` value written as `{ "$secret" }` read through `host.secret`. A preset that answers a problem is dropped from the variants and its problem is logged through `host.log`; `apply` registers what is left.
- The session listing, the start and restart output, and an agent id that clashes with another plugin's are [host/41](../../host/41-a-failure-belongs-to-the-item-that-failed/plan.md)'s; once host/41 task 03 lands, the skip line goes through `host.problem` too.
- **Layer responsibilities** - agent-claude only; the loader is unchanged.
- **Source-of-truth files** - [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A preset that cannot be resolved skips only itself](task-01-a-failing-preset-skips-only-itself.md) | todo | - |
| [02 - An extraArgs value may be written as JSON](task-02-an-extra-arg-may-be-json.md) | todo | 01 |

## Risks and tradeoffs

- A typo in a preset no longer stops the daemon; until host/41 prints skipped presets at start, it shows only as a log line and a missing picker entry.

## Resume state

- **Next:** task 01, then 02.

## Final verification checklist

- [ ] With `OPENROUTER_API_KEY` unset, a config with `claude` and `claude-openrouter` registers `claude` and logs one line naming `options.presets.claude-openrouter`.
- [ ] A wrongly written preset, and one whose `$secret` is missing or whose host has no vault, are skipped the same way.
- [ ] Every preset failing fails the load.
- [ ] `extraArgs.settings` written as an object reaches the CLI as `--settings '<json>'`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
