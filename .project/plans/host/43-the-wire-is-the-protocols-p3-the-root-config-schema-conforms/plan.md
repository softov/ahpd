---
title: The root config schema is one a client can read
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
  - plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md
  - plans/daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md
refs:
  - "[code://packages/server/src/rootconfig.ts#L156-L180](../../../../packages/server/src/rootconfig.ts#L156-L180) - `pluginKey`, which passes a plugin's raw `optionsSchema` through, or `{}` for one not loaded"
  - "[code://packages/server/src/rootconfig.ts#L183-L201](../../../../packages/server/src/rootconfig.ts#L183-L201) - `schema()`, the daemon keys from `configSchema` with only `description` rewritten"
  - "[code://packages/server/src/commands/options.ts#L248-L252](../../../../packages/server/src/commands/options.ts#L248-L252) - `port` is `integer` and untitled"
  - "[code://packages/server/src/commands/options.ts#L346-L353](../../../../packages/server/src/commands/options.ts#L346-L353) - `http` is `['object', 'boolean']`, with `minimum`, `maximum` and `pattern` below it"
  - "[code://packages/sdk/src/host.ts#L6191-L6192](../../../../packages/sdk/src/host.ts#L6191-L6192) - where the host merges the port's schema into `RootState.config`"
  - "[code://packages/agent-cofold/src/plugin.ts#L41](../../../../packages/agent-cofold/src/plugin.ts#L41) - a plugin's `writeOnly` key, the kind a mask reads"
  - "[code://packages/agent-claude/src/plugin.ts#L64](../../../../packages/agent-claude/src/plugin.ts#L64) - `type: ['string', 'null']` under `additionalProperties`"
  - "[code://packages/server/test/server-root-config.test.ts](../../../../packages/server/test/server-root-config.test.ts) - root config read and write"
  - "npm://@microsoft/agent-host-protocol@0.9.0 - `ConfigPropertySchema` (`src/types/common/state.ts:158-183`): `title` required, `type` one of `string`, `number`, `boolean`, `array`, `object`, closed, and no `_meta`; `RootState._meta` (`channels-root/state.ts:53`)"
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

## Proposed architecture

- **Data flow** - `configSchema` and each plugin's `optionsSchema` -> `conforming()` -> `RootState.config.schema`; a write is checked against the unmapped schema as today.
- **Layer responsibilities** - server: the mapping and the titles · sdk: unchanged.
- **Source-of-truth files** - [`code://packages/server/src/rootconfig.ts`](../../../../packages/server/src/rootconfig.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The root config schema is mapped to ConfigPropertySchema](task-01-the-schema-is-mapped-to-config-property-schema.md) | todo | - |
| [02 - The daemon keys have titles, and http has one type](task-02-the-daemon-keys-have-titles.md) | todo | 01, and open question 1 |
| [03 - A client can tell which keys are secrets](task-03-a-client-can-tell-which-keys-are-secrets.md) | todo | 01, and open question 2 |

## Risks and tradeoffs

- A client that drew a number field with bounds now draws one without them; the write is still refused, with the reason the check gives.
- Mapping and validation read two shapes of one schema; the mapping is a pure function of the other, so they cannot disagree about which keys exist.

## Resume state

- **Done so far:** nothing.
- **Next action:** p1 first; then [task-01-the-schema-is-mapped-to-config-property-schema.md](task-01-the-schema-is-mapped-to-config-property-schema.md).
- **Open questions:**
  1. `http` is `true` or an object in the file, and a `ConfigPropertySchema` has one type: proposed `object`, with `true` shown as `{}` (`true` and `{}` mean the same, the API on the daemon's own listener). Softov asked for the explanation on 2026-10-03; confirm before task 01.
- **Answered:** `writeOnly` is not sent: Softov, 2026-10-03, asked "where does the root config schema say which options are secrets (`writeOnly`), since ConfigPropertySchema is closed and has no `_meta`?": "Not sent". A secret's value already goes out masked as `<set>`.
- **Watch out for:** the audit proposed `writeOnly` as `_meta['ahpd.writeOnly']` on the property, which the protocol does not allow; do not build that.

## Final verification checklist

- [ ] p1's `KNOWN` list holds no `RootState /config/schema` line.
- [ ] A write the daemon's own schema refuses is still refused.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
