---
title: First-party schemas say secret
status: done
depends: [task-01-the-host-reads-secret.md]
layer: "plugins, server, docs"
refs:
  - "[code://packages/server/src/proxy/adapters.ts](../../../../packages/server/src/proxy/adapters.ts) - `KEY`"
  - "[code://packages/webhook/src/adapter.ts](../../../../packages/webhook/src/adapter.ts) - `secret` and `verifyToken`"
  - "[code://packages/activepieces/src/mapping.ts](../../../../packages/activepieces/src/mapping.ts) - a piece's auth fields"
---

## Objective

Every first-party field that the vault keeps says `secret: true` and not `writeOnly: true`.
A plugin option that the vault never keeps stays `writeOnly`.
The docs say which keyword means what.

## Files

- `UPDATE: packages/server/src/proxy/adapters.ts:5-12` - the comment names `secret`.
- `UPDATE: packages/server/src/proxy/adapters.ts:80-88` - `KEY` says `secret: true`.
- `UPDATE: packages/webhook/src/adapter.ts:14-170` - `secret` and `verifyToken` say `secret: true`, and the comments follow.
- `UPDATE: packages/activepieces/src/mapping.ts:10-175` - the auth fields say `secret: true`, and the comments follow.
- `UPDATE: packages/agent-pi/src/plugin.ts:92-109` - the key variables say `secret: true`.
- `UPDATE: packages/agent-acp/src/plugin.ts:39-56` - the engine's vault fields say `secret: true`.
- `UPDATE: packages/agent-claude/src/options.ts:271-283` - the `key` of `MODEL_SOURCE` says `secret: true`.
- `UPDATE: packages/agent-claude/src/adapter.ts:80-92` - the `token` field of the `claude-login` adapter says `secret: true`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:96` - the comment names `secret`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:138-149` - the record's `apiKey` says `secret: true` over the plugin option, which stays `writeOnly`.
- `UPDATE: docs/plugins/PLUGINS.md` - `secret` for a vault field, `writeOnly` for a value never read back, and the problem line; keep the `x-ahpd-connector` bullet.
- `UPDATE: docs/plugins/WEBHOOKS.md` - the two fields say `secret`.
- `UPDATE: docs/sdk/HOST.md:154` - the keyword a client reads to show a field as set.
- `UPDATE: packages/activepieces/test/mapping.test.ts` - the auth fields say `secret`.
- `UPDATE: packages/webhook/test/webhook-kind.test.ts` - the two fields say `secret`.
- `UPDATE: packages/server/test/proxy-adapters.test.ts` - `KEY` says `secret`.
- `UPDATE: packages/agent-claude/test/agent-claude-login-adapter.test.ts:61` - the `token` field says `secret`.
- `UPDATE: packages/agent-claude/test/agent-claude-options-schema.test.ts` - the vault fields say `secret`.
- `UPDATE: packages/agent-acp/test/agent-acp-presets.test.ts` - the engine's vault fields say `secret`.
- `UPDATE: packages/agent-pi/test/engine.test.ts` - the key variables say `secret`.
- `UPDATE: packages/agent-cofold/test/engine.test.ts` - the record's `apiKey` says `secret`.
- `UPDATE: packages/activepieces/test/pieces.test.ts` - the auth fields say `secret`.
- `UPDATE: packages/server/test/openrouter-signin.test.ts` - the sign-in key says `secret`.
- `UPDATE: packages/server/test/schema-gaps.test.ts` - no first-party plugin gives a `writeOnly kept in the vault` line.
- `UPDATE: packages/server/test/fixtures/plugin-throws-secret/package.json` - the quoted option carries a `secret` field.
- `UPDATE: packages/server/test/fixtures/plugin-throws-secret/index.ts` - the fixture reads the `secret` field.

## Steps

1. For each `writeOnly` in `packages/*/src`, find whether the schema reaches `checkAgent`, `checkAdapter` or `checkEngine`.
2. Change it to `secret: true` when it does.
3. Keep `writeOnly` in a plugin's `package.json` options, in `commands/options.ts` and in the root configuration.
4. Change the comments beside each changed field.
5. Change the docs, and keep one sentence on the `writeOnly` fallback and its problem line.
6. Change the tests and the fixtures that assert `writeOnly` on a vault field.
7. Load the first-party plugins in a test daemon, and check that no `writeOnly` gap line appears.

## Validation

- `rg -n "writeOnly" packages/*/src` names only plugin options, `commands/options.ts`, `isSecret` and the masks.
- The tests in the files above pass with `secret`.
- A test daemon with every first-party plugin loads with no `writeOnly` gap line.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

