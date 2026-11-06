---
title: A connector plugin runs Activepieces pieces as tools
domain: plugin
status: built
priority: medium
created: 2026-10-13
revalidated: 2026-10-23
requires:
  - plans/host/118-a-connector-action-runs-as-a-tool/plan.md
  - plans/plugin/53-a-client-sees-plugins-and-connectors/plan.md
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L101-L120](../../../../packages/sdk/src/types/connectors.ts#L101-L120) - `Adapter`, which host/118 gives `run`"
  - "[code://packages/sdk/src/types/plugin.ts#L1051-L1059](../../../../packages/sdk/src/types/plugin.ts#L1051-L1059) - `registerAdapter`, one adapter for each piece"
  - "[code://packages/sdk/src/types/plugin.ts#L1154](../../../../packages/sdk/src/types/plugin.ts#L1154) - `apply` may answer a promise, so the plugin can wait for the child"
  - "[code://packages/sdk/src/plugins/validate.ts#L272-L277](../../../../packages/sdk/src/plugins/validate.ts#L272-L277) - a contract entry that ends in `*` names a prefix, so `ap-*` covers every piece"
  - "[code://packages/sdk/src/plugins/validate.ts#L535-L565](../../../../packages/sdk/src/plugins/validate.ts#L535-L565) - `checkAdapter`, what each adapter must pass"
  - "[code://packages/sdk/src/connectors/channel.ts#L312-L323](../../../../packages/sdk/src/connectors/channel.ts#L312-L323) - `resolved`, so `run` gets the secret values"
  - "[code://packages/webhook/src/plugin.ts#L38-L39](../../../../packages/webhook/src/plugin.ts#L38-L39) - `optionsSchema`, the pattern for the plugin options"
  - "[code://packages/webhook/package.json#L61-L73](../../../../packages/webhook/package.json#L61-L73) - the `ahpd` manifest with its `contracts`, the pattern for the new package"
  - "[code://docs/plugins/PLUGINS.md#L500-L540](../../../../docs/plugins/PLUGINS.md#L500-L540) - \"An adapter of your own\""
  - "[code://.project/ideas/connectors-come-from-activepieces-pieces.md](../../../ideas/connectors-come-from-activepieces-pieces.md) - the probe of 2026-10-06 and the shape of a piece"
  - npm://@activepieces/pieces-framework@0.32.0 - the context type an action's `run(context)` reads
  - npm://@activepieces/piece-resend@0.6.1 - auth `SECRET_TEXT` "API Key", 58 actions, no dependencies
  - npm://@activepieces/piece-telegram-bot@0.9.1 - auth `SECRET_TEXT` "Bot Token", 41 actions, no dependencies
  - npm://@activepieces/piece-slack@0.23.1 - auth `[OAUTH2 "Connection", CUSTOM_AUTH "Bot Token"]`, 73 actions, no dependencies
  - https://github.com/activepieces/activepieces - the source of each piece, where its license is
---

## Goal

A new package, `packages/activepieces`, loads Activepieces pieces and offers each one as an adapter.
A person makes a connector of a piece with the piece's key, and one connector is one account.
Each action of the piece is an `action` capability.
host/118 runs it as a tool for a session or a bot that binds the connector.
The pieces run in a child process, with no Activepieces server and no Docker.
The first pieces are Resend, Telegram and Slack, each with a secret-text or custom auth.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The [connectors idea](../../../ideas/connectors-come-from-activepieces-pieces.md) has the probe of 2026-10-06.
A probe on 2026-10-23 loaded the three first pieces in plain Node and read their `auth` and `_actions`.

### Searches performed

- `rg "NODE_TLS_REJECT_UNAUTHORIZED" piece-resend/src/index.js` - the bundled http client sets it to `"0"` on each request.
- `rg "auth\.secret_text|props\.botToken" piece-*/src/index.js` - a secret-text action reads `auth.secret_text`, and Slack reads `auth.props.botToken`.
- `node probe.cjs piece-*` - the prop types of the three pieces are `SHORT_TEXT`, `LONG_TEXT`, `NUMBER`, `CHECKBOX`, `ARRAY`, `OBJECT`, `JSON`, `STATIC_DROPDOWN`, `DROPDOWN`, `DYNAMIC`, `DATE_TIME`, `MARKDOWN` and `FILE`.
- `jq .license piece-*/package.json` - no piece's `package.json` has a license field.
- `node pin.cjs` - with the `process.env` proxy, a write of `"0"` has no effect, and `https.get` refuses a self-signed host.

### Runtime path

```
apply -> spawn child -> child requires each piece -> describe -> registerAdapter(ap-<piece>)
tool call (host/118) -> adapter.run(connector, action, input) -> child -> action.run(context) -> answer
```

### Gaps

- No package loads a piece.
- A piece turns off TLS checks for its whole process, so it cannot run in the daemon.
- No code turns a piece's `auth` into an adapter schema, or its props into a tool input.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A piece is an adapter, and a connector is one account | Softov, 2026-10-23, chose the plan's model | 02 |
| A connector's action runs as a tool through host/118 | Softov, 2026-10-23, "Final choice: Option 1, with binding aliases and server-side connector resolution." | 03 |
| A connector binds to a bot, or to a session config key | Softov, 2026-10-13, "A bot, or a session key" | - |
| The first pieces are Slack, Resend and Telegram | Softov, 2026-10-23, "I would make slack, resend and telegram. so we can test better common things without need to redoing to much latter. also telegram with a later fit for receiving messages is a good approach" | 04 |
| Telegram receive is a later plan | Softov, 2026-10-23, "telegram with a later fit for receiving messages" | - |
| A piece is installed by naming its package in the plugin's `pieces` option | (defaulted: no new command) | 01 |
| The package depends on the three first pieces, each at an exact version | Softov, 2026-10-23, chose "All four, exact versions" for "Is that OK?" on the four dependencies | 01, 04 |
| The package also depends on GitHub, Linear, Jira Cloud, Discord, WhatsApp Business, Notion, Airtable, SMTP, SendGrid, Stripe and HubSpot, each at an exact version | Softov, 2026-10-23, chose all four groups for "Which pieces should the plugin add?" | 04 |
| The package installs no framework, and writes its own `Store` type | Softov, 2026-10-23, chose "Own Store type": the framework pulls about 30 packages, `expr-eval` with a critical advisory among them, and each piece bundles its own copy | 01, 03 |
| The child builds the context of `@activepieces/pieces-framework` `0.32.0` | Softov's directive, 2026-10-23: the context shape the child builds | 01 |
| The pieces run in one child process, and a piece cannot set `NODE_TLS_REJECT_UNAUTHORIZED` there | The idea: a piece turns off TLS checks for its process | 01 |
| The child pins it with a `process.env` proxy that ignores a write or a delete of that key | (defaulted: the probe of 2026-10-23 set it to `"0"` under the proxy, and a self-signed host still failed) | 01 |
| The child exits when the daemon exits, and a crash restarts it on the next call | (defaulted: no plugin stop hook exists) | 03 |
| Each piece's adapter name is `ap-<name>`, from `@activepieces/piece-<name>` | (defaulted: `ap-resend`, `ap-telegram-bot`, `ap-slack`) | 02 |
| The manifest declares `contracts.adapters: ["ap-*"]` | Softov's directive, 2026-10-23, for plan 53's contract check | 01 |
| `SECRET_TEXT` auth is one `writeOnly` string field, `secret_text` | (defaulted: the key the piece reads) | 02 |
| `CUSTOM_AUTH` auth is its props, with each `SECRET_TEXT` prop `writeOnly` | Softov's directive, 2026-10-23 | 02 |
| An array auth uses its first entry that is not `OAUTH2` | Softov's directive, 2026-10-23: Slack uses its `CUSTOM_AUTH` "Bot Token" | 02 |
| A piece with no `SECRET_TEXT` or `CUSTOM_AUTH` entry is reported and skipped | (defaulted: OAuth2 and basic auth are out of scope) | 02 |
| The host keeps the secrets through `writeOnly`, so the plugin writes no secret | plan/53: the host writes a `writeOnly` field to the vault | 02 |
| Each `_actions` entry is an `action` capability, with its `input` from the props | Softov's directive, 2026-10-23 | 02 |
| The description is `aiMetadata.description` when the action has one, and the action's `description` if not | Softov's directive, 2026-10-23 | 02 |
| Text props are strings, `NUMBER` a number, `CHECKBOX` a boolean, `ARRAY` an array, and `OBJECT`, `JSON` and `DYNAMIC` objects | (defaulted: the JSON type of the value the action reads) | 02 |
| `STATIC_DROPDOWN` is a string with an `enum`, and `DROPDOWN` a string whose description says to give the id | (defaulted: a dynamic dropdown needs a call to list its options) | 02 |
| `DATE_TIME` is a string with `format: date-time` | (defaulted) | 02 |
| A `MARKDOWN` prop is left out of the input | (defaulted: it is text a builder UI shows, not a value) | 02 |
| An action with a required `FILE` prop is left out, and an optional `FILE` prop is dropped | (defaulted: files wait for a later plan) | 02 |
| The context has `auth`, `propsValue`, an in-memory `store` for each connector, and stubs for the rest | (defaulted: the probe needed only `auth` and `propsValue`) | 03 |
| A call that takes longer than 60 seconds fails, and the child stays up | (defaulted) | 03 |
| Each first piece's license is checked in the Activepieces repo, and the README names it | Softov's directive, 2026-10-23: `package.json` has no license field | 04 |

## Proposed architecture

- **Data flow** - The plugin options list the piece packages. The child loads each one and answers its `auth` and actions as plain JSON. The plugin turns that into one adapter for each piece.
- **Event flow** - host/118 calls `adapter.run(connector, action, input)`. The plugin sends `{ piece, action, auth, input }` to the child, and the child answers the result or the error.
- **State flow** - The child keeps one `store` for each connector id in memory. A restart of the child empties it.
- **Layer responsibilities** - activepieces: the child, the mapping, the adapters · docs: a page for the plugin.
- **Source-of-truth files** - `packages/activepieces/src/plugin.ts` (new), `packages/activepieces/src/child.ts` (new), `packages/activepieces/src/mapping.ts` (new)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The plugin loads pieces in a child](task-01-the-plugin-loads-pieces-in-a-child.md) | done | - |
| [02 - A piece is an adapter](task-02-a-piece-is-an-adapter.md) | done | 01 |
| [03 - An action runs in the child](task-03-an-action-runs-in-the-child.md) | done | 02 |
| [04 - Resend, Telegram and Slack are the first pieces](task-04-resend-telegram-and-slack-are-the-first-pieces.md) | done | 03 |
| [05 - The docs say how a piece is used](task-05-the-docs-say-how-a-piece-is-used.md) | done | 04 |

