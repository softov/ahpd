---
title: A plugin id is a slug
domain: plugin
status: built
priority: high
created: 2026-10-14
revalidated: 2026-10-14
requires:
  - plans/daemon/19-a-plugin-is-known-by-its-id/plan.md
refs:
  - "[code://packages/server/src/plugins.ts#L69-L79](../../../../packages/server/src/plugins.ts#L69-L79) - `ids`, `pluginIdOf` and `isNamed`: the id for the run, and how a verb finds a plugin by its id or its spec"
  - "[code://packages/server/src/plugins.ts#L712-L726](../../../../packages/server/src/plugins.ts#L712-L726) - `namePlugin`: the module's `name` export, or the provisional id"
  - "[code://packages/server/src/plugins.ts#L760-L790](../../../../packages/server/src/plugins.ts#L760-L790) - `loadOne`, where a plugin is skipped with a problem line"
  - "[code://packages/server/src/plugins.ts#L1083-L1119](../../../../packages/server/src/plugins.ts#L1083-L1119) - `loadPlugins` names every entry and checks for a repeated id"
  - "[code://packages/sdk/src/resources/records.ts#L276-L284](../../../../packages/sdk/src/resources/records.ts#L276-L284) - `RECORD_SLUG` and `isRecordSlug`, the slug rule records use"
  - "[code://packages/sdk/src/plugins/plugins.ts#L138-L166](../../../../packages/sdk/src/plugins/plugins.ts#L138-L166) - `routePrefix` and `routeOf`: a route is served under `/plugins/<id>/`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L791-L793](../../../../packages/sdk/src/plugins/plugins.ts#L791-L793) - a plugin's principal is `plugin:<id>`"
  - "[code://packages/sdk/src/utils/values.ts#L40-L52](../../../../packages/sdk/src/utils/values.ts#L40-L52) - `ownerOf`, the reading of a saved owner, and `ownerOfPrincipal`"
  - "[code://packages/sdk/src/sessions/sessions.ts#L610-L618](../../../../packages/sdk/src/sessions/sessions.ts#L610-L618) - a saved session's owner and senders, read through `ownerOf`"
  - "[code://packages/server/src/scheduled.ts#L404](../../../../packages/server/src/scheduled.ts#L404) - a saved automation's owner, read through `ownerOf`"
  - "[code://packages/sdk/src/usage/usage.ts#L242-L266](../../../../packages/sdk/src/usage/usage.ts#L242-L266) - `entriesIn`, the one reading of a usage line, with its `owner` and `pools`"
  - "[code://packages/server/src/plugins.ts#L1231-L1292](../../../../packages/server/src/plugins.ts#L1231-L1292) - `describePlugin`, the row `ahpd plugin list` shows"
  - "[code://packages/sdk/src/automations/triggers.ts#L192-L193](../../../../packages/sdk/src/automations/triggers.ts#L192-L193) - a trigger's `owners` filter, compared with a session's owner"
  - "[code://packages/webhook/src/route.ts#L8-L11](../../../../packages/webhook/src/route.ts#L8-L11) - `NAME` and `PREFIX`, the webhook's id and route"
  - "[code://docs/plugins/PLUGINS.md#L39-L47](../../../../docs/plugins/PLUGINS.md#L39-L47) - the section on the id"
  - https://github.com/softov/ahpw/blob/main/plugin/index.ts - ahpw exports `ahpd-web` and serves `/plugins/ahpd-web/`
---

## Goal

