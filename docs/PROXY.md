# The model proxy

The proxy lets a person point their own tool, Claude Code or a script, at this host and call a model by its `<maker>/<name>` with their ahpd token. The host picks the provider, calls it with the provider's own key, and streams the answer back unchanged. Policies say who may call which model, and each call is recorded against the caller's pools.

The providers and the model names are the `proxy` key of the configuration; `ahpd proxy list` shows them. This page is about calling them.

## Turning it on

The proxy is served under `/v1` on the listener that carries the [HTTP API](DAEMON.md#an-http-api-for-the-commands-the-terminal-runs), and only while `http` is on:

```json
{ "http": true }
```

With `http.port` it moves with `/api` to the API's own port. With `http` off, `/v1` answers 404 as `/api` does.

## Pointing a tool at it

| Tool | Base URL | Credential |
| --- | --- | --- |
| Claude Code, an Anthropic SDK | `http://127.0.0.1:<port>` | `ANTHROPIC_API_KEY=<ahpd token>`, sent as `x-api-key` |
| An OpenAI SDK | `http://127.0.0.1:<port>/v1` | `OPENAI_API_KEY=<ahpd token>`, sent as `Authorization: Bearer` |

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:37537 ANTHROPIC_API_KEY=$AHPD_TOKEN claude
```

| Path | Read as |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI's chat completions (`openai-chat`) |
| `POST /v1/messages` | Anthropic's messages (`anthropic-messages`) |
| `GET /v1/models` | The names you may call |

Any other path under `/v1` is 404.

The `Host` may be one of the API's own names, or `127.0.0.1`, `localhost` or `[::1]` at any port, so a tunnel or an SSH forward that lands on another loopback port still reaches it. A browser `Origin` that is not the daemon's own is refused, as it is on `/api`.

## Who may call

The token is the deployment token, which is root, or a person's token from `ahpd user token`. `Authorization: Bearer` and `x-api-key` are both read; sending both with different values is refused.

A person needs `proxy:call` to call and `proxy:models` to list the models. The `proxy:write` and `proxy:read` groups cover the two. The built-in `member` role holds both groups; `guest` holds neither. See [USERS.md](USERS.md).

A person's call is charged to a team and project, named in an `X-AHP-Scope` header or a `?scope=` query (`backend` or `backend:billing`), and to their primary otherwise. Neither the header nor the query goes to the provider.

A session's own token is answered as that session, when the host hands sessions a token for the proxy.

## How a name is routed

The body's `model` is a `<maker>/<name>` from the `proxy.models` table. The call goes to the first entry of that name, in the file's order, whose provider:

1. accepts the dialect the call came in,
2. is allowed by policy, when `policies.check` is on, and
3. has its key variable set, or needs no key.

The body is sent unchanged except for `model`, which becomes that provider's own id. The provider's key goes in its dialect's header: `Authorization: Bearer` for `openai-chat`, `x-api-key` for `anthropic-messages`. Your token, `X-AHP-Scope`, cookies, connection headers (with any header your `Connection` header names) and the account headers below are not sent. Nothing is added to the body: an OpenAI stream that does not ask for `stream_options.include_usage` is recorded without tokens.

The upstream URL is the provider's endpoint plus `/chat/completions` for `openai-chat`, or `/v1/messages` for `anthropic-messages`. Redirects are not followed.

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

Every refusal is the dialect's own error body, so the tool shows the message. On `/v1/models` the shape follows `anthropic-version`: Anthropic's with the header, OpenAI's without. An unknown path under `/v1` is OpenAI's.

| Status | Type | When |
| --- | --- | --- |
| 400 | `invalid_request_error` | The body is not JSON or has no `model`; two different credentials |
| 401 | `authentication_error` | No credential, or one this host does not know |
| 403 | `permission_error` | No `proxy:call`; a scope you are not in; a policy refuses every entry; a foreign `Host` or `Origin` |
| 404 | `not_found_error` | `model <name> is not served here`, or it is served only in the other dialect, and the message names the path to call |
| 405 | `invalid_request_error` | A method other than `POST` (or `GET` on `/v1/models`) |
| 413 | `request_too_large` | A body over 32 MiB |
| 502 | `api_error` | The provider could not be reached |
| 503 | `api_error` | Every entry's key variable is unset; the message names each provider and variable, never a value |
| 504 | `timeout_error` | The provider sent no status in time; the next entry is not tried |

## The models list

`GET /v1/models` lists the names you could call now: a name with at least one entry whose key is set (or needs none) and that a policy allows you. Only the names are listed, never a provider, its id, a price or a variable. It answers in Anthropic's list shape when `anthropic-version` is sent, and OpenAI's otherwise.

## What is recorded

Each answered call writes one usage record with `source: "proxy"`: the model name, the provider, the tokens the answer reported, the owner (`user:<id>`, or `root:<host>` for the deployment token), the team and project, and the pools those give. With a `price` on the entry, the cost is worked out from it (`from: "price"`), with cache tokens at the input price. A record is written when the stream ends, is cut, or fails. `ahpd usage` shows them.

## Session calls

A session whose harness calls the proxy is recorded twice: once by the session meter (`source: "agent"`) and once here (`source: "proxy"`), linked by session, chat and turn. A session's call is also policy-checked here as its owner. To turn the proxy's half off:

```json
{ "proxy": { "sessionCalls": "skip" } }
```

`record` is the default.

## Not done yet

- Limits and pools are not enforced ([POLICY.md](POLICY.md)).
- No translation between dialects: a name served only in the other dialect is refused.
- No cache prices; no cache-affinity routing.
