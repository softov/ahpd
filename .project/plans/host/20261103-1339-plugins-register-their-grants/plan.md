---
title: Plugins register their grants
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://ad352084 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/access/users.ts#L133-L265](../../../../packages/sdk/src/access/users.ts#L133-L265) - `OPERATIONS`, the host's table of subjects, and `operationsOf`, which falls back to the resource groups"
  - "[code://packages/sdk/src/access/users.ts#L183-L194](../../../../packages/sdk/src/access/users.ts#L183-L194) - the `plugin` row, which lacks `apply` and `reload`"
  - "[code://packages/sdk/src/access/users.ts#L296-L316](../../../../packages/sdk/src/access/users.ts#L296-L316) - `grantProblem`, which refuses an operation the table lacks"
  - "[code://packages/sdk/src/host/root.ts#L575-L628](../../../../packages/sdk/src/host/root.ts#L575-L628) - `schemeGrants` and `advertisedGrants`, which build `ahpd.grants` from the table and the resource schemes"
  - "[code://packages/sdk/src/types/plugin.ts#L1186](../../../../packages/sdk/src/types/plugin.ts#L1186) - `registerResourceProvider`, the call `registerGrants` sits beside"
  - "[code://packages/sdk/src/plugins/plugins.ts#L310-L470](../../../../packages/sdk/src/plugins/plugins.ts#L310-L470) - `foldHostOptions`, which folds each plugin's contributions and returns its `problems`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1506-L1520](../../../../packages/sdk/src/plugins/plugins.ts#L1506-L1520) - `registerResourceProvider` on a plugin's host, the pattern to copy"
  - "[code://packages/sdk/src/plugins/validate.ts#L310-L400](../../../../packages/sdk/src/plugins/validate.ts#L310-L400) - the checks a registration goes through"
  - "[code://packages/sdk/src/clients/channel.ts#L42-L44](../../../../packages/sdk/src/clients/channel.ts#L42-L44) - `client:read` and `client:drop`, which no entry lists"
  - "[code://packages/sdk/src/tunnels/channel.ts#L255-L316](../../../../packages/sdk/src/tunnels/channel.ts#L255-L316) - `tunnel:read`, `tunnel:put` and `tunnel:delete`, which no entry lists"
  - "[code://packages/bot/src/provider.ts#L374](../../../../packages/bot/src/provider.ts#L374) - `bot:chat`, which the `bot` entry lacks"
  - "[code://packages/server/src/pluginschannel.ts#L788-L806](../../../../packages/server/src/pluginschannel.ts#L788-L806) - `plugin:apply` and `plugin:reload`, which a role cannot hold"
  - "[code://docs/sdk/USERS.md#L100-L117](../../../../docs/sdk/USERS.md#L100-L117) - the table of subjects and operations"
  - "[code://docs/plugins/PLUGINS.md#L440-L470](../../../../docs/plugins/PLUGINS.md#L440-L470) - how a scheme becomes a subject in `ahpd.grants`"
  - file:///github/ahpw/src/bridges/grants.ts - ahpw's role editor reads `ahpd.grants` and needs no change
---

## Goal