Every plugin id is a bare slug, the rule records use: lowercase letters, digits and dashes, one to forty of them, starting with a letter.
The npm package names stay `@ahpd/<name>`, and the id of each first-party plugin is the `<name>`.
A route is then `/plugins/webhook/`, an owner is `plugin:webhook`, and a root config key is `plugins.agent-claude`, with no `%40` and no `/`.
The daemon refuses a plugin whose exported `name` is not a slug.
Work saved under an old owner, such as `plugin:@ahpd/webhook`, reads as the new owner, and nothing on disk is rewritten.
This replaces the answer of [daemon 19](../../daemon/19-a-plugin-is-known-by-its-id/plan.md) that the first-party plugins export their package name.
It ships in 0.12.0.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "export const name" packages/*/src` - nine first-party plugins export `@ahpd/<name>`; the webhook exports it through `NAME` in `route.ts`.
- `rg -n "plugin:@ahpd|%40ahpd|plugins\.@ahpd" packages docs` - the webhook route and its tests, `docs/plugins/WEBHOOKS.md`, the route fixture `@ahpd/plugin-route` and its test, and one root config test.
- `rg -n "ownerOf\(" packages/sdk/src packages/server/src` - sessions, wake senders and scheduled automations read a saved owner through `ownerOf` in `values.ts`; usage reads its lines in `entriesIn`.
- `rg -n "@ahpd/(agent-|bot|push|computer|webhook|tunnel)|plugins\.@ahpd|%40ahpd|ahpd-web|plugin:@ahpd" /github/ahpapp/src /github/ahpc/src` - nothing. The one `@ahpd/` string in ahpapp is the install line `npm i -g @ahpd/server` in `HostForm.tsx`, a package name.
- `rg -n "ahpd-web|/plugins/" /github/ahpw` - the id and prefix in `plugin/index.ts`, the comment in `vite.config.ts`, `README.md:55`, `plugin/index.test.ts` and `plugin/static.test.ts`. The `ahpd-web.` keys in `localStorage` are an app prefix and stay.

### Runtime path

```
module `name` export -> namePlugin -> id -> loadOne (slug check) -> pluginHost(id)
  -> route /plugins/<id>/ · principal plugin:<id> · root config plugins.<id>
saved owner plugin:@ahpd/<x> -> ownerOf / entriesIn -> plugin:<x>
```

### Gaps

- The loader takes any non-empty string as an id.
- A first-party id carries `@` and `/`, so its route is percent-encoded and its owner is `plugin:@ahpd/<x>`.
- No reading of a saved owner knows that an id changed.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every plugin id is a bare slug, `^[a-z][a-z0-9-]{0,39}$`, the rule of `isRecordSlug`. The npm package names stay `@ahpd/...`. The ids are `agent-acp`, `agent-claude`, `agent-cofold`, `agent-pi`, `bot`, `computer`, `push`, `tunnel-devtunnel`, `webhook`, and ahpw's `web` | Softov, 2026-10-14, asked "Which form should a plugin id take?": "computer" | 01, 04 |
| The change ships in 0.12.0 | Softov, 2026-10-14, asked "Does it go into 0.12.0?": "Yes, in 0.12.0" | 01, 02, 03, 04 |
| A plugin whose exported `name` is not a slug is skipped at load, with a problem line | Softov, 2026-10-14, asked "Should the daemon refuse a third-party plugin whose id is not a slug?": "Refuse at load" | 02 |
| A fallback id `@scope/name` becomes `scope-name`. Every fallback id, from the manifest's `name`, the file name or the spec, is checked against the slug rule, and a plugin whose id is still not a slug is skipped with the same problem line | Softov, 2026-10-14, asked "A plugin exports no `name`, and its package is `@acme/y`. Which id should the daemon give it?": "acme-y" | 05 |
| An owner `plugin:@ahpd/<x>` reads as `plugin:<x>`, and `plugin:ahpd-web` reads as `plugin:web`, when the host reads saved sessions, wake senders, automations and usage. Nothing on disk is rewritten | Softov, 2026-10-14, asked "Sessions, automations and usage saved under an old owner such as plugin:@ahpd/webhook: what happens to them?": "Read the old name as the new" | 03 |
| A grant, a policy, a usage rule or any other configuration a person writes reads `plugin:@ahpd/<x>` as `plugin:<x>`, through `currentOwner`. Nothing on disk is rewritten | Softov, 2026-10-14, asked "Grants, policies and usage rules that a person wrote by hand with `plugin:@ahpd/<x>` are not read as `plugin:<x>`. What should happen?": "Read them as the new name" | 06 |
| Root config keeps flat `plugins.<id>` keys, so a key reads `plugins.agent-claude` | Softov, 2026-10-14, "Keep flat keys" | 01 |
| `config.json` keys its entries by spec, so it needs no migration, and a spec such as `@ahpd/bot` still names its plugin in a verb and in `--plugin-option` | [code://packages/server/src/plugins.ts#L79](../../../../packages/server/src/plugins.ts#L79) | - |
| `routePrefix` keeps the encoding of each segment as a guard. No id that loads holds `@` or `/`, so no such name reaches a route today | (defaulted: follows from "Refuse at load") | 07 |
| A usage read by pool name reads the name through `currentOwner`. This covers `usage://<pool>` and its leaves, and the pool param of `x-ahpd/usage/totals`, `range` and `records`. A read of `plugin:@ahpd/bot` answers the lines saved under `plugin:bot` | (defaulted: follows from "Read the old name as the new") | 07 |
| `ahpd plugin list` shows a plugin whose id is not a slug as `error`, with the problem `its name is not a slug`, like a manifest that does not hold. The listing does not say `ready` for a plugin that a load skips | (defaulted: follows from "Refuse at load") | 07 |
| The tasks go in this order: the ids change first, then the loader refuses a name that is not a slug, because the refusal would skip every first-party plugin that still exports `@ahpd/<name>` | (defaulted: each task's commit keeps the gates green) | 01, 02 |

## Proposed architecture

- **Data flow** - a module's `name` -> `namePlugin` -> `loadOne`, which skips a name that is not a slug. The id names the route, the principal and the root config key.
- **Event flow** - unchanged.
- **State flow** - one function in `values.ts` maps an old first-party owner to the new one. `ownerOf`, `entriesIn` and the trigger filter call it.
- **Layer responsibilities** - server `plugins.ts`: the slug check · each plugin package: its `name` · sdk `values.ts`, `usage.ts`, `triggers.ts`: old owners · docs · ahpw `plugin/index.ts`.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts), [`code://packages/sdk/src/utils/values.ts`](../../../../packages/sdk/src/utils/values.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ahpd's plugins export slugs](task-01-ahpds-plugins-export-slugs.md) | done | - |
| [02 - The daemon refuses a plugin whose name is not a slug](task-02-daemon-refuses-a-non-slug-name.md) | done | 01 |
| [03 - An old owner name reads as the new one](task-03-an-old-owner-name-reads-as-the-new-one.md) | done | 01 |
| [04 - ahpw exports `web` and serves `/plugins/web/`](task-04-ahpw-exports-web.md) | done | 01 |
| [05 - A fallback id is a slug too](task-05-a-fallback-id-is-a-slug-too.md) | done | 02 |
| [06 - A hand-written old owner reads as the new one](task-06-old-owner-reads-as-the-new-one.md) | done | 03 |
| [07 - The listing and usage reads agree with the id](task-07-listing-and-usage-agree-with-the-id.md) | done | 03, 05 |

## Risks and tradeoffs

- A URL that an operator gave a caller, such as `/plugins/%40ahpd/webhook/ci` or `/plugins/ahpd-web/`, stops answering - the 0.12.0 release notes name the new paths.
- A third-party plugin that exports a scoped name, such as `@acme/x`, stops loading - the problem line names the slug rule.
- A fallback id that is not a slug, such as the file name `My_Plugin`, stops its plugin from loading. The problem line names the slug rule.
- No client hardcodes a plugin id. A search of `/github/ahpapp/src` and `/github/ahpc/src` looked for `@ahpd/` ids, `plugins.@ahpd`, `%40ahpd`, `ahpd-web` and `plugin:@ahpd`. It finds only `npm i -g @ahpd/server` in `ahpapp/src/components/HostForm.tsx:56`, which is a package name.

## Resume state

- **Done so far:** built 2026-10-16. Tasks 01 to 07 are done, and task 04 is ahpw commit `e500c19`. See [implemented.md](implemented.md).
- **Next action:** none. Every check by hand passed, the last on 2026-11-09.
- **Open questions:** none.
- **Watch out for:** a test that asserts an `@ahpd/<x>` id, such as a root config key or a `plugin @ahpd/x loading` line, changes to the slug. A spec written as `@ahpd/<x>` is a package name and stays. ahpw is a separate repository, and task 04 is committed there.

## Final verification checklist

- [x] A daemon with `@ahpd/webhook` serves `/plugins/webhook/<endpoint>`.
- [x] A plugin that exports `name = '@acme/x'` is skipped, and the problem line names the slug rule.
- [x] A session saved with owner `plugin:@ahpd/bot` reads back with owner `plugin:bot`. Checked on 2026-11-03 in `ahpc session list --json`.
- [x] ahpw answers under `/plugins/web/`.
- [x] `plans/index.md` updated.
