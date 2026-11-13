---
title: An operation reads plain, in the client's language - implemented
date: 2026-11-13
refs:
  - "[code://packages/sdk/src/kinds/operations.ts](../../../../packages/sdk/src/kinds/operations.ts) - `operationsIn`, `hostOperationText` and `withOperations`"
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts) - the agent text, and the list in the snapshot"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the connector text, and the list in the snapshot"
  - "[code://packages/sdk/src/tunnels/channel.ts](../../../../packages/sdk/src/tunnels/channel.ts) - plain verbs, the remove question, and an operations update for each subscriber"
  - "[code://packages/sdk/src/clients/channel.ts](../../../../packages/sdk/src/clients/channel.ts) - the drop text, in the reader's locale"
  - "[code://packages/sdk/src/plugins/plugins.ts](../../../../packages/sdk/src/plugins/plugins.ts) - a tunnel kind keeps its plugin's catalogs"
  - "[code://packages/tunnel-devtunnel/src/kind.ts](../../../../packages/tunnel-devtunnel/src/kind.ts) - the Dev Tunnel's text"
  - "[code://tools/i18n-check.mjs](../../../../tools/i18n-check.mjs) - the `operations` block"
---

Every operation on an agent, connector, tunnel or client row reads as plain text, in the locale the client sent. A client that sent none gets English.

## What was built

- [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts) - `operationsIn` puts each label, description and confirmation in a locale. `hostOperationText` reads `operations.<row>.<name>` in the host's catalogs. `withOperations` puts a records channel's operations in its snapshot.
- The agent and connector lists put their operations in their snapshot, as the tunnel and client lists do.
- ahpw draws the host's words when the list is there.
- The tunnel list labels update and remove "Edit" and "Remove", gives every host operation a description, and asks "Remove this tunnel? Its address stops reaching this host." `x-ahpd-tunnels/operations` goes to each subscriber with `to`, in its locale.
- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - the fold puts the plugin's catalogs on each tunnel kind it registers.
- The host's `pt` and `es` catalogs have an `operations` block. The Dev Tunnel plugin's have one for its four operations and its create.
- [`code://tools/i18n-check.mjs`](../../../../tools/i18n-check.mjs) - an `operations` path names a row and an operation the sources quote, or `create`, and its leaves are `label`, `description` and `confirmation`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the `operations` catalog block, and the list in the reader's locale.

## Verified

- `pnpm typecheck` is clean.
- `TMPDIR=/tmp npx vitest run packages/sdk/test`: 239 files, 4791 tests passed.
- `TMPDIR=/tmp npx vitest run packages/server/test`: 95 files, 1879 tests passed.
- `TMPDIR=/tmp npx vitest run packages/tunnel-devtunnel/test`: 5 files, 77 tests passed.
- `node tools/i18n-check.mjs` prints nothing.
- A test daemon on port 39200 ran this branch with the Dev Tunnel plugin. A client that sent `pt-BR` read the four lists in Portuguese, with the table's text. A client that sent no locale read them in English.

## Departures from the plan

- `tools/i18n-check.mjs` was not in the plan. It refused the new block, so it learned it, with a case.
- The connection helpers of the agent and connector tests take a locale. One client id keeps one locale, so each case reads the Portuguese list before it opens the English client.

## Left for later

- The `input` of an operation, such as the Dev Tunnel's "Anonymous access" checkbox, is not translated.
- The titles and descriptions of the `x-ahpd/agents/*` and `x-ahpd/connectors/*` methods keep their text, as the plan's answers say.
