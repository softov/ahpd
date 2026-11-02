---
title: The text a person reads is plain
created: 2026-10-31
refs:
  - git://f7621ea8 - the commit of ahpd the facts were checked at
  - file:///github/ahpd/.project/plans/host/20261030-1037-host-text-in-the-clients-language/plan.md - the i18n plan; its first slice is the new session form and the plugins screen, and refusals, command text and the connectors screen come later
  - "[code://packages/server/src/pluginschannel.ts#L747-L748](../../packages/server/src/pluginschannel.ts#L747-L748) - the title and description of \"Import a plugin again\", which ahpw shows as the tooltip of the Import again button"
  - "[code://packages/server/src/pluginschannel.ts#L344](../../packages/server/src/pluginschannel.ts#L344) - the description of the plugins channel"
  - "[code://packages/sdk/src/i18n.ts#L1-L22](../../packages/sdk/src/i18n.ts#L1-L22) - a catalog is keyed by field path, and English is the text in the code"
  - "[code://packages/sdk/src/i18n/pt.json](../../packages/sdk/src/i18n/pt.json) - the host's Portuguese catalog"
  - "[code://packages/sdk/src/host/chatattachment.ts#L15-L22](../../packages/sdk/src/host/chatattachment.ts#L15-L22) - text the model reads stays English"
  - "[code://packages/agent-acp/package.json#L75](../../packages/agent-acp/package.json#L75) - a plugin's description in its manifest"
  - git://790e3ec1 - the commit of ahpd the facts in *Plugin text* were checked at
  - "[code://packages/server/src/pluginschannel.ts#L321-L338](../../packages/server/src/pluginschannel.ts#L321-L338) - `translate`, which puts a plugin's title, description and options form in the reader's locale"
  - "[code://packages/agent-acp/package.json#L90](../../packages/agent-acp/package.json#L90) - the options field `toolsChanged`, whose description tells a person how the code works"
  - "[code://packages/agent-acp/i18n/pt.json](../../packages/agent-acp/i18n/pt.json) - a plugin's Portuguese catalog, with the keys `meta`, `options` and `session`"
  - "[code://.project/plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md](../plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md) - the A2UI plan; a plugin's view text is translated at `views.<surface>.<componentId>.<prop>`"
  - https://github.com/softov/ahpw/pull/30 - ahpw's own text rewritten with the same rules, and the same terms in pt-BR and es-419
---

# The text a person reads is plain

Before or during the translation work, Softov wants a review of each text that a person reads in ahpd.
Make each text friendly, natural, clear and easy to understand, and keep it technically accurate.
Do not move the current text into catalogs as it is.
For each message, decide if it can be clearer, shorter, more natural or more useful, and then rewrite it.

An example is the tooltip of the Import again button on a plugin's page in ahpw:

> Takes `id`, the plugin whose code changed, and loads it from its module as it is now. Its closers run first, so what it opened is closed before the new code applies. A plugin with a port or a URI scheme answers `restart: true`.

The tooltip is the description of the command `Import a plugin again`.
It tells a developer how the command works.
It does not tell a person what the button does for them.

## Writing rules

- Write for the person who uses the application, not for a developer who reads the code.
- Use everyday words. Do not use implementation details or internal terms.
- Keep buttons, labels, descriptions and tooltips short. Remove explanations that a person does not need.
- Say what an action does and what the person can expect. Do not say how the code does it.
- Use the same terms, the same capitalization and the same tone everywhere.
- Be professional and approachable: not robotic, not too formal and not too casual.
- Fit the text to its place.
  - A button names an action.
  - A description tells what a thing can do.
  - A tooltip tells how a thing behaves.
- Make a text simpler, but keep its meaning and keep each important consequence.
- When a text is not clear, read the code and the behavior around it before you rewrite it.

## Translation rules

- Make the English text better first. The English text is then the source for each translation.
- Translate the meaning, not word by word.
- Use the same terms in each language.
- Keep placeholders, dynamic values, technical identifiers and protocol names as they are.
- Do not make a sentence from translated parts.

## Scope

- Each text that a person can see:
  - navigation, buttons, settings and tooltips;
  - descriptions, dialogs and confirmations;
  - errors, warnings, empty states and notifications.
- Do not change identifiers, API contracts, protocol fields or behavior only to make the wording better.
- Text that the model reads stays as it is, as the i18n plan says.

## What ahpd has now

- A catalog is a JSON file keyed by field path, such as `session.isolation.title`.
- English is not in a catalog. English is the text in the code, and a lookup uses it when a catalog has no entry.
- The field path is the key, so a changed English text keeps its old translation. A change to English text must update `pt` and `es` in the same commit.
- The host's catalogs cover the new session form and the plugins screen. Command titles, command descriptions and refusals are English in the code.
- A plugin's description comes from its manifest, for example `Connects any ACP-compatible agent, including Copilot, Codex, Gemini, and custom ACP servers.`
- The plugins channel describes itself as "What the configuration names, and what a run would load."

## Plugin text

Softov chose on 2026-10-31 that the plugins' text gets the same review, as the slice after the server.
ahpw draws a plugin's text as the host sends it, so ahpw cannot fix it.

### What the plugins have

- Eleven first-party plugins have an `ahpd` manifest in `package.json`, and each ships `i18n/pt.json` and `i18n/es.json`.
- The English is in the manifest: `ahpd.title`, `ahpd.description` and each `description` in `ahpd.optionsSchema`.
- A plugin's catalog keeps the translations at `meta.title`, `meta.description`, `options.<field>` and `session.<field>`.
- `translate` reads the plugin's own catalogs first, then `HOST_CATALOGS`.
- The plugins' options forms have 60 fields at the top level. `computer` has 22, `agent-cofold` 11 and `agent-claude` 7.
- Eight `describe()` texts are in plugins: four in `computer`, and one each in `agent-claude`, `bot`, `push` and `tasks`.
- The `session.<field>` keys translate the fields a plugin adds to the new session form.
- Some options text tells a person how the code works. An example is `toolsChanged` in `agent-acp`, which names `notifications/tools/list_changed`.

### The A2UI view

- The A2UI plan lets a plugin send a view that ahpw draws on the plugin's page.
- Its Text and Link texts are English in the plugin, and translated at `views.<surface>.<componentId>.<prop>`.
- The Dev Tunnel view is the first one. Its English follows the writing rules of this brief from the start.

### Who writes

- No open branch or PR changes a plugin's manifest or catalog at `790e3ec1`.
- The A2UI plan's tasks 02 and 03 add `views` keys to the `tunnel-devtunnel` catalogs.
- Plan host/20261031-1200 changes the sdk's text only. Its terms list is the one the plugins use.

### The change

- Each plugin's title, description and options descriptions are rewritten in plain English.
- The `pt` and `es` catalogs of each plugin are translated again from the new English, in the same commit.
- A description says what a field does for a person. A protocol name stays only where a person sets it, such as an `enum` value.
- The plugins use the terms of `docs/sdk/TEXT.md`, which plan host/20261031-1200 writes.

## Questions for a plan

- Is the CLI output of `ahpd` in scope, or only the text that a client shows?
- Is the review one pass before the next i18n slice, or a part of each slice?
- Where do the shared terms go, so that each language uses the same word for one thing?
- Who reads the result: Softov for each string, or Softov for a sample and the term list?
