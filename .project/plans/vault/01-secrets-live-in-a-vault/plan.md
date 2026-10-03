---
title: Secrets live in a vault, and a plugin option or a machine need names one
domain: vault
status: active
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
  - "[code://packages/sdk/src/types/plugin.ts#L31-L44](../../../../packages/sdk/src/types/plugin.ts#L31-L44) - `PortKey`, which `vault` joins"
  - "[code://packages/sdk/src/types/plugin.ts#L233-L240](../../../../packages/sdk/src/types/plugin.ts#L233-L240) - `registerUsage`, the registration `registerVault` mirrors"
  - "[code://packages/server/src/plugins.ts#L515-L533](../../../../packages/server/src/plugins.ts#L515-L533) - where a plugin's options are merged and checked, before `apply`"
  - "[code://packages/server/src/commands/config.ts#L62-L69](../../../../packages/server/src/commands/config.ts#L62-L69) - the `writeOnly` mask"
  - "[code://packages/agent-claude/src/options.ts#L225-L243](../../../../packages/agent-claude/src/options.ts#L225-L243) - claude/12's `{ \"fromEnv\": \"NAME\" }`, which stays"
  - "[code://packages/sdk/src/types/computers.ts#L74-L108](../../../../packages/sdk/src/types/computers.ts#L74-L108) - `MachineSource`, the owner and team a machine is made for"
---

## Goal

A secret is kept in a vault, by a name scoped to the host, a team or a person, and `config.json` names it with `{ "$secret": "<scoped name>" }` instead of holding it.
The daemon ships a local vault, one plain JSON file at mode 0600, which a plugin may replace through a `vault` port.
Encrypting it is [an idea](../../../ideas/the-local-vault-is-encrypted.md), not this plan.
A reference in any plugin option is resolved when the plugin loads, and one in a computer need value when the machine is made.
Repository tokens follow later, in their own plan.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above and each child's own.

### Runtime path

```
ahpd run -> fileVault(vault.json) beside the usage store -> HostOptions.vault, startup line `vault <path>`
config.json plugins[].options { "$secret": "host:<name>" } -> loadOne resolves -> schema check -> apply gets the value
computer profile need { "$secret": "user:<id>/<name>" } -> machine made -> host.secret(name, owner, team) -> env value
ahpd vault set|delete|list -> the daemon's vault (served) or the file itself (at the terminal)
```

### Gaps

- No port, no store, no reference form, no command; see each child.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | Softov, 2026-10-02 and 2026-10-03 |
| [A secret is named in the host's, a team's or a person's scope](../../../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md) | Softov, 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| The vault unlocks plugin options and machine needs first: `{ "$secret": "<scope:name>" }` in any plugin option or computer need, resolved at load or at machine creation | Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | p1, p2 |
| claude/12's `{ "fromEnv": "NAME" }` stays as the cheaper route | Softov, 2026-10-02, same answer | p1 |
| Repository tokens follow later | Softov, 2026-10-02, same answer | - |
| No encryption, no key rotation, no remote vault, no `plugin:` scope | Softov, 2026-10-03: "to the valt now. crypt lattter"; (defaulted: kept simple; the scope decision names `plugin:` as left out) | - |

## Proposed architecture

- **Data flow** - a reference is resolved by the daemon at load (`host:` only) and by the computer plugin at machine creation (any scope, against the machine's owner and team); a value never leaves the host towards a client.
- **State flow** - one plain JSON file, `vault.json`, mode 0600, in the configuration directory, re-read on every call.
- **Layer responsibilities** - `packages/sdk`: the port, the reference form and the scope rule · `packages/server`: the local vault, the key at start, resolution at load, the commands, the mask · `packages/computer`: resolution at machine creation.

## Tasks

Child plans, each scoped to one package or two.

| Plan | Package | Status | Depends on |
| --- | --- | --- | --- |
| [p1 - The vault port and the daemon's plain file](../01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/plan.md) | sdk, server | built | - |
| [p2 - A machine need names a secret](../01-secrets-live-in-a-vault-p2-a-machine-need-names-a-secret/plan.md) | computer | planned | p1 |

## Risks and tradeoffs

- `vault.json` is plain text on disk, as readable as `config.json` is today to anything running as the daemon's user; the gain now is one place and one name for every secret, and encryption is [the idea](../../../ideas/the-local-vault-is-encrypted.md).

## Resume state

- **Done so far:** nothing; planned 2026-10-02, reworked 2026-10-03 for a plain file.
- **Next action:** [p2](../01-secrets-live-in-a-vault-p2-a-machine-need-names-a-secret/plan.md), task 01.
- **Open questions:** each child lists its own; p1 holds which vault resolves options when a plugin replaces it.
- **Watch out for:** container/05 p1 ([a secret reaches a machine by name](../../container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md)) is what keeps a resolved value out of `docker` argv; this plan does not need it, but a secret in a machine is only out of `ps` once it is built.

## Final verification checklist

- [ ] A plugin option written `{ "$secret": "host:<name>" }` reaches `apply` as the value, and root config shows the reference.
- [ ] A disposable machine made for a person's session has their `user:` secret in its environment, and another person's session is refused it.
- [ ] A daemon says `vault <path>` at start, and a plugin naming a secret the vault does not hold is skipped with a line that says so.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/DAEMON.md`, `docs/PLUGINS.md`, `docs/COMPUTER.md` and `plans/index.md` updated.
