---
title: The root config schema is one a client can read
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
  - plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md
  - plans/daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/server/src/rootconfig.ts#L108-L141](../../../../packages/server/src/rootconfig.ts#L108-L141) - `conforming`, which maps one schema to a property of the protocol's root config"
  - "[code://packages/server/src/rootconfig.ts#L249-L297](../../../../packages/server/src/rootconfig.ts#L249-L297) - `pluginKey` and `schema()`, where every key served is mapped"
  - "[code://packages/server/src/commands/options.ts#L338-L500](../../../../packages/server/src/commands/options.ts#L338-L500) - `serverFields`, the daemon keys, each with its title"
  - "[code://packages/server/src/commands/options.ts#L459-L471](../../../../packages/server/src/commands/options.ts#L459-L471) - `http`, typed `['object', 'boolean']`, with `minimum`, `maximum` and `pattern` below it"
  - "[code://packages/server/src/commands/options.ts#L742-L749](../../../../packages/server/src/commands/options.ts#L742-L749) - `httpOf`: `true` is `{}`, `false` and absent are off"
  - "[code://packages/sdk/src/host/root.ts#L392-L398](../../../../packages/sdk/src/host/root.ts#L392-L398) - where the host merges the port's schema into `RootState.config`"
  - "[code://packages/agent-cofold/src/plugin.ts#L41](../../../../packages/agent-cofold/src/plugin.ts#L41) - a plugin's `writeOnly` key, the kind a mask reads"
  - "[code://packages/agent-claude/src/plugin.ts#L79](../../../../packages/agent-claude/src/plugin.ts#L79) - `type: ['string', 'null']` under `additionalProperties`"
  - "[code://packages/server/test/server-root-config.test.ts](../../../../packages/server/test/server-root-config.test.ts) - root config read and write"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ConfigPropertySchema` (`src/types/common/state.ts:159-198`): `title` required, `type` one of `string`, `number`, `boolean`, `array`, `object`, closed, no `_meta`, and `minItems`/`maxItems` for an array; `RootState._meta` (`channels-root/state.ts:53`)"
---

## Goal

A connection with `config:read` receives a root config schema whose every property is a `ConfigPropertySchema`: titled, one of the five types, and nothing undeclared.
What a value may be is still checked against ahpd's own schema, which keeps its integers, bounds, patterns and `writeOnly`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "writeOnly" packages/*/src` - plugin option schemas in acp, computer, claude and cofold mark credentials `writeOnly`, some on `additionalProperties`; the server's mask reads them.
- `rg -n "writeOnly" /github/ahpapp/src /github/ahpc/src` - no client reads `writeOnly` today.
- `rg -n "_meta" node_modules/@microsoft/agent-host-protocol/src/types/common/state.ts` - `ConfigPropertySchema` declares no `_meta`, so the audit's `_meta['ahpd.writeOnly']` on a property would itself be undeclared; `RootState` has `_meta`.

### Gaps

