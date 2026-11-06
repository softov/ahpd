---
title: The docs say how a piece is used
status: done
depends:
  - task-04-resend-telegram-and-slack-are-the-first-pieces.md
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md#L500-L540](../../../../docs/plugins/PLUGINS.md#L500-L540) - \"An adapter of your own\""
  - "[code://docs/plugins/webhook.md](../../../../docs/plugins/webhook.md) - the page of a connector plugin, the pattern to copy"
---

## Objective

A docs page says how to name a piece, make a connector of it, and bind it to a session or a bot.

## Files

- `CREATE: docs/plugins/activepieces.md` - the plugin page.
- `UPDATE: docs/plugins/PLUGINS.md` - a link to the page from the adapter section.
- `UPDATE: CHANGELOG.md` - the new plugin.

## Steps

1. Copy the layout of `docs/plugins/webhook.md`.
2. Show the `pieces` option with the three first pieces.
3. Show a Resend connector, and a session config with `connectors: { work: "connectors://ap-resend/<id>" }`.
4. List what is out of scope: OAuth, files, and triggers.
5. Add a changelog line.
6. Set each task and the plan row to `implemented`.

## Validation

- Each example in the page matches the code of tasks 01 to 04.

## Resume

- **Done so far:** `docs/plugins/activepieces.md` follows `docs/plugins/webhook.md`, includes the package README from its second line, and adds the session binding `{ "connectors": { "work": "connectors://ap-resend/mail" } }`.
  `docs/plugins/PLUGINS.md` links the page from the adapter section, and `CHANGELOG.md` has one line for the plugin under 0.14.0.
  Each example matches the code: the `pieces` option is the one `optionsSchema` declares, and the adapter names are the ones `nameOf` builds. `secret_text` and `botToken` are the fields `schemaOf` writes, and the tool names follow the host's `<adapter>_<action>` rule.
  `pnpm -s docs:build` passes.
- **Next action:** none; every task is implemented and waiting for the commit by hand.
- **Files:** `docs/plugins/activepieces.md`, `docs/plugins/PLUGINS.md`, `CHANGELOG.md`, `docs/.vitepress/config.mts`, `.project/plans/plugin/50-a-connector-plugin-runs-activepieces-pieces/plan.md`, `.project/plans/index.md`.
- **Open questions:** none.
- **Departures:** `docs/.vitepress/config.mts` is not in the task's Files, and the docs build refuses a page the sidebar does not list. The sidebar gained the page.
- **Watch out for:** the page includes the README, so a change to the README changes the published page. The page's own section after the include is the only part that is not in the package.
