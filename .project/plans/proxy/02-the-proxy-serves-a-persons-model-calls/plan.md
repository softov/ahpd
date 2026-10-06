---
title: The proxy serves a person's chat completions and messages, streamed back unchanged
domain: proxy
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/proxy/01-the-proxy-knows-its-providers-and-models/plan.md
  - plans/policy/01-a-policy-says-who-may-use-what/plan.md
  - plans/usage/01-usage-is-kept-behind-one-port/plan.md
  - plans/host/35-a-person-belongs-to-teams-and-projects/plan.md
changes: []
creates: []
decisions:
  - decisions/the-proxy-answers-under-v1-beside-the-api.md
  - decisions/the-models-list-answers-in-the-dialect-the-caller-sent.md
  - decisions/a-model-is-named-by-its-maker-and-runs-on-a-provider.md
  - decisions/the-http-api-is-on-the-daemon-port-under-api.md
  - decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md
  - decisions/a-request-naming-no-scope-uses-the-persons-primary.md
  - decisions/agent-usage-is-charged-to-owner-team-and-project-pools.md
refs:
  - "[code://packages/server/src/proxy/providers.ts#L19-L111](../../../../packages/server/src/proxy/providers.ts#L19-L111) - dialects, providers, model entries, the built-ins and `proxyConfiguration`: the table a call is routed by"
  - "[code://packages/server/src/commands/proxy.ts#L74-L93](../../../../packages/server/src/commands/proxy.ts#L74-L93) - `proxy.list`, which reads `keySet` from the environment and never the key; the pattern for reading a key"
  - "[code://packages/server/src/http.ts#L77-L124](../../../../packages/server/src/http.ts#L77-L124) - `hostRefusal`, `foreign` and `apiHandler`: the guard and the mount the proxy sits beside"
  - "[code://packages/server/src/http.ts#L221-L238](../../../../packages/server/src/http.ts#L221-L238) - `guarded`, the wrapper no malformed request throws out of"
  - "[code://packages/server/src/commands/run.ts#L353-L394](../../../../packages/server/src/commands/run.ts#L353-L394) - where `/api` is built, chained below the tools servers and plugin routes, or bound on `http.port`"
  - "[code://packages/server/src/commands/run.ts#L73-L84](../../../../packages/server/src/commands/run.ts#L73-L84) - `apiOrigins`, the names the API answers to"
  - "[code://packages/server/src/commands/authorize.ts#L41-L84](../../../../packages/server/src/commands/authorize.ts#L41-L84) - `authorizeOverHttp`: the deployment token is root, then `users.verify`, then `standing`; the order the proxy's caller check copies"
  - "[code://packages/sdk/src/users.ts#L807-L854](../../../../packages/sdk/src/users.ts#L807-L854) - `verify`: a minted token's hash, then each issuer over the network"
  - "[code://packages/sdk/src/scopes.ts#L155-L180](../../../../packages/sdk/src/scopes.ts#L155-L180) - `scopeFor`, which resolves a named `team:project` or the person's primary"
  - "[code://packages/sdk/src/decide.ts#L157-L200](../../../../packages/sdk/src/decide.ts#L157-L200) - `decide`, which takes kind `model` with `{ model, proxy }` and nothing calls for that kind yet"
  - "[code://packages/sdk/src/host/owners.ts#L138](../../../../packages/sdk/src/host/owners.ts#L138) - how the host calls `decide` and turns a refusal into its answer"
  - "[code://packages/sdk/src/types/usage.ts#L59-L77](../../../../packages/sdk/src/types/usage.ts#L59-L77) - `ModelCall` and `ModelUse`, with `source: 'proxy'` already in the base"
  - "[code://packages/sdk/src/meter.ts#L167-L224](../../../../packages/sdk/src/meter.ts#L167-L224) - `poolsOf` and the record the agent meter writes; the proxy's record mirrors it"
  - "[code://packages/server/test/server-http.test.ts](../../../../packages/server/test/server-http.test.ts) - a real daemon with `http` on, the test pattern for the listener"
  - npm://@cofold/remote@0.4.0 - `toNodeListener` aborts `request.signal` when the client hangs up, and streams a `Response` body with backpressure
  - https://docs.anthropic.com/en/api/errors - Anthropic's error body and the error type for each status
  - https://platform.openai.com/docs/guides/error-codes - OpenAI's error body and status codes
---

## Goal

