---
title: Resend, Telegram and Slack are the first pieces
status: done
depends:
  - task-03-an-action-runs-in-the-child.md
layer: "activepieces"
refs:
  - npm://@activepieces/piece-resend@0.6.1 - auth `SECRET_TEXT` "API Key", 58 actions
  - npm://@activepieces/piece-telegram-bot@0.9.1 - auth `SECRET_TEXT` "Bot Token", 41 actions
  - npm://@activepieces/piece-slack@0.23.1 - auth `[OAUTH2, CUSTOM_AUTH "Bot Token"]`, 73 actions
  - https://github.com/activepieces/activepieces - where each piece's license is
---

## Objective

The package ships the three first pieces at exact versions, with their licenses checked.
A daemon with the three named loads three adapters, and one action of each runs by hand.

## Files

- `UPDATE: packages/activepieces/package.json` - the three pieces as dependencies, at the exact versions above.
- `CREATE: packages/activepieces/README.md` - the plugin, its options, and each piece with its license.
- `CREATE: packages/activepieces/test/pieces.test.ts` - the cases below.
- `CREATE: .project/pending/plugin-50-first-pieces.md` - the checks by hand.

## Steps

1. Find each piece's folder in the Activepieces repo, and read the license that covers it.
2. Stop and report when a piece is not under MIT.
3. Add the three pieces to `dependencies` at the exact versions.
4. Write the README, with one row for each piece: package, version, auth and license.
5. Add a test that loads the three pieces and checks each adapter's name, schema and action count.
6. Add a test that `ap_resend_send_email` has the inputs `from`, `to`, `subject` and `content`.
7. Write the pending file with one check by hand for each piece.
8. Run the package tests.

## Validation

- `pieces.test.ts`: `ap-resend`, `ap-telegram-bot` and `ap-slack` load, each with its auth fields.
- `pieces.test.ts`: `ap-slack` has the `CUSTOM_AUTH` fields, and no OAuth field.
- By hand, recorded in the pending file: a Resend send, a Telegram `send_text_message` and a Slack message each arrive.

## Resume

- **Done so far:** `package.json` names the three pieces at their exact versions. The package installs no framework.
  `README.md` describes the plugin and its `pieces` option, and has one row for each piece with its package, version, auth and license.
  `pieces.test.ts` loads the three packages through `apply` and checks the three adapter names, the auth fields of each, Slack's 72 actions and Resend's `send_email` input.
  The one note the plugin reports is Slack's `uploadFile`, the only action of the three that needs a required file.
  All four cases pass, and `pnpm -s typecheck`, `pnpm -s build` and `pnpm -s boundary` pass.
- **Next action:** task 05, which documents the plugin and sets the plan to implemented.
- **Files:** `packages/activepieces/package.json`, `packages/activepieces/README.md`, `packages/activepieces/test/pieces.test.ts`, `.project/pending/plugin-50-first-pieces.md`.
- **Open questions:** none.
  The license was read on 2026-10-23 at the repository root `LICENSE`: everything outside `packages/ee/` and `packages/server/api/src/app/ee` is MIT.
  The three pieces are in `packages/pieces/community/`, and the framework is in `packages/pieces/framework/`, so all four are MIT.
- **Departures:** the plan's refs give Slack 73 actions, and its adapter has 72. `uploadFile` needs a required file, and step 12 of task 02 leaves it out.
- **Watch out for:** the pieces are CommonJS bundles with no dependency of their own, so the child requires each package from `node_modules`. A piece named but not installed answers an error in the log rather than a silent gap.
