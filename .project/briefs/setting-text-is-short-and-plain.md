---
title: Setting text is short and plain
created: 2026-11-04
refs:
  - git://64fc885c - the commit of ahpd the facts were checked at
  - "[code://packages/agent-claude/package.json](../../packages/agent-claude/package.json) - `ahpd.description` and `ahpd.optionsSchema`, where a plugin's English text lives"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L77-L196](../../packages/sdk/src/host/sessionconfig.ts#L77-L196) - the host's session keys, whose English is in code"
  - "[code://packages/sdk/src/i18n/pt.json](../../packages/sdk/src/i18n/pt.json) - a catalog, keyed by field path"
  - "[code://tools/i18n-check.mjs](../../tools/i18n-check.mjs) - checks that every catalog path still names a field"
  - "[code://packages/agent-cofold/README.md#L56-L66](../../packages/agent-cofold/README.md#L56-L66) - a README's option table, which already holds the detail for developers"
  - https://code.visualstudio.com/api/ux-guidelines/settings - VS Code's settings guidelines: clear descriptions, link to documentation for a complicated setting, no long descriptions
---

# Setting text is short and plain

ahpw and VS Code show a plugin's text and its settings in the new session form and on the plugins screen. On 2026-11-04 he found sentences that are too long, or written for a developer, in the Portuguese catalogs. Their English sources have the same problem. The goal is one short, plain sentence for a person, in English, Portuguese and Spanish, with the detail for developers in the READMEs.

## What others do

- VS Code's settings guidelines ask for a clear description on each setting, and a link to the documentation for a complicated one. They list "Create long descriptions" as a don't, with no word limit ([settings guidelines](https://code.visualstudio.com/api/ux-guidelines/settings)).

## What ahpd has today

- A plugin's English text is in its `package.json`, under `ahpd`: `title`, `description`, and a `description` for each option in `optionsSchema` ([`code://packages/agent-claude/package.json`](../../packages/agent-claude/package.json)). ahpd has no `en.json`.
- The 11 packages with an `ahpd` field hold 73 such descriptions. 16 have more than 20 words, and the longest has 45.
- Some describe the code, not the choice. An example is `agent-claude` `options.computerCliFallback`: "With computerCli part, what a machine gets when the claude part cannot be built: ...".
- The session keys' English is in code: the host's in [`code://packages/sdk/src/host/sessionconfig.ts`](../../packages/sdk/src/host/sessionconfig.ts#L77-L196), and each agent's in its own schema. The 35 session descriptions in those five files are 20 words or fewer.
- The `pt` and `es` catalogs translate the English, keyed by field path ([`code://packages/sdk/src/i18n/pt.json`](../../packages/sdk/src/i18n/pt.json)). The 12 `pt.json` files hold 167 strings.
- [`code://tools/i18n-check.mjs`](../../tools/i18n-check.mjs) checks that each catalog path still names a field. It does not check the length of the text.
- A README's option table already says more than the schema. For `computerConfigDir`, the cofold README names the state volume and the read-only mount, and `package.json` has one sentence ([`code://packages/agent-cofold/README.md`](../../packages/agent-cofold/README.md#L56-L66)).
- Text the model reads, such as a tool's input schema, stays as it is, per the *Answers* of plan host/20261030-1037.

## Who writes

- No pull request is open on `softov/ahpd`.
- The open plans claude/20261104-1150 and host/20261104-1150 change no `package.json` description and no catalog.
- Every plugin's `package.json` and catalog is in this repository. A later change to an option adds or changes its English and its two catalogs.

## The change

- Each plugin `description` and each option and session `description` is one short sentence, written for the person who picks the value.
- A value's name, its default and how the code uses it go in the README's option table, not in the description.
- The `pt` and `es` catalogs are rewritten to match the new English.
- A check fails when a description has more than a set number of words, so a long sentence does not come back.

## Open points

- The word limit for the check, and whether it covers titles and enum labels too.
- Whether the rewrite also covers text outside this slice, such as refusals and command titles, which plan host/20261030-1037 left for later.