A person points their own tool, Claude Code or a script, at this host and calls a model by its `<maker>/<name>` with their ahpd token.
The call goes to the first provider that serves that name in the caller's dialect, with the provider's own model id and the provider's key, and the answer streams back byte for byte.
A refusal reads as the dialect's own error, so the tool shows it rather than failing to parse it.
Policies decide who may call which model, and each call is recorded against the caller's pools.
This is the listener container/05 p12 waits for, and it names the hook p12 fills.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "listen|serve|fetch" packages/server/src/proxy` - nothing; proxy 01 is the table and `ahpd proxy list` only.
- `rg -n "apiHandler|withoutApi|pluginRoutes|listenApi" packages/server/src` - one mount, in `run.ts`: tools servers, then plugin routes, then `/api` or the 426, on the daemon's port; `/api` alone on `http.port`.
- `rg -n "decide\(" packages/sdk/src` - one caller, `host/owners.ts`, for kinds `agent` and `computer`; `model` is decided by nothing.
- `rg -n "source: 'proxy'" packages` - only the type; nothing writes a proxy record.
- `rg -n "X-AHP-Scope|scope=" .project packages` - host 35 settled the header and the query string; no code reads either.
- `rg -n "proxy listener" .project` - policy/01's deferred row, usage/01's "nothing writes records yet", host 35's scope row and container/05 p12's blocked tasks 01 and 02.
- `~/.config/ahpd/config.json` - `http: true` on `0.0.0.0:37537`, a users file, a `local` provider at `http://127.0.0.1:1234/v1` (`openai-chat`, no key) and four model names over `anthropic`, `openrouter` and `local`.

### Runtime path

```
tool -> POST /v1/chat/completions | /v1/messages on the API's listener
  -> guard (Host, Origin, JSON) -> caller: deployment token | whose (p12) | users.verify -> grant
  -> scope: X-AHP-Scope | ?scope= | primary -> body.model = <maker>/<name>
  -> route: first entry accepting the dialect, allowed by policy, key set
  -> fetch <endpoint><dialect path>, model = entry id, provider key, caller's credential stripped
  -> status and body streamed back unchanged; usage read from a copy -> ModelUse source 'proxy'
```

### Gaps

- No route for `/v1`; the daemon answers it 426 with `http` on, and `/api` 404s with it off.
- No caller check that reads `x-api-key`, which is what Claude Code sends with `ANTHROPIC_API_KEY`.
- No grant subject for calling a model.
- Nothing calls `decide` for kind `model`, and nothing writes a `source: 'proxy'` record.
- No hook for a session's own token (container/05 p12 task 01 builds it, and waits for this plan to name it).
- `Not found: a daemon option for session calls - proxy 01's proxy key holds only providers and models.`
- `Not found: an HTTP client with timeouts or retries in packages/server - searched fetch, undici, AbortSignal.timeout`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [The proxy answers under /v1 on the listener that carries /api, and only while http is on](../../../decisions/the-proxy-answers-under-v1-beside-the-api.md) | defaulted |
| [GET /v1/models answers in the dialect the caller sent](../../../decisions/the-models-list-answers-in-the-dialect-the-caller-sent.md) | defaulted |
| [A model is named by its maker, and where it runs is a provider](../../../decisions/a-model-is-named-by-its-maker-and-runs-on-a-provider.md) | Softov, 2026-10-01 |