## Risks and tradeoffs

- A piece is npm code that runs on this host - The person names each package, and a call gets only its own connector's auth.
- A piece's license can differ from the repo's - Task 04 checks each first piece, and the README names it.
- The framework changes its context shape - The child builds the context of framework `0.32.0`, and each piece is pinned at a version built against it.
- A big piece gives many tools - Slack gives 73, and host/118 offers them only to a session with a Slack binding.

## Resume state

- **Done so far:** the plan, 2026-10-13. Rewritten on 2026-10-23 for the adapter model of plan 53 and host/118. Tasks 01 to 05 implemented 2026-10-23: the package, its child, the mapping, `run`, the three first pieces and the docs page. `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary`, `pnpm -s docs:build` and `packages/activepieces`'s 21 cases pass.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** the run request carries `connector` beside the fields of task 03's step 3, because the child keeps one store for each connector. `nameOf` also names an adapter from a piece named by a file URL, which is how a test names a fixture.
- **Watch out for:** a piece bundles its own copy of the framework, so find it by its `_actions` member, not by `instanceof`.

## Final verification checklist

- [x] With `pieces` set to the three first pieces, the adapters `ap-resend`, `ap-telegram-bot` and `ap-slack` are listed, as `pieces.test.ts` checks.
- [ ] A Resend connector bound as `work` gives a session `ap_resend_send_email`, and a call reaches the child. The call through the adapter is in `run.test.ts`; the binding waits for the checks by hand.
- [x] The daemon process never has `NODE_TLS_REJECT_UNAUTHORIZED` set to `"0"`, as `child.test.ts` checks of the process the pieces load in.
- [x] `pnpm vitest run packages/activepieces` passes, with 21 cases.
- [x] `pnpm -s typecheck`, `pnpm -s boundary`, `pnpm -s schema` and `pnpm -s docs:build` pass.
- [x] `plans/index.md` updated.
