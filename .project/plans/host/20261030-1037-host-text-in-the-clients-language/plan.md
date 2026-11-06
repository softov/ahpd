---
title: The host's text comes in the client's language
domain: host
status: built
priority: medium
created: 2026-10-30
revalidated: 2026-10-30
refs:
  - git://cab37d1e - the commit of `main` the facts were checked at, and the last one that holds the brief `.project/briefs/the-host-speaks-the-clients-language.md`
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/common/commands.ts - `initialize` takes `locale`, a BCP 47 tag, and the server "SHOULD use this to localise user-facing strings"
  - "[code://packages/sdk/src/host/handshake.ts#L148-L231](../../../../packages/sdk/src/host/handshake.ts#L148-L231) - `initialize`, which keeps `clientId` and the agreed version and ignores `locale`"
  - "[code://packages/sdk/src/host/handshake.ts#L370-L413](../../../../packages/sdk/src/host/handshake.ts#L370-L413) - `reconnect`, which the AHP multi-host client tries before `initialize`"
  - "[code://packages/sdk/src/types/host.ts#L1161-L1176](../../../../packages/sdk/src/types/host.ts#L1161-L1176) - `Connection`, where `locale` goes beside `protocolVersion`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1527-L1605](../../../../packages/sdk/src/host/sessionmethods.ts#L1527-L1605) - `resolveSessionConfig`, the form a person reads first, answered for the caller"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L60-L240](../../../../packages/sdk/src/host/sessionconfig.ts#L60-L240) - the host's own form keys, with English titles and labels"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L186-L215](../../../../packages/sdk/src/resources/recordschannel.ts#L186-L215) - `send`, which sends one record to one reader on one client"
  - "[code://packages/server/src/pluginschannel.ts#L226-L268](../../../../packages/server/src/pluginschannel.ts#L226-L268) - `rowOf`, the plugin row with its title, manifest and options form"
  - "[code://packages/server/src/plugins.ts#L471-L541](../../../../packages/server/src/plugins.ts#L471-L541) - `ahpd.icons`, read from the package beside the manifest, the pattern for `ahpd.i18n`"
  - "[code://packages/server/src/plugins.ts#L652-L686](../../../../packages/server/src/plugins.ts#L652-L686) - `checkField` and `checkFields`, which hold each manifest field to its shape"
  - "[code://packages/sdk/src/host/chatattachment.ts#L15-L22](../../../../packages/sdk/src/host/chatattachment.ts#L15-L22) - text the model reads stays English"
  - npm://@activepieces/piece-resend@0.6.1 - a piece ships `src/i18n/<lang>.json`, the folder layout for `ahpd.i18n`
---

## Goal

A person reads the host's text in the language their client uses.
A Portuguese ahpw screen today shows the new session form and the plugins screen in English.
After this plan, the host keeps the `locale` a client sends and answers both in that locale.
Each plugin may ship its own catalog, and English stays the fallback for each string.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "locale" packages/sdk/src packages/server/src` - nothing reads `locale`; the hits are `localeCompare`.
- `rg -n "locale" node_modules/@microsoft/agent-host-protocol/dist/client` - `AhpClient.initialize` takes `locale`, and the multi-host runtime never sends it.
- `rg -n "ahpd.icons" packages/server/src/plugins.ts` - a manifest field that names files in the package, read at load.
- `rg -n "title:" packages/sdk/src/host/sessionconfig.ts` - the host's form keys and their English titles.

### Runtime path

```
client -> initialize { locale } -> connection.locale, and the locale of that client id
client -> reconnect { locale } -> the same, when the field is there
resolveSessionConfig -> host and plugin catalogs -> titles, descriptions, enum labels in the locale
x-ahpd-plugins send to a reader -> translate(record, locale of the client) -> the reader's row
```

### Gaps

- The host drops `locale` from `initialize`.
- No catalog exists, for the host or for a plugin.
- `resolveSessionConfig` and the plugins channel send English to every client.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A catalog is keyed by field path: `meta`, `options.<key>` and `session.<key>`, each with `title`, `description` and `enum` | Softov, 2026-10-30: "Field path, like dsh" | 02 |
| The host's catalogs are JSON too, in the same shape as a plugin's | Softov, 2026-10-30: "JSON, like plugins" | 02 |
| A client that changes its language connects again, and the host reads `locale` then | Softov, 2026-10-30: "Client reconnects" | 01 |
| Only an answer for one caller is translated; a state many clients share stays English | Softov, 2026-10-30: "Only per-caller replies" | 03, 04 |
| The first slice is the new session form and the plugins screen | Softov, 2026-10-30: "Form and plugins" | 03, 04 |
| A records channel counts as a per-caller answer, because each reader gets its own snapshot and diffs | (defaulted: `send` builds each reader's action) | 04 |
| `reconnect` also reads `locale` when a client sends it, as an ahpd extension | Softov, 2026-10-30: "Also on reconnect" | 01 |
| A locale is looked up as given, then as its language alone, then English, one string at a time | (defaulted: ahpw sends `pt` and ahpapp sends `pt-BR`) | 02 |
| A plugin names a folder in `ahpd.i18n`, and the folder holds `<locale>.json` | (defaulted: the shape of an Activepieces piece) | 02 |
| A key's text is looked up in the catalog of the plugin that declared the key, then in the host's catalog | (defaulted: the plugin knows its own words; the host knows its own) | 03 |
| The first catalogs are `pt` and `es`, as ahpw and ahpapp have | (defaulted: the languages the clients speak) | 05 |
| Text the model reads, and a person's own text, stay as they are | [code://packages/sdk/src/host/chatattachment.ts#L15-L22](../../../../packages/sdk/src/host/chatattachment.ts#L15-L22) | - |
| Refusals, command titles, the connectors screen and the Activepieces catalogs come in later plans | Softov, 2026-10-30: "Form and plugins" | - |

## Proposed architecture

- **Data flow** - `handshake.ts` keeps `locale` on the connection and in a map by client id. An sdk module `i18n.ts` holds the catalogs and `translated(path, english, locale, catalogs)`.
- **Event flow** - A client that changes its language reconnects. The next `initialize` or `reconnect` replaces the locale, and the next answer uses it.
- **Layer responsibilities** - sdk: the locale, the lookup, the form and the records channel hook. server: `ahpd.i18n` and the plugins row. Each first-party plugin: its own catalog.
- **Source-of-truth files** - [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts), [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host keeps each client's locale](task-01-the-host-keeps-each-clients-locale.md) | done | - |
| [02 - The host and each plugin carry a catalog](task-02-the-host-and-each-plugin-carry-a-catalog.md) | done | 01 |
| [03 - The new session form comes in the locale](task-03-the-new-session-form-comes-in-the-locale.md) | done | 02 |
| [04 - The plugins screen comes in the locale](task-04-the-plugins-screen-comes-in-the-locale.md) | done | 02 |
| [05 - The first catalogs ship in pt and es](task-05-the-first-catalogs-ship-in-pt-and-es.md) | done | 03, 04 |

## Risks and tradeoffs

- A changed English text keeps its old translation, because the field path is the key. A change to English text updates the catalogs in the same commit.
- A renamed or removed field leaves its catalog entry behind. The lint in task 05 lists each catalog path that matches no field.
- Two connections on one client id with two locales share one locale for the records channels, because a reader is keyed by client id. The later connection wins.
- An answerer's values, such as branch names, are data and must not be translated. The form is translated before the answerers fill it.

## Resume state

- **Done so far:** tasks 01 to 05, recorded in [implemented.md](implemented.md).
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `seeded` adds labels from answerers; translate the properties before `seeded` runs, never after.

## Final verification checklist

- [ ] ahpw in Portuguese, on a test daemon, shows the new session form's host keys in Portuguese.
- [ ] The same form in English shows the English text, and a string with no translation shows in English in Portuguese.
- [ ] The plugins screen shows a first-party plugin's title and description in Portuguese.
- [ ] Softov reads the `pt` catalog and says each translation is right.
