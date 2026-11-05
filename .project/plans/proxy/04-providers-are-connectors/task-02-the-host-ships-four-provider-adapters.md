---
title: The host ships four provider adapters
status: done
depends: [task-01-an-adapter-can-serve-models.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/providers.ts#L97-L116](../../../../packages/server/src/proxy/providers.ts#L97-L116) - today's endpoints, dialects and key variables"
  - "[code://packages/server/src/commands/run.ts#L725-L758](../../../../packages/server/src/commands/run.ts#L725-L758) - the adapters map the channel reads"
  - "[code://packages/server/src/commands/run.ts#L1224](../../../../packages/server/src/commands/run.ts#L1224) - where a reload sets the adapters map"
  - "[code://packages/server/src/commands/run.ts#L1244](../../../../packages/server/src/commands/run.ts#L1244) - where the first load sets the adapters map"
  - "[code://packages/server/src/icons.ts](../../../../packages/server/src/icons.ts) - `resolveIcons`, which reads an icon file into a `data:` URI"
  - "[code://packages/webhook/src/adapter.ts](../../../../packages/webhook/src/adapter.ts) - an adapter with a schema and a secret field, the pattern to follow"
  - https://simpleicons.org/ - the OpenRouter, Anthropic and OpenAI marks, with their colours
  - https://unpkg.com/@lobehub/icons-static-svg@1.98.0/icons/openai.svg - the OpenAI mark, which Simple Icons no longer has
---

## Objective

The host registers the `openrouter`, `anthropic`, `openai` and `openai-compatible` adapters itself.
Each one has a form, a check that proves its key, and an icon.
A plugin's adapter of the same name does not replace one of these.

## Files

- `CREATE: packages/server/src/proxy/adapters.ts` - the four adapters, their schemas, their `provider` and their checks.
- `CREATE: packages/server/icons/openrouter.svg` - the OpenRouter mark.
- `CREATE: packages/server/icons/anthropic.svg` - the Anthropic mark.
- `CREATE: packages/server/icons/openai.svg` - the OpenAI mark.
- `CREATE: packages/server/icons/openai-compatible.svg` - the OpenAI mark, in yellow.
- `UPDATE: packages/server/package.json` - add `icons` to `files`.
- `UPDATE: packages/server/src/commands/run.ts:725-758` - put the host's adapters into the adapters map on each load, over the plugins' adapters.
- `CREATE: packages/server/test/proxy-adapters.test.ts` - each adapter's schema, `provider`, check and icon.

## Steps

1. Write each adapter with `name`, `title`, `description`, `schema`, a `models` capability, `provider`, `check` and `icons`.
2. Give `openrouter`, `anthropic` and `openai` a required `key`, marked `writeOnly`, and an `endpoint` with today's built-in default.
3. Give `openai-compatible` a required `endpoint`, an optional `key` marked `writeOnly`, and `accepts` with the default `["openai-chat"]`.
4. Answer `provider` from the connector's config: the endpoint, the dialects and the key.
5. Write each check as one `GET` with the key: `/key` for OpenRouter, `/models` for OpenAI and OpenAI-compatible, `/v1/models` for Anthropic.
6. Map 2xx to `ok`, 401 and 403 to `denied`, and a failed connection to `unreachable`.
7. Map any other answer to `failed`, with its status.
8. Give each check an abort after 8 seconds, so it ends before the channel's 10-second limit.
9. Read each icon with `resolveIcons` against the server package, once at start.
10. Keep each SVG at most 32 KB, with its colour in the file.
11. Use no `<script>` element and no event attribute in an SVG.
12. Merge the host's adapters into the map at L1224 and L1244, after the plugins' adapters.
13. Make sure that a plugin cannot replace a host adapter.
14. Report a plugin adapter with one of these names through the daemon log, once.
15. Add tests for each rule above, with a fake `fetch`.
16. Write the pending file with each icon's source URL and licence.
17. Stop and ask Softov to curate each icon.

## Validation

- The new tests pass, and the gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- `npm pack --dry-run` in `packages/server` lists the four icons.
- By hand: Softov approves each icon in the pending file.
- By hand: the connectors screen offers the four adapters with their icons after a restart.

## Resume

- **Done so far:** `packages/server/src/proxy/adapters.ts` answers the four adapters. Each has a schema, a `models` capability, an `open` that starts nothing, a `provider` and a check. The vendor adapters require a `writeOnly` key and default the endpoint; `openai-compatible` requires the endpoint and takes an optional key and `accepts`. Each check is one `GET` with an 8-second abort. `packages/server/icons/` holds the four SVGs, and `package.json` lists `icons` in `files`. `run.ts` puts the host's adapters over the plugins' on both loads. It says once in the log when a plugin registers one of the names. `proxy-adapters.test.ts` covers the forms, `provider`, the checks and the icons, 13 cases.
- **Next action:** none for this task.
- **Open questions:** none. Softov curated the four icons in `4ec2f101`.
- **Watch out for:** a plugin adapter with one of the four names is dropped, so a connector of it is checked against the host's schema.