| What | Source | Task |
| --- | --- | --- |
| Serve `POST /v1/chat/completions` as `openai-chat` and `POST /v1/messages` as `anthropic-messages` | Softov, 2026-10-06: "add some proxies for chat/completions so I can test it"; chose config entries now and to plan the listener | 01 |
| A call names its model as `<maker>/<name>` in the body's `model` | Softov, 2026-10-06 | 03 |
| A call goes to the first entry of that name, in the file's order, that accepts the caller's dialect | Softov, 2026-10-06 | 03 |
| It goes out with the provider's key read from its variable, and the provider's own model id in place of the name | Softov, 2026-10-06; proxy/01's model entry | 03, 04 |
| The answer streams back unchanged (SSE), no translation | Softov, 2026-10-06; proxy/01, "passthought now.. space for translation in a future" | 04 |
| The upstream URL is the endpoint plus `/chat/completions` for `openai-chat` and `/v1/messages` for `anthropic-messages`, since an endpoint is written as each vendor's SDK base URL | [`code://packages/server/src/proxy/providers.ts#L83-L99`](../../../../packages/server/src/proxy/providers.ts#L83-L99) | 03 |
| A refusal is the dialect's own error body and status | Anthropic's and OpenAI's error references | 01 |
| A caller's credential is `Authorization: Bearer` or `x-api-key`, checked as the deployment token (root), then the session-token hook, then `users.verify`, then `standing` | [`code://packages/server/src/commands/authorize.ts#L67-L84`](../../../../packages/server/src/commands/authorize.ts#L67-L84); the hook is checked before `verify` so a session token never reaches an issuer over the network | 02 |
| The scope is read from `X-AHP-Scope` or `?scope=`, else the person's primary | host 35, Softov, 2026-10-01: "X-AHP-Scope + ?scope=" | 02 |
| The caller's credential, `X-AHP-Scope`, cookies, `Host` and hop-by-hop headers never go upstream; the provider's key never reaches a log line, a refusal or a record | (defaulted: a credential of this host is not a provider's to see) | 04 |
| The body is parsed only to read and replace `model`; nothing is injected, so a caller that did not ask for usage in an OpenAI stream is recorded without tokens | Softov, 2026-10-06: "streams back unchanged" | 04, 06 |
| An entry whose key variable is unset is passed over like one that does not serve the name; with none left, the refusal names each provider and variable passed over | (defaulted: known before the call is made, so nothing is spent finding it out) | 03 |
| The provider has 120 s to send its status and headers, then 300 s between chunks; no limit on the whole call | (defaulted: a local model loading its weights is slow to start, and a long answer is not a hung one) | 05 |
| A client that hangs up aborts the upstream call | `npm://@cofold/remote@0.4.0`: `toNodeListener` aborts `request.signal` on hang-up | 05 |
| With `policies.check` on, each entry is checked as kind `model` with `{ model, proxy }`, and route takes the first allowed; root and a host with no users directory are not checked | policy/01's deferred row "the `model` kind ... proxy/02"; `docs/POLICY.md`, "Never checked" | 06 |
| A call writes one `ModelUse` with `source: 'proxy'`, the model name, the provider, the tokens the answer reported, the owner, the scope and the pools `poolsOf` gives; cost from the entry's `price` when it has one, `from: 'price'` | usage/01 "the proxy listener writes to this port"; [`code://packages/sdk/src/meter.ts#L167-L171`](../../../../packages/sdk/src/meter.ts#L167-L171) | 06 |
| `GET /v1/models` lists the names the caller may use: a name with at least one entry its policy allows | (defaulted: the list is what a call would accept) | 07 |
| A person needs a grant of a new `proxy` subject to call: `proxy:write` to call, `proxy:read` to list; the built-in `member` gets both | Softov, 2026-10-06, asked "what grant does calling need?": "New `proxy` subject" | 02, 07 |
| On a refused connection, a 429 or a 5xx, and only before any byte reached the caller, the call goes to the next candidate entry; a header timeout is not one of them (see the 504 row below) | Softov, 2026-10-06, asked "does a call fall back to the next entry when the provider fails?": "Yes, before any byte" | 05 |
| A call made with a session's token is checked as kind `model` and recorded with `source: 'proxy'`, linked to the session, chat and turn the token answers; `proxy.sessionCalls: "record" \| "skip"` (default `record`) turns both off for session calls, and the docs say the session meter and the proxy can count the same tokens twice | Softov, 2026-10-06, asked "is a session-token call checked and recorded by the proxy?": "check and record, with configurable default to check and record. Since a session is a harness and a harness code inside it could decide to call a proxy ... best to match the two and see it and disable, than not seeing none or seeing no cost" | 02, 06, 08 |
| `/v1` accepts `Host` as the daemon's names or `127.0.0.1`, `localhost` and `[::1]` at any port, since a `-R` forward lands on a loopback port that is not the daemon's and a rebinding page sends its own name; `Origin` is held as the API holds it | (defaulted: container/05 p12's forward; Softov kept the proposal, 2026-10-06) | 01 |
| A provider that fails mid-answer errors the caller's stream, so the caller's connection is cut and its client sees a transport error rather than a short body that looks whole; a stall the proxy reports and a caller's own hang-up still end the stream cleanly | Softov, 2026-10-06, review of the proxy/02 build | 05 |
| `openai-organization`, `openai-project` and `anthropic-organization-id` are not sent upstream and not returned; `x-ratelimit-*` and `anthropic-ratelimit-*` are not returned; `retry-after` and `retry-after-ms` are returned, since they say only when the answer may be retried; the list is in `docs/PROXY.md` | Softov, 2026-10-06, review of the proxy/02 build | 04 |
| A header the caller's `Connection` header names is hop-by-hop and not sent upstream, nor one the provider's names returned (RFC 9110 7.6.1) | Softov, 2026-10-06, review of the proxy/02 build | 04 |
| A provider that sends no headers within the timeout is answered 504 in the dialect's error body and the next entry is not tried, since it may be doing the work; fallback is only for a refusal or an unreachable provider before any byte | Softov, 2026-10-06, review of the proxy/02 build | 05 |
| A caller who hung up between two attempts starts no further upstream call: `request.signal` is checked before each attempt | Softov, 2026-10-06, review of the proxy/02 build | 05 |
| Left for later: limits and pools (policy/02), cache-affinity routing, translation between dialects, cache prices | policy/01 deferred.md; proxy/01 implemented.md | - |

## Proposed architecture

- **Data flow** - `request -> guard -> caller -> scope -> route -> forward -> stream`; one handler, `proxyHandler(options)`, given the proxy configuration, the deployment token, the users directory, the policies store and switch, the usage port, the host id and an optional `whose`.
- **Event flow** - the upstream body is teed: one branch is the response, the other is read for usage and written as one record when the stream ends, is cut or fails.
- **State flow** - none kept; every request reads the configuration, the environment and the users file as they are.
- **Layer responsibilities** - `packages/server`: the handler, the routing, the mount, the refusal bodies, the docs · `@ahpd/sdk`: `decide`, `scopeFor`, `Usage` and a new grant subject, nothing else.
- **What container/05 p12 gets** - the proxy URL is the API's address (`http://127.0.0.1:<port>`, with `/v1` for an OpenAI client); the token travels as `x-api-key` or `Authorization: Bearer`; the hook is `ProxyOptions.whose?(token): SessionCaller | undefined`, `SessionCaller = { session: string; chat?: string; turn?: string; owner?: Owner; principal?: Principal; scope?: Scope }`, asked after the deployment token and before `users.verify` (task 02); a session caller is policy-checked and recorded unless `proxy.sessionCalls` is `skip` (task 06).
- **Source-of-truth files** - `CREATE: packages/server/src/proxy/listener.ts` (the handler), `CREATE: packages/server/src/proxy/route.ts` (routing), `CREATE: packages/server/src/proxy/dialects.ts` (paths, auth headers, error bodies, usage readers, list shapes).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - /v1 answers in each dialect, and refuses in its own error shape](task-01-v1-answers-in-each-dialect.md) | implemented | - |
| [02 - A caller is a person, root or a session, and may call](task-02-a-caller-is-somebody.md) | implemented | 01 |
| [03 - A model name is routed to the first entry that can take the call](task-03-a-name-is-routed.md) | implemented | - |
| [04 - The call goes out with the provider's key and streams back unchanged](task-04-the-call-streams-through.md) | implemented | 01, 03 |
| [05 - A call ends when either side does, and on a timeout](task-05-a-call-ends-when-either-side-does.md) | implemented | 04 |
| [06 - A policy decides the model, and the call is recorded](task-06-policy-and-usage.md) | implemented | 02, 04 |
| [07 - GET /v1/models lists the names a caller may use](task-07-the-models-list.md) | implemented | 02, 03 |
| [08 - Docs, and a real call through openrouter and LM Studio](task-08-docs-and-by-hand.md) | implemented | 05, 06, 07 |

## Risks and tradeoffs

- A person's token now spends the host's provider keys - the `proxy:write` grant and `policies.check` are the gates; without either, anybody in the users file may call.
- Passing the body through unchanged means a caller's own `stream_options`, tools and beta headers reach the provider as sent - that is the point; a provider that refuses them answers in its own words.
- `fetch` decompresses, so an upstream `content-encoding` must not be copied onto the decoded body - task 04 drops it and `content-length`.
- Fallback after a failure can double-spend when a provider failed after doing the work - it only retries before any byte reached the caller.

## Resume state

- **Done so far:** tasks 01 to 08 implemented 2026-10-06, awaiting review; see [implemented.md](implemented.md).
- **Next action:** Softov runs task 08's by-hand steps against his own daemon and reviews; container/05 p12 task 01 can build `whose` against `SessionCaller` in `packages/server/src/proxy/caller.ts`.
- **Open questions:** none; the four asked on 2026-10-06 are rows in the second table.
- **Watch out for:** never put a real provider key in a test; set a marker value and assert it is absent; `http` must be on for any of this to answer; the anthropic built-in's endpoint has no `/v1` and the OpenAI-style ones do, which is why the dialect path differs; do not change container/05 p12 here, it builds `whose` against task 02's type.

## Final verification checklist

- [ ] A curl through `openrouter` and one through `local` (LM Studio) stream an answer to Softov's config.
- [ ] Claude Code with `ANTHROPIC_BASE_URL` at the daemon and an ahpd token as `ANTHROPIC_API_KEY` answers a prompt, when `ANTHROPIC_API_KEY` is set in the daemon.
- [ ] A session-token call with `proxy.sessionCalls` at `record` and at `skip` behaves as task 06 says.
- [ ] Every refusal in tasks 01 to 07 parses with the dialect's SDK error type.
- [ ] A marker key is in no log line, refusal or usage record; a caller's token is in no upstream request.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm boundary` green.
- [ ] `docs/PROXY.md` written; `docs/DAEMON.md`, `docs/POLICY.md` and `plans/proxy/00-proxy.md` updated.
- [ ] `plans/index.md` updated.