- The daemon keys have no `title`; `port` and plugin counts are `integer`; `http` has two types; `minimum`, `maximum`, `pattern` and `writeOnly` are undeclared; a plugin not loaded answers `options: {}`, which has neither `type` nor `title`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each property is mapped to a conforming one on the way out, and validation stays on ahpd's own schema | the request, 2026-10-03, item 4 | 01 |
| `integer` is sent as `number`; `minimum`, `maximum` and `pattern` are folded into the `description` | the request, 2026-10-03, item 4 | 01 |
| A property with no `title` takes its key, spaced and capitalised | (defaulted: the daemon keys get real titles in 02, and a plugin's options have only their keys) | 01 |
| A `type` list such as `['string', 'null']` is sent as its first non-`null` member; `oneOf`, `anyOf`, `const` and other undeclared keywords are dropped | (defaulted: `ConfigPropertySchema` has no union and no room for them) | 01 |
| A plugin not loaded answers `options` as `{ type: 'object', title: 'Options' }` | (defaulted: the smallest conforming shape that still says nothing about its keys) | 01 |
| The mapping runs in the server's `schema()`, the one port producing the schema | (defaulted: the host's own `ROOT_CONFIG_SCHEMA` already conforms) | 01 |
| The daemon keys carry titles of their own | (defaulted: a title derived from `mcpServers` reads worse than one written) | 02 |
| `http` is declared `type: 'object'`; a stored `true` is answered as `{}` (on, every default), and the object form carries `port` and `host` | Softov, 2026-10-03, asked "ahpd accepts `http` in root config two ways. Should `true` mean `{}` (enabled, all defaults), with the object form for settings?": "Object, true means {}" | 02 |
| A stored `http: false` is answered as no `http` value, and a client turns the API off by writing `null`, which removes the key; a write stores the object as sent, and the file keeps accepting `true` and `false` by hand | (defaulted: `false` and absent already mean off in `httpOf`, and the object schema has no off value of its own) | 02 |
| A lone bound reads `At least 0.` for a `minimum` and `At most N.` for a `maximum`; both read `Between A and B.` | Softov, 2026-10-07, asked "What should a lone bound say?": "At least 0." for a minimum alone, "At most N." for a maximum alone, "Between A and B." for both | 01 |
| An unnamed level is titled where it is declared, and takes its parent's title otherwise: the daemon names the items of a list it declares, so `paths` items read `Folder` | Softov, 2026-10-07, asked "What should the mapping title `items` and an object `additionalProperties` with?": "Named where used, else parent's" | 01 |
| `paths`, `updateCheck`, `advancedTools` and `wire` are titled `Folders`, `Update check`, `Advanced tools` and `Wire capture` | Softov, 2026-10-07, asked "Which titles should the four daemon keys the plan does not name carry?": "`paths` "Folders", `updateCheck` "Update check", `advancedTools` "Advanced tools", `wire` "Wire capture"" | 02 |

## Proposed architecture

- **Data flow** - `configSchema` and each plugin's `optionsSchema` -> `conforming()` -> `RootState.config.schema`; a write is checked against the unmapped schema as today.
- **Layer responsibilities** - server: the mapping and the titles · sdk: unchanged.
- **Source-of-truth files** - [`code://packages/server/src/rootconfig.ts`](../../../../packages/server/src/rootconfig.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The root config schema is mapped to ConfigPropertySchema](task-01-the-schema-is-mapped-to-config-property-schema.md) | done | - |
| [02 - The daemon keys have titles, and http has one type](task-02-the-daemon-keys-have-titles.md) | done | 01 |
| [03 - A client can tell which keys are secrets](task-03-a-client-can-tell-which-keys-are-secrets.md) | dropped | 01 |

## Risks and tradeoffs

- A client that drew a number field with bounds now draws one without them; the write is still refused, with the reason the check gives.
- Mapping and validation read two shapes of one schema; the mapping is a pure function of the other, so they cannot disagree about which keys exist.

## Resume state

- **Done so far:** tasks 01 and 02 are implemented, 2026-10-07. `conforming()` maps every daemon key and plugin key in the server's `schema()`. The daemon keys carry titles. `http` is sent as one type, and a stored `true` answers `{}`. `KNOWN` in `packages/sdk/test/wire.test.ts` is empty.
- **Next action:** none. Reviewed and closed on 2026-10-07; task 03 is dropped.
- **Open questions:** none.
- **Answered:** `writeOnly` is not sent: Softov, 2026-10-03, asked "where does the root config schema say which options are secrets (`writeOnly`), since ConfigPropertySchema is closed and has no `_meta`?": "Not sent". A secret's value already goes out masked as `<set>`.
- **Watch out for:** the audit proposed `writeOnly` as `_meta['ahpd.writeOnly']` on the property, which the protocol does not allow; do not build that.

## Final verification checklist

- [x] p1's `KNOWN` list holds no `RootState /config/schema` line.
- [x] A write the daemon's own schema refuses is still refused.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test` pass. `tsc --noEmit` passes; `pnpm test` does not on this build box, for the load the notes in implemented.md record.
- [x] `plans/index.md` updated.
