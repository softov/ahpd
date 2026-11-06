---
title: The model API has its own gate
domain: proxy
status: built
priority: high
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://0a4d89c7 - the commit of ahpd the facts were checked at
  - git://ccce9b12 - renamed `http` to `httpApi` and `proxy` to `modelProxy`; since then `httpApi` alone serves the model calls
  - "[code://packages/server/src/commands/run.ts#L631-L676](../../../../packages/server/src/commands/run.ts#L631-L676) - the proxy is chained behind `/mcp` and in front of `/api`, and served only while `httpApi` is on"
  - "[code://packages/server/src/commands/run.ts#L700-L721](../../../../packages/server/src/commands/run.ts#L700-L721) - the chain on the daemon's port, and the API's own listener for `httpApi.port`"
  - "[code://packages/server/src/commands/run.ts#L421-L445](../../../../packages/server/src/commands/run.ts#L421-L445) - `httpApi` needs a listening port and a credential: the checks to copy"
  - "[code://packages/server/src/commands/run.ts#L2092-L2096](../../../../packages/server/src/commands/run.ts#L2092-L2096) - the startup lines for the API and the routes listeners"
  - "[code://packages/server/src/commands/options.ts#L721-L748](../../../../packages/server/src/commands/options.ts#L721-L748) - the schema of `httpApi`, `routes` and `modelProxy`: the shape to copy, and the descriptions to shorten"
  - "[code://packages/server/src/config.ts#L370-L402](../../../../packages/server/src/config.ts#L370-L402) - `httpApi` and `modelProxy` in `Config`"
  - "[code://packages/server/src/rootconfig.ts#L32](../../../../packages/server/src/rootconfig.ts#L32) - `DAEMON_KEYS`, the keys a client can set"
  - "[code://packages/server/src/proxy/listener.ts#L1103-L1118](../../../../packages/server/src/proxy/listener.ts#L1103-L1118) - the paths the proxy claims: `/v1` and the root paths; everything else goes to `otherwise`"
---

## Goal

The model calls and the HTTP API are two gates on the same token.
Softov, 2026-11-04: "when api is disabled all api is disabled, less the conversation. when the FUCKING api is enabled and conversation not.. it accept all api, less the conversation".
Today `httpApi` alone serves `/api`, `/mcp` and every model path, so a host cannot serve one without the other.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git show ccce9b12^:packages/server/src/run.ts` - before the rename, the proxy was also served only while `http` was on.
- `rg -n "isRootPath|MODELS_PATH" packages/server/src/proxy` - the proxy claims `/v1/*`, `/models` and the root model paths.

### Runtime path

```
request -> daemon port or httpApi.port -> /mcp -> proxy (/v1, /models, root model paths) -> /api
```

### Gaps

- No setting turns the model paths off while `/api` is on, or on while `/api` is off.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Two gates on the same token: the HTTP API, and the model API | Softov, 2026-11-04, quoted in *Goal* | 02 |
| The key is `modelApi`: `true`, or `{ port, host }`, the same shape as `httpApi` | Softov, 2026-11-04, "call it modelApi with same information as httpApi. modelApi: true, or modelApi: {port, host}" | 01 |
| `modelApi: true`, or no `port`, serves on the listener of the HTTP API | Softov, 2026-11-04, "if modelApi: true, or port absent use the same as the httpApi" | 02 |
| A `port` gives the model API a listener of its own | Softov, 2026-11-04, "a user can run a model api on another port than the api" | 02 |
| The model API serves every path the proxy serves today, `/v1/models` and `/models` included; no path moves | Softov, 2026-11-04, "why are you suggesting to change that?" | 02 |
| `modelProxy` keeps the model names and `sessionCalls`; `modelApi` says only where the model API is served | (defaulted: "same information as httpApi" is a port and a host) | 01 |
| Absent or `false` is off: the model paths answer 404 | (defaulted: a gate that nobody set opens nothing) | 02 |
| With `httpApi` off, `modelApi: true` serves on the daemon's port | (defaulted: that is where `httpApi: true` serves) | 02 |
| A `modelApi.port` equal to `httpApi.port` shares that listener | (defaulted: two listeners cannot bind one port) | 02 |
| `modelApi.host` needs a `port`; `modelApi` needs a credential and is refused with `--stdio` | (defaulted: the rules of `httpApi`) | 01 |
| `/mcp` stays with `httpApi` | (defaulted: `/mcp` is not a model call) | 02 |
| A client can set `modelApi`, and a change needs a restart | (defaulted: `httpApi` is set the same way) | 01 |
| No migration: a 0.14 config that served model calls through `httpApi` adds `modelApi: true`, and the release notes say so | (defaulted: turning it on by itself would undo the gate) | 03 |
| The descriptions of `httpApi`, `modelApi` and `modelProxy` are one short sentence each, without "Set in the configuration file only" | Softov, 2026-11-04, "410 fucking chars for a simple description" | 01 |
| Startup prints `models on http://<host>:<port>` when the model API has a listener of its own | (defaulted: the API and the routes print the same line) | 02 |
| `ahpd config set <key> <value>` and `ahpd config unset <key>` write a daemon setting, and the update note uses them | Softov, 2026-11-04, chose "Add `ahpd config set`" | 04 |

## Proposed architecture

- **State flow** - the config gives two places, one for the API and one for the model API. Each listener chains what it carries: `/mcp`, the proxy, `/api`, then 404.
- **Layer responsibilities** - server: the config key, its checks, and the listeners in `run.ts`. The proxy handler does not change.
- **Source-of-truth files** - [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts), [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the modelApi key](task-01-the-modelapi-key.md) | done | - |
| [02 - the model API is served on its gate](task-02-the-model-api-is-served-on-its-gate.md) | done | 01 |
| [03 - the docs say how to turn it on](task-03-the-docs-say-how-to-turn-it-on.md) | done | 02, 04 |
| [04 - ahpd config set writes a key](task-04-ahpd-config-set-writes-a-key.md) | done | 01 |

## Risks and tradeoffs

- A host that calls models through `httpApi` today gets 404 after the upgrade until it adds `modelApi`.

## Resume state

- **Done so far:** tasks 01 to 04 are implemented on 2026-11-04.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `/github/ahpd` is shared; branch from a fetched main.

## Final verification checklist

- [ ] `pnpm --filter @ahpd/server test` passes, run alone.
- [ ] `pnpm typecheck` and `pnpm boundary` pass.
- [ ] A test daemon with `httpApi` on and `modelApi` off answers `/api` and gives 404 at `/v1/chat/completions`.
- [ ] A test daemon with `httpApi` off and `modelApi` on answers `/v1/models` and gives 404 at `/api`.
