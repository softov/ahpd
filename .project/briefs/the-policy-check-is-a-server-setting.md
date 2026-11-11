---
title: The policy check is a server setting
created: 2026-11-11
refs:
  - git://ea240db71 - the commit of ahpd the facts were checked at
  - "[code://packages/server/src/rootconfig.ts#L30-L46](../../packages/server/src/rootconfig.ts#L30-L46) - `DAEMON_KEYS`, the daemon keys a client may edit, and `LIVE`, the ones applied while the daemon runs"
  - "[code://packages/server/src/rootconfig.ts#L137-L149](../../packages/server/src/rootconfig.ts#L137-L149) - `conforming`, which turns a key's schema into the property a client draws"
  - "[code://packages/server/src/commands/options.ts#L935-L943](../../packages/server/src/commands/options.ts#L935-L943) - the `policies` schema, with `check`, `payOrder` and `ownLimits` and no titles"
  - "[code://packages/server/src/commands/options.ts#L1017](../../packages/server/src/commands/options.ts#L1017) - `FILE_ONLY`, which holds `policies` and `modelProxy` alike"
  - "[code://packages/server/src/commands/run.ts#L559-L564](../../packages/server/src/commands/run.ts#L559-L564) - `startingChecks`, the start warning for an empty store with the check on"
  - "[code://docs/sdk/HOST.md#L168](../../docs/sdk/HOST.md#L168) - the list of daemon keys a client is shown"
  - "[code://docs/sdk/HOST.md#L207](../../docs/sdk/HOST.md#L207) - `config:change`, the grant a root config write needs"
  - "[code://docs/sdk/POLICY.md#L94](../../docs/sdk/POLICY.md#L94) - *The switch*, which says the setting has no flag"
  - "[code://docs/server/CONFIGURE.md#L127](../../docs/server/CONFIGURE.md#L127) - the keys with no flag"
  - https://github.com/ahpio/ahpw/blob/33f004c/src/resources/host/sections.ts#L15-L21 - ahpw's daemon sections; a key no section names is drawn under Other
---

# The policy check is a server setting

Softov wants to switch the policy checks on and off from the server settings page, and not only by editing `config.json`.
He made a policy, saw that it refused nothing, and found that the switch `policies.check` is not on that page.
Today the only ways to set it are a hand edit of the file and `ahpd config set policies`, both followed by a restart.

## What others do

The reference for this change is ahpd's own `modelProxy` key.
It is a file-only key with no flag, as `policies` is, and it is also in `DAEMON_KEYS`.
A client draws it from its schema, a write goes to `config.json`, and the answer marks a restart as needed.
VS Code's agent host has no policy store, so it has no key to follow here.

## What ahpd has today

- `DAEMON_KEYS` lists the 23 daemon keys a client may edit, and `policies` is not one of them.
- The comment on `DAEMON_KEYS` leaves out keys about how the daemon starts or who may reach it, such as `users` and the connection token.
- No decision in `.project/decisions/` names `policies` as left out on purpose.
- `configSchema` declares `policies` as an object of `check`, `payOrder` and `ownLimits`, with no title on any of them.
- Its description ends "Set in the configuration file only.", which is also true of `modelProxy` and `usage`.
- `ahpd config set policies '{"check":true}'` writes the key today, and so does `POST /config/set` with `config:write`.
- The host reads `policiesCheck` once, at start, so a change needs a restart.
- With the check on and an empty store, the daemon refuses every session and turn but root's.
- It says so once at start.
- The root connection is never checked, so switching the check on cannot lock the daemon itself out.
- A root config write needs `config:change`, the same grant every other daemon key needs.
- ahpw draws a daemon key it has no section for under Other, so it shows a new key with no ahpw change.

## Who writes

- No open PR on `ahpio/ahpd` touches `rootconfig.ts`, `commands/options.ts` or `docs/sdk/POLICY.md` at `ea240db71`.
- No worktree under `/github/ahpd.worktrees/` changes `rootconfig.ts` or `commands/options.ts`.
- No `maycxc` fork branch changes those files.
- ahpw's `sections.ts` names the daemon sections; this change does not need it to, as *What ahpd has today* says.

## The change

- `policies` joins `DAEMON_KEYS`, so a client with `config:read` sees it and one with `config:change` writes it.
- It is not in `LIVE`: a write is saved to `config.json` and the answer marks a restart as needed, as `modelProxy` does.
- `check`, `payOrder` and `ownLimits` each get a title and a short description, so a form draws three plain controls.
- The key's description no longer says "Set in the configuration file only."
- A write that turns `check` on while the store holds no policy is saved, and its description says that every person is then refused.
- `docs/sdk/HOST.md` adds `policies` to the daemon keys, and `docs/sdk/POLICY.md` *The switch* says where it is set.
- A test reads `policies` from the root schema and writes it through root config.

## Open points

1. Whether `usage` joins too, since `usage.timezone` decides when a limit's day and week begin.
2. Whether the check applies live instead of on restart. The host takes `policiesCheck` at start, so live needs the host to read it per check.
3. Whether a write that turns the check on with an empty store is refused instead of saved with a warning.
4. Whether ahpw gives policies a section of its own, or leaves the key under Other.
