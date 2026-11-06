# The model proxy

The proxy lets a person point their own tool, Claude Code or a script, at this host and call a model by its `<maker>/<name>` with their ahpd token. The host picks the provider, calls it with the provider's own key, and streams the answer back unchanged. Policies say who may call which model, and each call is recorded against the caller's pools.

A provider is a connector of one of the four adapters the host ships. Its key is in the vault or in a daemon variable. Every model a provider lists is callable as `<provider>/<id>`, with no line in the file. An OpenRouter connector serves `openrouter/anthropic/claude-sonnet-5.5`, and a local endpoint serves `local/llama-3`. The `modelProxy` key holds the aliases: a `<maker>/<name>` of your own over one or more providers, and `ahpd proxy list` shows them. This page is about adding a provider and calling a model through one.

## Turning it on

The proxy is served under `/v1` on the listener that carries the [HTTP API](REMOTE.md#http-api), and only while `httpApi` is on:

```json
{ "httpApi": true }
```

With `httpApi.port` it moves with `/api` to the API's own port. With `httpApi` off, `/v1` answers 404 as `/api` does.

## Pointing a tool at it

`http://127.0.0.1:<port>` is the base URL for both an OpenAI SDK and an Anthropic SDK. The OpenAI paths answer at the root as well as under `/v1`; Anthropic's `/v1/messages` and its count path keep their `/v1`.

| Tool | Base URL | Credential |
| --- | --- | --- |
| Claude Code, an Anthropic SDK | `http://127.0.0.1:<port>` | `ANTHROPIC_API_KEY=<ahpd token>`, sent as `x-api-key` |
| An OpenAI SDK | `http://127.0.0.1:<port>` | `OPENAI_API_KEY=<ahpd token>`, sent as `Authorization: Bearer` |

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:9187 ANTHROPIC_API_KEY=$AHPD_TOKEN claude
```

| Path | Dialect | Recorded | Host adapters |
| --- | --- | --- | --- |
| `POST /v1/chat/completions`, `POST /chat/completions` | `openai-chat` | yes | `openai`, `openrouter`, `openai-compatible` |
| `POST /v1/messages` | `anthropic-messages` | yes | `anthropic` |
| `POST /v1/messages/count_tokens` | `anthropic-count-tokens` | no | `anthropic` |
| `POST /responses/input_tokens`, `POST /v1/responses/input_tokens` | `openai-input-tokens` | no | `openai` |
| `POST /embeddings`, `POST /v1/embeddings` | `openai-embeddings` | yes | `openai`, `openrouter` |
| `POST /responses`, `POST /v1/responses`, `POST /responses/compact`, `POST /v1/responses/compact` | `openai-responses` | yes | `openai`, `openrouter` (create only) |
| `GET`, `DELETE /responses/{id}`; `POST /responses/{id}/cancel`; `GET /responses/{id}/input_items` | `openai-responses` | no | `openai` |
| `POST /images/generations`, `POST /images/edits`, `POST /images/variations`, each at the root and under `/v1` | `openai-images` | yes | `openai`, `openrouter` (at `/images`) |
| `POST /audio/speech`, `POST /v1/audio/speech` | `openai-speech` | yes | `openai` |
| `POST /audio/transcriptions`, `POST /audio/translations`, each at the root and under `/v1` | `openai-transcriptions` | yes | `openai` |
| `POST /rerank`, `POST /v1/rerank`, `POST /v2/rerank` | `rerank` | yes | `openrouter` |
| `GET /v1/models`, `GET /models` | the models list | no | - |

Any other path under `/v1` is 404. `/messages` at the root is not the proxy, and neither is a path under `/models` or `/chat/completions`. An `openai-compatible` connector serves the dialects its `accepts` names, and chat alone by default.

A Responses id holds the connector that made it, so a follow-up goes to that connector and nowhere else, with no fallback. The id is the proxy's, not the provider's. A token count costs nothing, so it writes no usage record.

The `Host` may be one of the API's own names, or `127.0.0.1`, `localhost` or `[::1]` at any port, so a tunnel or an SSH forward that lands on another loopback port still reaches it. A browser `Origin` that is not the daemon's own is refused, as it is on `/api`.

## Who may call

The token is the deployment token, which is root, a person's token from `ahpd user token` or `ahpd token mint`, or a team's key. `Authorization: Bearer` and `x-api-key` are both read; sending both with different values is refused.

To call the proxy from another computer, sign in once and mint a token that holds nothing else:

```bash
ahpd token mint --user ana --grant proxy:write --label laptop
```

It reaches `/v1`, and is refused at the rest of `/api`. See [Users](USERS.md#tokens-of-their-own).

A team's key opens the proxy and no other door:

```bash
ahpd token mint --team backend --grant proxy:call --grant proxy:models --label ci
```

A call made with it is charged to `team:<team>`, and to one of the team's projects when the key's scope names one. No person stands behind it, so no `user:` policy row holds it: the team's rows and the host-wide ones do. See [Users](USERS.md#tokens-of-their-own).

A person needs `proxy:call` to call and `proxy:models` to list the models; a team key holds the same two and nothing else. The `proxy:write` and `proxy:read` groups cover the two. The built-in `member` role holds both groups; `guest` holds neither. See [USERS.md](../sdk/USERS.md).

A person's call is charged to a team and project, named in an `X-AHP-Scope` header or a `?scope=` query (`backend` or `backend:billing`), and to their primary otherwise. Neither the header nor the query goes to the provider.

A call adds meta to what its key holds as LiteLLM takes a call's `spend_logs_metadata`: an `X-AHP-Meta` header whose value is a JSON object of string values, such as `{"env":"dev","client":"pi"}`, and the same object as the body's `metadata.spend_logs_metadata`. The record carries the key's meta, the header's entries and the body's together; a name the key holds keeps the key's value, and a name the header holds keeps the header's over the body's. A header or a body meta that is not such an object is refused with 400, and the call is not sent. No `X-AHP-*` header goes to the provider, and neither does `spend_logs_metadata`.

A key can carry its own scope, so a client that is handed nothing but a base URL and a key is charged where the key says. That is what pi needs:

```bash
ahpd token mint --user ana --grant proxy:call --grant proxy:models --scope backend:billing --label pi
```

A call made with such a key is charged to its scope when it names none, and refused with 403 when it names another. The scope is checked at every call, so a membership taken away stops the key without a revoke. See [Users](USERS.md#tokens-of-their-own).

A session's own token is answered as that session, when the host hands sessions a token for the proxy.

## Adding a provider

A provider is a connector, made from one of the four adapters the host ships. Its key is a secret: the connectors channel keeps it in the vault, or a host connector names a daemon variable with `{ "fromEnv": "<NAME>" }`. The record never holds the key.

| Adapter | Config | Called in |
| --- | --- | --- |
| `openrouter` | `key`, required; `endpoint`, which defaults to `https://openrouter.ai/api/v1` | `openai-chat`, `openai-embeddings`, `openai-responses`, `openai-images` (at `/images`), `openai-speech`, `openai-transcriptions`, `rerank` |
| `anthropic` | `key`, required; `endpoint`, which defaults to `https://api.anthropic.com` | `anthropic-messages`, `anthropic-count-tokens` |
| `openai` | `key`, required; `endpoint`, which defaults to `https://api.openai.com/v1` | `openai-chat`, `openai-input-tokens`, `openai-embeddings`, `openai-responses`, `openai-images`, `openai-speech`, `openai-transcriptions` |
| `openai-compatible` | `endpoint`, required; `key`, optional; `accepts`, which defaults to `["openai-chat"]` | `accepts` |

A client makes one with `x-ahpd/connectors/put`. This is the host's OpenRouter account, whose key goes to the vault:

```json
{ "id": "openrouter-main", "adapter": "openrouter", "owner": "host", "config": { "key": "sk-or-..." } }
```

An OpenRouter connector may also be made by signing in, and then no key is typed. `x-ahpd/connectors/signin` answers a URL a person opens, and `x-ahpd/connectors/signin-finish` takes the pasted code and stores the key the exchange answers. The sign-in and the exchange use OpenRouter's public URLs, and a connector's `endpoint` moves neither.

An `openai-compatible` server, such as a model on this machine, needs no key unless it asks for one:

```json
{ "id": "local", "adapter": "openai-compatible", "owner": "host", "config": { "endpoint": "http://127.0.0.1:1234/v1" } }
```

A host connector may name a daemon variable instead of a value for the vault, which is the way to keep a key where it already is:

```json
{ "id": "openrouter-main", "adapter": "openrouter", "owner": "host", "config": { "key": { "fromEnv": "OPENROUTER_API_KEY" } } }
```

Only a host connector may name one: a team's or a person's connector is refused. The variable is read when the connector opens, so one that is not set leaves it closed. A connector that is put or removed takes effect on the next call, because the proxy reads the open connectors each time. `x-ahpd-adapters` lists the four adapters with the form and the icon of each.

### Whose connector serves a call

A model entry names a provider, which is an adapter's name or one connector's id. The call goes to the first usable connector of it, in this order:

1. the caller's own, `user:<id>`;
2. the team of the call's scope, `team:<team>`;
3. the host's, `host`.

Two connectors of one tier are tried in id order, and each one after the first is a fallback. A team connector serves a call only when the call's scope is that team, and a person's connector serves only that person. To choose one endpoint among several, name the connector's id in the entry. The usage record says which connector's key paid.

### Moving from `modelProxy.providers`

A file that still writes `modelProxy.providers` stops the daemon at start, with a message that names this page. Make one connector for each entry, then remove the key from the file.

| Entry | Connector |
| --- | --- |
| `openrouter`, with a key in `OPENROUTER_API_KEY` | `{ "id": "openrouter", "adapter": "openrouter", "owner": "host", "config": { "key": { "fromEnv": "OPENROUTER_API_KEY" } } }` |
| `anthropic`, with a key in `ANTHROPIC_API_KEY` | `{ "id": "anthropic", "adapter": "anthropic", "owner": "host", "config": { "key": { "fromEnv": "ANTHROPIC_API_KEY" } } }` |
| `openai`, with a key in `OPENAI_API_KEY` | `{ "id": "openai", "adapter": "openai", "owner": "host", "config": { "key": { "fromEnv": "OPENAI_API_KEY" } } }` |
| `local`, an `openai-compatible` endpoint | `{ "id": "local", "adapter": "openai-compatible", "owner": "host", "config": { "endpoint": "http://127.0.0.1:1234/v1" } }` |

An entry that named a provider now names the connector's id, or the adapter's name when that is enough. A key the file wrote is a secret, and goes to the vault through the put. A key that was in a daemon variable is `{ "fromEnv": "<NAME>" }`.

## How a name is routed

The body's `model` is a name from the `modelProxy.models` table, or a name a provider lists.

A name in the table goes to the first entry of that name, in the file's order, whose provider:

1. accepts the dialect the call came in,
2. is allowed by policy, when `policies.check` is on, and
3. has a connector this caller may use, as the order above says.

The table is for an alias: one name over one or more providers. It wins over a fetched name of the same spelling, because the table is what a person wrote.

A name the table does not hold is read as `<provider>/<id>`, split at the first slash. The prefix is the adapter's name, so `openrouter/anthropic/claude-sonnet-5.5` is OpenRouter's own model `anthropic/claude-sonnet-5.5`. An `openai-compatible` connector has no vendor name, so its prefix is its own id: `local/llama-3` is the connector `local`'s model `llama-3`. Every ready connector with that prefix serves the call, in the order above. A policy is asked on the whole name, so `openrouter/*` allows every OpenRouter model. A call is sent even when the connector's list does not hold the id yet, and the provider's own 404 names the model.

The body is sent unchanged except for `model`, which becomes that provider's own id.
A multipart body is read as a form. Its `model` field is replaced, and the form is sent again, so its files and other fields pass through. The provider's key goes in its dialect's header: `Authorization: Bearer` for the `openai` family, `x-api-key` for `anthropic`'s. Your token, `X-AHP-Scope`, cookies, connection headers (with any header your `Connection` header names) and the account headers below are not sent. Nothing is added to the body: an OpenAI stream that does not ask for `stream_options.include_usage` is recorded without tokens.

The upstream URL is the provider's endpoint plus the dialect's path. A chat call uses `/chat/completions`; a message uses `/v1/messages`; an image edit uses the caller's path. A connector's `paths` replaces one dialect's path, as OpenRouter's `openai-images` names `/images`. Redirects are not followed.

The answer comes back with the provider's status, headers and body as they came, SSE included, less the account headers below. A provider's own error is passed through as it came.

## Account headers

The provider's key is the host's account, so nothing that picks or describes that account crosses the proxy:

| Header | Not sent | Not returned |
| --- | --- | --- |
| `openai-organization`, `openai-project` | yes | yes |
| `anthropic-organization-id` | yes | yes |
| `x-ratelimit-*` (OpenAI, OpenRouter) | - | yes |
| `anthropic-ratelimit-*` | - | yes |

`retry-after` and `retry-after-ms` are returned: they say only when this answer may be retried, and a client's SDK backs off by them.

## When a provider fails

If the provider refuses the connection, or answers 429 or 5xx, and nothing has reached you yet, the call goes to the next entry. A provider that sends no status within 120 s is answered 504 and not retried, since it may still be doing the work. Once a byte has reached you, it is never retried. If you hang up between two entries, the next one is not called.

A stream that goes 300 s without a chunk is ended. A provider that fails mid-answer cuts your connection, so your client sees a transport error rather than a short answer that looks whole. Hanging up cancels the provider's call.

## What a refusal means

Every refusal is the dialect's own error body, so the tool shows the message: Anthropic's carries `request_id: null`, the field its errors always hold, as VS Code's proxy writes it. On `/v1/models` the shape follows `anthropic-version`: Anthropic's with the header, OpenAI's without. An unknown path under `/v1` is OpenAI's.

| Status | Type | When |
| --- | --- | --- |
| 400 | `invalid_request_error` | The body is not JSON or has no `model`; two different credentials |
| 401 | `authentication_error` | No credential, or one this host does not know; its `WWW-Authenticate` is `Bearer realm="ahpd"`, with `error="invalid_token"` beside it when a credential came |
| 403 | `permission_error` | No `proxy:call`; a scope you are not in; a policy refuses every entry; a policy limit or the key's own limit has no room; a foreign `Host` or `Origin` |
| 404 | `not_found_error` | `model <name> is not served here`, or it is served only in the other dialect, and the message names the path to call |
| 405 | `invalid_request_error` | A method other than `POST` (or `GET` on `/v1/models`) |
| 413 | `request_too_large` | A body over 128 MiB, the request size Anthropic documents for its Messages API |
| 502 | `api_error` | The provider could not be reached, or it refused this host's key with a 401 or 403 (see [Key refusals](#key-refusals)) |
| 503 | `api_error` | No open connector serves any entry for this caller; the message names each provider it looked for, never a value |
| 504 | `timeout_error` | The provider sent no status in time; the next entry is not tried |

A limit counted per minute refuses a call the same way, and its sentence says `this minute`:

```
burst has no room: 60 / 60 calls this minute
```

A minute limit is read from the daemon's own totals, kept in memory beside the usage store.
A call is counted when it is allowed, so a burst of calls cannot pass one.
A request is one call: it counts once, on the keys of the candidate it is sent to, so a model a proxy serves from two connectors is not two calls and a fallback to the next candidate is the same call.
A restart starts every minute count at zero, which is the most a minute limit can lose.

## The models list

`GET /v1/models` and `GET /models` list the names you could call now. First each name in the table with at least one ready connector you may use and that a policy allows you. Then each model the ready connectors list, as `<provider>/<id>`. A fetched name is listed once, from the connector the call would go to, and a name the table holds is listed from the table. Never listed: a connector, its key, or a provider's own model id on its own.

Each model carries OpenRouter's fields when the provider sent them: `name`, `context_length`, and `pricing`. `pricing` is OpenRouter's shape, dollars per token as strings, such as `{ "prompt": "0.000003", "completion": "0.000015" }`. A price in the file is written per million tokens there, and is divided for this list, and it wins over the fetched price. The list carries `total_count`.

It answers in Anthropic's list shape when `anthropic-version` is sent, and OpenAI's otherwise. Both shapes carry the same fields, so a fetched model shows its name and its price in either.

```json
{
  "object": "list",
  "data": [
    { "id": "openai/gpt-5.5", "object": "model", "created": 0, "owned_by": "openai", "pricing": { "prompt": "0.000005", "completion": "0.00003" } },
    { "id": "openrouter/anthropic/claude-sonnet-5.5", "object": "model", "created": 0, "owned_by": "openrouter", "name": "Anthropic: Claude Sonnet 5.5", "context_length": 200000, "pricing": { "prompt": "0.000003", "completion": "0.000015" } }
  ],
  "total_count": 2
}
```

A ready connector's list is read the first time the proxy sees the connector, and again each hour. A read that fails keeps the list the connector had.

A client reads one connector's list with `x-ahpd/connectors/models`, as [PLUGINS.md](../plugins/PLUGINS.md) says. Each model carries `model`, the name a caller sends, and `callable`, whether that caller may call it now, as this list decides it. A connector whose list was never read is read first, so a client sees the models of a connector it just made.

## What is recorded

Each answered call writes one usage record with `source: "proxy"`: the model name, the adapter that answered, the connector whose key paid, the tokens the answer reported, the owner (`user:<id>`, or `root:<host>` for the deployment token), the id of the key that made the call when there was one, what the key and the call said about themselves in `meta`, the team and project, and the pools those give. A record is written when the stream ends, is cut, or fails. `ahpd usage` shows them.

A record carries two costs. `providerCost` is what the provider reported, when it reported one: OpenRouter sends `usage.cost` with `cost_details`, which give the amount and what was sent and what came back. `cost` is what the pools are charged. A `price` on the entry, or a fetched `pricing` for a model the table does not hold, is the price of the call (`from: "price"`). Cache tokens are charged at the input price. A speech call is charged by `characters` and a transcription by `minutes`. Without a price, the cost is the provider's own figure (`from: "harness"`), so a call nobody priced is charged what it cost. A price that names one side and not the other gives no cost at all when the unnamed side has tokens, because an absent price is not a price of zero; a side priced at 0 is free.

`characters` is dollars per million characters of a speech `input`. `minutes` is dollars per minute of audio a transcription reports in `usage.seconds`. A price that names neither loads as before: the call is recorded, with no cost of its own when the provider named none.

## Session calls

A session whose harness calls the proxy is recorded twice: once by the session meter (`source: "agent"`) and once here (`source: "proxy"`), linked by session, chat and turn. A session's call is also policy-checked here as its owner. To turn the proxy's half off:

```json
{ "modelProxy": { "sessionCalls": "skip" } }
```

`record` is the default.

## Key refusals

A provider's 401 or 403 is about the key this host called it with, not the caller's. By default the caller gets this host's 502, `model <name> on <provider> refused this host's key`, and the provider's status and words go to the log: a client that read a 401 would ask its person to sign in again, and the provider's body can name the host's account. `passthrough` sends the provider's status and error to the caller as they came, as VS Code's Claude proxy re-emits an upstream error:

```json
{ "modelProxy": { "keyRefusal": "passthrough" } }
```

`hostError` is the default.

## Not done yet

- Limits and pools are not enforced ([POLICY.md](../sdk/POLICY.md)).
- No translation between dialects: a name served only in the other dialect is refused.
- No cache prices; no cache-affinity routing.