Every grant the host or a plugin requires is on the list of grants the host sends to clients, `ahpd.grants`.
ahpw's role editor draws its cards and chips from that list, so a person can find each grant and give it to a role.
Today some grants are missing from the list, and two of them cannot be given at all.
A plugin registers the grants it uses, and the host reports a grant that nothing registered.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "grant: '|as Grant" packages/*/src` against `OPERATIONS` - the grants that `ahpd.grants` lacks are listed in *Gaps*.
- `git log -S` on each missing grant - each came with a feature that did not add it to the table: e6789b5b, 694687f7, 5de77503.
- `rg "ahpd.grants" /github/ahpw/src` - `grants.ts` and `RolePage.tsx` draw the role editor from the list.

### Runtime path

```
plugin activate -> host.registerGrants(subject, entry) -> foldHostOptions -> HostOptions.grants -> advertisedGrants -> root _meta 'ahpd.grants' -> ahpw RolePage cards and chips
```

### Gaps

- `client:read` and `client:drop` are not on the list.
- `tunnel:read`, `tunnel:put` and `tunnel:delete` are not on the list.
- `bot:chat` is not on the list. The `bot` entry carries only resource operations.
- `plugin:apply` and `plugin:reload` are not on the list, and `grantProblem` refuses them in a role.
- Nothing checks a required grant against the list. Each grant is a string where its action is defined.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A grant is shared: any plugin may register any subject, and a second registration adds its operations | Softov, 2026-11-03: "grants are already shared right?" | 01 |
| Registering puts a grant on the list and never gives it to anyone | Softov, 2026-11-03: "a plugin could ask for a grant, if not exists show on the list. so someone can grant that role" | 01 |
| `plugin:apply` and `plugin:reload` go in the `write` group of `plugin` | Softov, 2026-11-03, chose "In plugin:write" | 02 |
| A required grant that nothing registered is reported, and the plugin loads | Softov, 2026-11-03, chose "Report it, keep loading" | 03 |
| A plugin calls `registerGrants(subject, { title?, description?, operations })` on its host | (defaulted: the shape of `registerResourceProvider`, its sibling) | 01 |
| A registration names operations and no groups. The groups come from `operationsOf`, so the list and the access check give the same answer | (defaulted: registering must not change who may do what) | 01 |
| The first title and description of a subject stay. The table's and a resource provider's come first | (defaulted: one entry per subject) | 01 |
| A registered operation on a subject of the table that the table lacks is a problem line, and is not added | (defaulted: `grantProblem` and the users file check keep the table strict) | 01 |
| The daemon registers `client` with `drop`, and `tunnel` with `put` and `delete`, where it builds those channels | (defaulted: `read` is a group, and the channels require the group) | 02 |
| The bot plugin registers `bot` with `chat` | [code://packages/bot/src/provider.ts#L374](../../../../packages/bot/src/provider.ts#L374) | 02 |
| A required grant counts as listed when its operation is `*`, a group, or an operation of its subject's entry | (defaulted: these are the forms `holds` answers) | 03 |
| ahpw does not change | file:///github/ahpw/src/bridges/grants.ts | - |

## Proposed architecture

- **Data flow** - `registerGrants` -> a contribution -> `foldHostOptions` merges it into `HostOptions.grants` -> `advertisedGrants` adds each subject the table lacks.
- **State flow** - the list is built once per connection, as `ahpd.channels` and `ahpd.methods` are.
- **Layer responsibilities** - `@ahpd/sdk`: the call, the fold, the list, the check · `@ahpd/server`: the `client` and `tunnel` entries · `@ahpd/bot`: the `chat` entry · docs: `PLUGINS.md` and `USERS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin registers its grants](task-01-a-plugin-registers-its-grants.md) | implemented | - |
| [02 - The host lists every grant it uses](task-02-the-host-lists-every-grant-it-uses.md) | implemented | 01 |
| [03 - An unregistered grant is reported](task-03-an-unregistered-grant-is-reported.md) | implemented | 02 |

## Risks and tradeoffs

- `plugin:write` now holds `apply` and `reload`, so a custom role with `plugin:write` may load plugin code. `enable` in the same group loads code too.
- `plans/host/20261103-1339-no-one-gives-a-grant-they-do-not-hold` changes `docs/sdk/USERS.md` too - each build edits other rows of it.

## Resume state

- **Done so far:** task 01 - a plugin registers its grants through `registerGrants`, the fold merges them into `HostOptions.grants`, and `ahpd.grants` lists them with groups from `operationsOf`. Task 02 - the `plugin` row holds `apply` and `reload` in `write`, the daemon registers `client` with `drop` and `tunnel` with `put` and `delete`, and the bot plugin registers `bot` with `chat`. Task 03 - the fold reports a grant no entry lists, naming the plugin and the grant, and the plugin loads; the daemon's own `operation:invoke` is registered too. The build, typecheck, boundary and the sdk, server and bot gates pass.
- **Next action:** the final report; all three tasks are implemented and the plan is ready for its checklist.
- **Open questions:** none.
- **Watch out for:** a registration must not change what `holds` answers. Take the groups from `operationsOf`, never from the plugin.

## Final verification checklist

- [ ] `ahpd.grants` holds `client` with `drop`, `tunnel` with `put` and `delete`, `bot` with `chat`, and `plugin` with `apply` and `reload`.
- [ ] A role may hold `plugin:apply` and `plugin:reload`, and `plugin:write` holds both.
- [ ] A test plugin that registers `notes` with `pin` shows `notes:pin` in `ahpd.grants`, and a role may hold it.
- [ ] Two plugins that register one subject show one entry with the operations of both.
- [ ] A plugin whose channel requires a grant that nothing registered loads, and the fold's `problems` name the plugin and the grant.
- [ ] ahpw's role editor shows the new subjects with no change to ahpw.
- [ ] `pnpm typecheck`, `pnpm --filter @ahpd/sdk test`, `pnpm --filter @ahpd/server test` and `pnpm --filter @ahpd/bot test` pass.
