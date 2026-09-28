---
title: The configuration is read through cofold and checked against one schema
domain: daemon
status: built
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - file:///github/cofold/.project/plans/commands/02-a-program-chooses-its-config-layers/plan.md
decisions:
  - decisions/the-daemon-reads-no-project-config-file.md
  - decisions/config-file-replaces-every-other-layer.md
  - decisions/an-unknown-config-key-warns-and-starts.md
refs:
  - "[code://packages/server/src/config.ts#L28-L130](../../../../packages/server/src/config.ts#L28-L130) - `Config`, a TypeScript interface with no check behind it"
  - "[code://packages/server/src/config.ts#L204-L226](../../../../packages/server/src/config.ts#L204-L226) - `loadConfig`, `JSON.parse` cast to `Config`"
  - "[code://packages/server/src/commands/options.ts#L111-L205](../../../../packages/server/src/commands/options.ts#L111-L205) - `serverFields`, the schemas the flags are already checked against"
  - "[code://packages/server/src/commands/options.ts#L262-L388](../../../../packages/server/src/commands/options.ts#L262-L388) - `said`, `under`, `isOneOf`, `httpOf` and `optionsFrom`: the file checked key by key, some wrong values dropped and some refused"
  - "[code://packages/server/src/commands/user.ts#L67](../../../../packages/server/src/commands/user.ts#L67) - a second reader of the file"
  - "[code://packages/server/src/commands/config.ts#L85-L95](../../../../packages/server/src/commands/config.ts#L85-L95) - `ahpd config`, which prints one file"
  - "[code://packages/server/src/commands/plugin.ts#L95-L110](../../../../packages/server/src/commands/plugin.ts#L95-L110) - `plugin install` writes the user file or the named one"
  - npm://@cofold/config - `resolveConfig`, its layers and `sourceOf`
  - npm://@cofold/commands@^0.2.2 - `check(value, schema, label)`, already a dependency
---

## Goal

The daemon's configuration is found and read by `@cofold/config` and checked once, against the same schemas the flags use.
A wrong value in any file stops the start with a sentence naming the file and the key; an unknown key is named and the daemon starts.
The user file and `$AHPD_CONFIG` are read, no project file is, and `--config-file` still replaces both.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg "loadConfig|configPath\(\)" packages/server/src` - three readers of the file: `optionsFrom`, `user`, `config`; `plugin install` and the no-backend refusal name the path.
- `rg "typeof .* === 'string'" packages/server/src/commands/options.ts` - the hand checks in `optionsFrom`.

### Runtime path

```
ahpd [flags] -> @cofold/commands checks the flags against serverFields -> optionsFrom -> loadConfig (JSON.parse, cast) -> said / isOneOf / httpOf / asSpec per key -> Options
```

### Gaps

- `"port": "8080"` in the file falls back to 9187 and `"automations": "disk"` falls back to `file`, silently; `http` and `plugins` refuse the start. The same mistake has two outcomes.
- `http` is not in `serverFields`, so it has no schema, no help line and its own hand check.
- An unknown key, such as `"plugin"`, is ignored with no word.
- Only one file is read.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The daemon reads no project configuration file](../../../decisions/the-daemon-reads-no-project-config-file.md) | Softov, 2026-09-28 |
| 2 | [--config-file replaces every other configuration layer](../../../decisions/config-file-replaces-every-other-layer.md) | Softov, 2026-09-28 |
| 3 | [An unknown configuration key warns, and the daemon starts](../../../decisions/an-unknown-config-key-warns-and-starts.md) | Softov, 2026-09-28 |

| What | Source | Task |
| --- | --- | --- |
| `@ahpd/server` depends on `@cofold/config` and reads its file through `resolveConfig` | Softov, 2026-09-28, asked which way the file layers go: "adjust ... cofold config" | 01 |
| `$AHPD_CONFIG` names a file, merged over the user file | (defaulted: cofold's environment layer, on by default) | 01 |
| A relative path in `paths`, `users` or `connectionTokenFile` resolves against the directory of the file that set it | (defaulted: a file must not mean something different per working directory) | 01 |
| A relative plugin spec in a file keeps the loader's rule: the working directory, then the configuration directory | Softov, 2026-09-28, asked "How should a relative plugin path in a config file resolve?": "Old rule for plugins", after `./packages/agent-claude/src/index.ts` in his user file stopped loading | 01 |
| A wrong value on a known key refuses the start, naming the file from `sourceOf` and the key | the gap above; decision 3 keeps refusal for known keys | 02 |
| `http` joins `serverFields` as a schema, and `httpOf` goes | the gap above | 02 |

## Proposed architecture

- **Data flow** - `loadConfig` calls `resolveConfig({ name: 'ahpd' })`, which after cofold commands/02 reads no project file, or with `--config-file` `{ path, user: false, environment: false }`; it returns the merged values and `sourceOf`. `optionsFrom` checks the merged values against one object schema built from `serverFields` plus `http`, then reads them without `said`, `isOneOf` or `typeof`.
- **State flow** - nothing new is stored. `plugin install` and `user add` keep writing the user file, or the named one.
- **Layer responsibilities** - `@cofold/config`: finding and merging files. `@cofold/commands`: `check`. `config.ts`: which layers and names. `options.ts`: the schema and the fold of flags over files.
- **Source-of-truth files** - [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) for the schema; `Config` becomes the type of that schema.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The files are found and merged by @cofold/config](task-01-the-files-are-found-by-cofold-config.md) | done | - |
| [02 - Every key is checked against one schema](task-02-every-key-is-checked-against-one-schema.md) | done | 01 |

## Risks and tradeoffs

- A daemon that started with a silently dropped wrong value will now refuse to start after the upgrade; the message names the file and the key.

## Resume state

- **Done so far:** tasks 01 and 02 done 2026-09-28 (`c3c23d6`, `d0e9714`), checked by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `@cofold/config` is a new dependency of `@ahpd/server`; `pnpm boundary` must list it. The plugin options half is [plugin/26](../../plugin/26-a-plugin-declares-its-options-schema/plan.md).

## Final verification checklist

- [x] `"port": "8080"` in `config.json` refuses the start naming the file and `port`.
- [x] `"plugin": [...]` prints a warning naming the file and `plugin`, and the daemon starts.
- [x] `$AHPD_CONFIG` is merged over the user file, and `ahpd config` names both files.
- [x] An `ahpd.json` or `.ahpd.json` in the working directory is not read.
- [x] `--config-file` reads that file only, with `$AHPD_CONFIG` set.
- [x] `pnpm typecheck`, `pnpm boundary` and the full `pnpm test` clean.
- [x] `docs/DAEMON.md` describes the layers and the checks.
- [x] `plans/index.md` updated.
