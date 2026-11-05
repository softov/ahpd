# Remote access

## The connection token

Every client presents the token to connect. Set it one of three ways:

| Flag | Key | Does |
| --- | --- | --- |
| `--connection-token-file <path>` | `connectionTokenFile` | Read the token from the file. Writes a new one, mode 0600, if it is missing |
| `--connection-token <secret>` | `connectionToken` | Use this token |
| `--without-connection-token` | `withoutConnectionToken` | Accept any connection |

With none of them, the host accepts loopback only.

## Listen on the network

```bash
ahpd start --host 0.0.0.0 --connection-token-file ~/.config/ahpd/connection-token
```

::: danger
`--host 0.0.0.0` refuses to start without a token. A client with the token can run anything the agents can run on this machine.
:::

| To reach it as | Add |
| --- | --- |
| Another IP or name, such as `http://203.0.113.5:9187` | `--origin http://203.0.113.5:9187` (key `origins`, a list) |
| An https name for sign-in | `--resource https://ahpd.example.com/` |
| A public URL with no open port | the [`@ahpd/tunnel-devtunnel`](../plugins/tunnel-devtunnel.md) plugin |

For a person's own token instead of the shared one, see [Users](USERS.md).

## Test a token

A plain `GET /?tkn=<token>` on the daemon's port tells a client whether the host accepts the token.
A refused token gets 401 with `A connection token is required`, the same sentence the WebSocket handshake gives, and the bearer challenge in `WWW-Authenticate`: `Bearer realm="ahpd"`, with `error="invalid_token"` when a token came.
An accepted token gets 426, because the port speaks AHP over WebSocket.
A host with no token answers 426 to every request.

```bash
curl -i "http://127.0.0.1:9187/?tkn=$(cat ~/.config/ahpd/connection-token)"
```

Both answers carry `Access-Control-Allow-Origin: *`, so a page on any origin can read them.
From a browser, put the token in `?tkn=` and not in a header, so the request needs no preflight.
`/api` and `/v1` keep their own answers and their `origins` check.

## HTTP API

Turn it on to run the `ahpd` commands over HTTP:

::: code-group

```json [Same port]
{ "httpApi": true }
```

```json [Own port]
{ "httpApi": { "port": 9188, "host": "127.0.0.1" } }
```

:::

With `true` the API is at `http://127.0.0.1:9187/api`, beside the WebSocket. The startup log says where: `http on http://127.0.0.1:9187/api`. It needs a connection token or a user directory.

```bash
curl http://127.0.0.1:9187/api/status -H "Authorization: Bearer $TOKEN"
```

A refusal says why:

```
HTTP/1.1 403 Forbidden
{ "message": "ada may not config:read here" }
```

`GET /api/cli-manifest` lists every command, with no token. The [model proxy](PROXY.md) is served at `/v1` while `modelApi` is on.

### Who may run what

The deployment's connection token may run everything. A person's token needs the grant:

| Command | Needs |
| --- | --- |
| `status` | `config:read` |
| `plugin list` | `plugin:list` |
| `config` | `config:write` |
| `user list` | `user:read`, `role:read` |
| `user add`, `user rm`, `user token`, `user member` | `user:write` |
| `token mint`, `token list`, `token rm` | their own; `user:write` and that person's grants for another's |
| `team list` / `team add`, `team rm` | `team:read` / `team:write` |
| `project list` / `project add`, `project rm` | `project:read` / `project:write` |
| `usage` | own pools; any pool with `usage:read` |
| `vault list` | `config:read` for `host:`; `team:write` for the team's; own |
| `vault set`, `vault delete` | `config:write` for `host:`; `team:write` for the team's; own |
| `automation export` / `automation import` | `automation:list` / `automation:create` |
| `plugin config`, `plugin enable`, `plugin disable` | `plugin:options`, `plugin:enable`, `plugin:disable` |
| `plugin install`, `plugin remove` | `plugin:install` |
| `plugin update`, `ahpd restart`, and `ahpd update` | deployment token only |

One thing a remote client reads is not a command and so has no row here: the account each agent bills to, which is a value of the root config rather than an `ahpd` verb, needs `account:read` and is shown to nobody else - [HOST.md](../sdk/HOST.md#grants) has that row.

### Browser safety

A request must have one of the daemon's own names as its `Host`, and the same for its `Origin` when a browser sends one. The names are the loopback names, the bound address, the `resource` host and each entry in `origins`. A body must be `application/json`; anything else gets 415.

## Run commands from another machine

```bash
ahpd --remote http://203.0.113.5:9187 --token "$TOKEN" status
ahpd --remote http://203.0.113.5:9187 --token-file ~/token plugin list
AHPD_TOKEN="$TOKEN" ahpd --remote http://203.0.113.5:9187 restart
```

The remote daemon must have the HTTP API on. Help, completion and `--json` work as at its own terminal. `start` and `stop` stay local.

The command list is cached in `~/.cache/ahpd/remote`. `--refresh` fetches it again.

::: warning
Plain `http://` to a host that is not loopback sends the token in the clear. Use `https://` or a tunnel.
:::
