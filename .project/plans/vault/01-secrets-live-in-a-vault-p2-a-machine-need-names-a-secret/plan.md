---
title: A machine need names a secret, read when the machine is made
domain: vault
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-03
requires:
  - plans/vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/plan.md
changes: []
creates: []
decisions:
  - decisions/a-secret-is-named-in-a-host-team-or-user-scope.md
  - decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md
refs:
  - "[code://packages/computer/src/plugin.ts#L56-L90](../../../../packages/computer/src/plugin.ts#L56-L90) - `optionsSchema`; `needs` at L71 and `profiles` at L73"
  - "[code://packages/computer/src/plugin.ts#L95-L100](../../../../packages/computer/src/plugin.ts#L95-L100) - `named`, which drops every value that is not a string"
  - "[code://packages/computer/src/plugin.ts#L109-L141](../../../../packages/computer/src/plugin.ts#L109-L141) - `profilesOf`, which reads a profile's `needs` through `named`"
  - "[code://packages/computer/src/plugin.ts#L253](../../../../packages/computer/src/plugin.ts#L253) - the plugin option's need values"
  - "[code://packages/computer/src/plugin.ts#L538-L552](../../../../packages/computer/src/plugin.ts#L538-L552) - the provider handed the host's `machineNeeds`"
  - "[code://packages/computer/src/plugin.ts#L693-L711](../../../../packages/computer/src/plugin.ts#L693-L711) - a dev container machine made for a session, with its owner, team and project"
  - "[code://packages/computer/src/plugin.ts#L742-L762](../../../../packages/computer/src/plugin.ts#L742-L762) - a disposable machine made for a session, with its owner, team and project"
  - "[code://packages/computer/src/provider.ts#L21-L49](../../../../packages/computer/src/provider.ts#L21-L49) - `ProviderOptions`, `needsOf` and `needValues`"
  - "[code://packages/computer/src/provider.ts#L269-L305](../../../../packages/computer/src/provider.ts#L269-L305) - a machine made from the form, with the connection's owner"
  - "[code://packages/computer/src/manifest.ts#L54-L55](../../../../packages/computer/src/manifest.ts#L54-L55) - `Profile.needs`"
  - "[code://packages/computer/src/manifest.ts#L158-L159](../../../../packages/computer/src/manifest.ts#L158-L159) - `ManifestDefaults.needValues`"
  - "[code://packages/computer/src/manifest.ts#L578-L590](../../../../packages/computer/src/manifest.ts#L578-L590) - `manifestOf` hands both to `resolveNeeds`"
  - "[code://packages/sdk/src/machine.ts#L22-L28](../../../../packages/sdk/src/machine.ts#L22-L28) - `NeedSources`, which stays strings"
  - "[code://packages/sdk/src/types/computers.ts#L74-L108](../../../../packages/sdk/src/types/computers.ts#L74-L108) - `MachineSource`: owner, team, project"
  - "[code://packages/computer/test/computer-needs.test.ts](../../../../packages/computer/test/computer-needs.test.ts) - need values from a profile and the option"
---

## Goal

A computer need value, in the plugin's `needs` or a profile's `needs`, may be `{ "$secret": "<scoped name>" }`, and the computer plugin reads it from the vault when it makes the machine, for the person and team the machine is made for.
A `host:` secret works for every machine; a `team:` or `user:` one only for a machine made for that team's work or that person.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "manifestOf\(" packages/computer/src` - three call sites: a dev container for a session, a disposable machine for a session, and a machine from the form.
- `rg -n "needValues|profile\.needs" packages/computer/src` - both are `Record<string, string>` from `named`, and both reach `resolveNeeds` only inside `manifestOf`, which is synchronous.

### Runtime path

```
session start -> MachineSource { owner, team } -> create -> revealed(needValues, profile.needs, work) -> host.secret(name, work) -> strings -> manifestOf -> resolveNeeds -> env need
form write (owner) -> provider.write -> revealed(..., { owner }) -> manifestOf
```

### Gaps

- `named` drops a reference, so a profile naming one has no value for that need.
- Nothing in the computer plugin can read a secret; p1 gives it `host.secret`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A secret is named in the host's, a team's or a person's scope](../../../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md) | Softov, 2026-10-02 |
| [A machine is owned by whoever created it, and its owner pays for the time it is up](../../../decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md) | Softov, 2026-10-02; the owner a `user:` secret is matched against |

| What | Source | Task |
| --- | --- | --- |
| A computer need value names a secret and is resolved when the machine is made | Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | 01 |
| `manifestOf` stays synchronous and is handed strings; the references are read before it is called | (defaulted: one place reads the vault, and `manifestOf`'s callers already hold the owner) | 01 |
| The need nodes are marked `"secretAtUse": true`, so p1's loader leaves their references for this plugin | Softov, 2026-10-03, asked "How does a plugin keep a team: or user: reference to read at use time?": "secretAtUse schema keyword" | 01 |

## Proposed architecture

- **Data flow** - `needValues` and each profile's `needs` keep a reference as written; at each `manifestOf` call site, `revealed(values, work, secret)` swaps every reference for its value through `host.secret`, and a refusal is the machine's refusal.
- **Layer responsibilities** - `packages/computer` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A need value is read from the vault when the machine is made](task-01-a-need-value-is-read-from-the-vault.md) | todo | - |
| [02 - Docs](task-02-docs.md) | todo | 01 |

## Risks and tradeoffs

- The resolved value reaches `docker run` as `-e KEY=VALUE` until container/05 p1 ([a secret reaches a machine by name](../../container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md)) is built; it is the later consumer that keeps the value out of argv, not a requirement of this plan.
- container/05 p1 task 04 declares the need values `writeOnly` strings; this plan adds `secretAtUse` to the same nodes, and whichever lands second keeps both keywords.

## Resume state

- **Done so far:** nothing; planned 2026-10-02.
- **Next action:** [task-01-a-need-value-is-read-from-the-vault.md](task-01-a-need-value-is-read-from-the-vault.md), once p1 is built.
- **Open questions:** none of its own.
- **Watch out for:** a machine made from the form has an owner and no team, so a `team:` secret in a profile picked from the form is refused; that is the scope rule, not a defect.

## Final verification checklist

- [ ] A disposable machine made for `user:ada`'s session has her `user:ada/token` in its environment; one made for `user:bo` is refused, naming the secret.
- [ ] A need naming a secret the vault does not hold refuses the machine and says so.
- [ ] Root config shows the reference, not `<set>` and not the value.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md` and `plans/index.md` updated.
