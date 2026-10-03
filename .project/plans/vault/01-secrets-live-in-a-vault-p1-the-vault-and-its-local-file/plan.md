---
title: The vault port and the daemon's plain file
domain: vault
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-03
requires: []
changes: []
creates: []
decisions:
  - decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md
  - decisions/a-secret-is-named-in-a-host-team-or-user-scope.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L31-L44](../../../../packages/sdk/src/types/plugin.ts#L31-L44) - `PortKey`"
  - "[code://packages/sdk/src/types/plugin.ts#L152-L168](../../../../packages/sdk/src/types/plugin.ts#L152-L168) - `recordUsage`, a host call resolved when it is made, which `secret` mirrors"
  - "[code://packages/sdk/src/types/plugin.ts#L233-L240](../../../../packages/sdk/src/types/plugin.ts#L233-L240) - `registerUsage`, which `registerVault` mirrors"
  - "[code://packages/sdk/src/plugins.ts#L30-L42](../../../../packages/sdk/src/plugins.ts#L30-L42) - `PORT_KEYS` and the check that it is the whole union"
  - "[code://packages/sdk/src/plugins.ts#L264-L272](../../../../packages/sdk/src/plugins.ts#L264-L272) - `usage?: () => Usage | undefined`, the live port a plugin host reads"
  - "[code://packages/sdk/src/plugins.ts#L335-L339](../../../../packages/sdk/src/plugins.ts#L335-L339) - `recordUsage` implemented over it"
  - "[code://packages/sdk/src/plugins.ts#L395](../../../../packages/sdk/src/plugins.ts#L395) - `registerUsage` implemented through `setPort`"
  - "[code://packages/sdk/src/validate.ts#L126-L168](../../../../packages/sdk/src/validate.ts#L126-L168) - `PORT_MEMBERS` and `PORT_METHOD`"
  - "[code://packages/sdk/src/types/host.ts#L210-L216](../../../../packages/sdk/src/types/host.ts#L210-L216) - `HostOptions.usage`, the shape `HostOptions.vault` copies"
  - "[code://packages/server/src/plugins.ts#L320-L371](../../../../packages/server/src/plugins.ts#L320-L371) - `LoadOneOptions`, where `usage` is handed down"
  - "[code://packages/server/src/plugins.ts#L515-L533](../../../../packages/server/src/plugins.ts#L515-L533) - a plugin's options merged and checked before `apply`"
  - "[code://packages/server/src/plugins.ts#L686-L698](../../../../packages/server/src/plugins.ts#L686-L698) - `loadPlugins` handing each plugin the live usage port"
  - "[code://packages/server/src/commands/run.ts#L236-L242](../../../../packages/server/src/commands/run.ts#L236-L242) - the daemon's own usage store, built before the host"
  - "[code://packages/server/src/commands/usage.ts#L22-L46](../../../../packages/server/src/commands/usage.ts#L22-L46) - `storeOf`: the daemon's store when served, the file at the terminal"
  - "[code://packages/server/src/commands/usage.ts#L85-L124](../../../../packages/server/src/commands/usage.ts#L85-L124) - a command declared once whose body checks the caller"
  - "[code://packages/server/src/commands/registry.ts#L51-L66](../../../../packages/server/src/commands/registry.ts#L51-L66) - `cliRegistry`, the terminal's commands"
  - "[code://packages/server/src/commands/served.ts#L68-L80](../../../../packages/server/src/commands/served.ts#L68-L80) - `servedRegistry`, the commands a daemon serves"
  - "[code://packages/server/src/commands/served.ts#L53-L58](../../../../packages/server/src/commands/served.ts#L53-L58) - `ServedFacts.usage`, read per request"
  - "[code://packages/server/src/commands/config.ts#L62-L100](../../../../packages/server/src/commands/config.ts#L62-L100) - `walk`, `maskValue` and `maskOption`"
  - "[code://packages/server/src/rootconfig.ts#L210-L230](../../../../packages/server/src/rootconfig.ts#L210-L230) - a root config write checks each option against its schema"
  - "[code://packages/server/src/commands/plugin.ts#L253-L266](../../../../packages/server/src/commands/plugin.ts#L253-L266) - `plugin option` checks a value against its schema"
  - "[code://packages/agent-claude/src/options.ts#L100-L116](../../../../packages/agent-claude/src/options.ts#L100-L116) - `fromEnv: true`, a schema keyword a plugin sets on its own option"
  - "[code://packages/sdk/src/users.ts#L40-L54](../../../../packages/sdk/src/users.ts#L40-L54) - `SUBJECTS`, the grant subjects"
  - "[code://packages/sdk/src/types/users.ts#L40-L81](../../../../packages/sdk/src/types/users.ts#L40-L81) - `Principal`: `id`, `can` and `memberships`"
  - "[code://packages/server/test/usage-port.test.ts](../../../../packages/server/test/usage-port.test.ts) - the daemon's store and a plugin's replacement, run as a process"
---

## Goal

The host has a `vault` port that keeps secrets by scoped name, and the daemon fills it with a local vault: one plain JSON file, `vault.json`, in the configuration directory, mode 0600.
It is not encrypted yet; that is [an idea](../../../ideas/the-local-vault-is-encrypted.md).
Any plugin option may say `{ "$secret": "host:<name>" }` and the plugin is handed the value.
`ahpd vault set|delete|list` manage it, and no command answers a value.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "registerUsage|'usage'" packages --type ts` - the port is named in `types/plugin.ts`, `plugins.ts` (`PORT_KEYS`, `setPort`) and `validate.ts` (`PORT_MEMBERS`, `PORT_METHOD`); the newer `policies` port is wired the same way.
- `rg -n "fromEnv" packages --type ts` - only Claude's options and its model list read one; nothing in the daemon does.
- `rg -n "writeOnly|<set>" packages/server/src` - one mask, `walk` in `commands/config.ts`, behind root config, `config` and `plugin list`.
- `rg -n "isTTY|readline" packages/server/src` - `ask.ts` is the one place a question is put; nothing asks without echo, so `ahpd vault set` takes its value only from piped standard input.

### Runtime path

```
ahpd run: fileVault(vaultPath()) beside the usage store -> HostOptions.vault, ServedFacts.vault -> startup line `vault <path>`
loadPlugins -> loadOne: { "$secret": "host:x" } -> vault in force -> value -> optionsSchema check -> apply
ahpd vault set host:x (value on stdin) -> served: facts.vault() ; terminal: fileVault(vaultPath())
GET /api/config -> walk: a { "$secret" } value is answered as written
```

### Gaps

- No `vault` port, no `Vault` type, no `registerVault`.
- No store for secrets beside `config.json`.
- `loadOne` hands options to the schema check as written, so an object where a string was declared is refused.
- `walk` answers `<set>` for a `writeOnly` option whatever its value, so a reference would be hidden.
- `Not found: a grant for secrets - searched SUBJECTS, decisions for "secret" and "vault"; only config:write (host/17) and team:write (host/36) are near.`

## Decisions locked in

| Decision | Source |
| --- | --- |
| [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | Softov, 2026-10-02 and 2026-10-03 |
| [A secret is named in the host's, a team's or a person's scope](../../../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md) | Softov, 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| `vault` joins `PortKey`, and `registerVault(vault, 'replace')` is wired exactly as `registerUsage` is | decision `the-local-vault-is-a-plain-file-until-it-is-encrypted` | 01 |
| A name is `host:<name>`, `team:<team>/<name>` or `user:<id>/<name>`; anything else is refused where it is written | decision `a-secret-is-named-in-a-host-team-or-user-scope` | 01 |
| A plugin option resolved at load names only `host:` | decision `a-secret-is-named-in-a-host-team-or-user-scope` | 04 |
| `vault.json` is plain JSON, mode 0600, written by temporary file and rename and re-read on every call; no cipher, no key, no locked state, and the port has no `locked()` | decision `the-local-vault-is-a-plain-file-until-it-is-encrypted` | 01, 02 |
| The daemon builds its vault beside the usage store and hands it as `HostOptions.vault` and `ServedFacts.vault`, and says `vault <path>` at start | decision `the-local-vault-is-a-plain-file-until-it-is-encrypted`; the usage port's wiring | 08 |
| A secret is written by: `host:` with `config:write`; `team:<team>/` with `team:write` and a membership in that team; `user:<id>/` only that person; root any. `list` shows names in the same scopes, with `config:read` for `host:`. No new subject | Softov, 2026-10-03, asked "Which grant writes a secret?": "Reuse existing grants" | 05 |
| A plugin keeps a `team:` or `user:` reference to read at use time by marking the option's schema `"secretAtUse": true`, as Claude's `fromEnv` is; the loader leaves that option as written, and computer `needs` and `profiles` set it | Softov, 2026-10-03, asked "How does a plugin keep a team: or user: reference to read at use time?": "secretAtUse schema keyword" | 04 |
| `{ "$secret" }` is resolved in the daemon's option loading, so every plugin gets it; claude/12's `fromEnv` stays in Claude's own options, untouched | Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | 04 |
| A plugin whose option names a secret the vault cannot give (not held, out of scope) is skipped with one problem line, as a schema failure is | (defaulted: the loader's one failure path for options) | 04 |
| A value is never taken from argv: the terminal reads it from piped standard input and refuses a terminal there, so it is never echoed; only the HTTP body carries a `value` field | (defaulted: argv is in `ps` and the shell's history, and there is no question without echo) | 05 |
| `ahpd vault list` shows names and whether each is set, including names `config.json` references that the vault does not hold; never a value | (defaulted: a name may be set without a value until it is filled) | 05 |
| A `$secret` reference is shown as written wherever a plugin's options are answered; nothing else is masked or unmasked | (defaulted: a reference is not a secret, so hiding it hides only where the value comes from) | 06 |
| For now a plugin's options resolve against the daemon's file vault, unless a plugin listed earlier in `plugins` registered one with `'replace'`; a vault plugin is listed first, and its own options cannot name a secret; one function, `vaultInForce`, answers which vault a load resolves against | Softov, 2026-10-03, asked "which vault does a plugin's option resolve against when a plugin replaces the vault?": "as proposed" | 04 |

## Proposed architecture

- **Data flow** - `fileVault` reads `vault.json` on every call; `readSecret(vault, name, work)` in the sdk applies the scope rule; the loader and `PluginHost.secret` both go through it.
- **State flow** - `vault.json` (mode 0600, temp file and rename) holds `{ "version": 1, "secrets": { name: value } }` in plain JSON; the daemon holds nothing of it in memory between calls.
- **Layer responsibilities** - `packages/sdk`: `Vault`, the port, `secretRef`, `scopeOf`, `readSecret`, `PluginHost.secret` · `packages/server`: `fileVault`, `vaultPath`, the daemon's wiring, the loader, `ahpd vault`, the mask.
- **Source-of-truth files** - `CREATE: packages/sdk/src/types/vault.ts`, `CREATE: packages/sdk/src/vault.ts`, `CREATE: packages/server/src/vault.ts`, `CREATE: packages/server/src/commands/vault.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The vault port and the scope rule](task-01-the-vault-port-and-the-scope-rule.md) | todo | - |
| [02 - The daemon's vault is one file](task-02-the-daemons-vault-is-one-encrypted-file.md) | todo | 01 |
| [03 - The vault is unlocked at start](task-03-the-vault-is-unlocked-at-start.md) | dropped | - |
| [04 - A plugin option names a secret](task-04-a-plugin-option-names-a-secret.md) | todo | 08 |
| [05 - ahpd vault sets, deletes and lists](task-05-ahpd-vault-sets-deletes-and-lists.md) | todo | 08 |
| [06 - A reference is shown as written](task-06-a-reference-is-shown-as-written.md) | todo | 01 |
| [07 - Docs](task-07-docs.md) | todo | 04, 05, 06, 08 |
| [08 - The daemon holds its vault](task-08-the-daemon-holds-its-vault.md) | todo | 02 |

## Risks and tradeoffs

- `vault.json` is plain text on disk, readable by anything running as the daemon's user and carried by any backup of the configuration directory; mode 0600 and one known path are the whole protection until [the idea](../../../ideas/the-local-vault-is-encrypted.md) is planned.
- A file written now is the one encryption will have to take over, so task 02 gives it a `version` field.
- The terminal writes `vault.json` while a daemon runs; the daemon re-reads the file on every call, so a set lands at the next read, and two writers at once is last-rename-wins.
- A plugin vault that loads after a plugin naming a secret is not the one that plugin was resolved against; the docs say a vault plugin is listed first.

## Resume state

- **Done so far:** nothing; planned 2026-10-02, reworked 2026-10-03 for a plain file (task 03 dropped, task 08 added).
- **Next action:** [task-01-the-vault-port-and-the-scope-rule.md](task-01-the-vault-port-and-the-scope-rule.md).
- **Open questions:** none.
- **Watch out for:** the task 02 file name still says `encrypted`; a path is an identity, so the name stays and the title is what it builds.

## Final verification checklist

- [ ] A daemon says `vault <path>` at start, and `vault.json` is mode 0600 after a set.
- [ ] A plugin option `{ "$secret": "host:x" }` reaches `apply` as the value; a name the vault does not hold skips the plugin and the line says so.
- [ ] A `"secretAtUse": true` option reaches `apply` as the reference.
- [ ] With a vault plugin listed first, a later plugin's reference resolves against it; the vault plugin's own `$secret` option is refused.
- [ ] `ahpd vault list` and `GET /api/vault/list` show names and whether set, and no response carries a value.
- [ ] Root config answers a `$secret` reference as written.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/DAEMON.md`, `docs/PLUGINS.md` and `plans/index.md` updated.
