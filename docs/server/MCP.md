# MCP

Point an MCP client, such as VS Code or Claude Code, at this host and it lists and runs the host's tools that need no session. The first tools are the session tools: list the sessions here, start one, message it, read it, rename it and delete it. A client can therefore start a session without being one.

The door is `/mcp`, on the listener that carries the [HTTP API](REMOTE.md#http-api). It takes a person's ahpd token in the `Authorization` header, and nothing else. It is the same code that serves a session's own tools endpoint, so both answer `initialize`, `tools/list` and `tools/call` the same way.

## Turning it on

`mcpTools` says what `/mcp` serves. `none`, the default, answers 404 there, so an install that never asked has no MCP door. `all` serves every sessionless tool the caller's grants allow:

```json
{ "httpApi": true, "mcpTools": "all" }
```

`/mcp` is served on the same listener as `/api`, so `httpApi` has to be on. With `httpApi` off it answers 404 as `/api` does. With `httpApi.port` it moves to the API's own port with `/api`.

## Pointing a client at it

A local daemon answers at `http://127.0.0.1:9187/mcp`. One reached through a tunnel or another machine answers at the name it is reached by, such as `https://ahpd.example.com/mcp`.

In VS Code's `mcp.json`:

```json
{
  "servers": {
    "ahpd": {
      "type": "http",
      "url": "https://ahpd.example.com/mcp",
      "headers": { "Authorization": "Bearer <ahpd token>" }
    }
  }
}
```

In Claude Code:

```bash
claude mcp add --transport http ahpd https://ahpd.example.com/mcp --header "Authorization: Bearer $AHPD_TOKEN"
```

The token is the one `ahpd user token <id>` prints, or one minted with `ahpd token mint`. A token in `?tkn=` is not read: the credential is a header, as the transport's authorization says.

## What it serves

| Tool | Does |
| --- | --- |
| `list_sessions` | The sessions here, filtered by status, agent, title, path, workspace, changes, unread, pull request, created or modified time, newest first, up to `limit` |
| `create_session` | Start a session, owned by the caller |
| `create_chat` | Open another chat in a session |
| `rename_chat` | Rename a chat |
| `send_message` | Send a turn to a session |
| `get_session_context` | Read a session's recent context |
| `delete_session` | Delete a session |

`get_current_session`, `set_workspace` and the artifact tools act on the calling session, so there is no sessionless form of them and `/mcp` does not offer them. Connector actions and a schedule are not served here either.

Each tool checks its own grants, so the list is only what the caller may run. A `member` sees all seven. A role with `mcp:call` and `session:read` only sees `list_sessions` and `get_session_context`, and a call to `create_session` gets `No tool named create_session`.

`create_session` takes an `agent`, a provider id such as `claude-deepseek-build`, and a `config`, the new session's settings checked against that agent's schema. Both are optional. See [Tools](../sdk/TOOLS.md#tools-that-need-no-session).

A session made here belongs to the caller and has no parent. Its turns are the caller's, so the caller's grants follow them.

## Who may call

The door asks for `mcp:call`. It is in `member`, and `admin` holds it through everything. `guest` does not hold it. A token that reaches the door sees only the tools its other grants allow, because the door and each tool are two checks. The door charges nothing, so a person in no team is not refused.

| Token | Answer |
| --- | --- |
| The deployment token | Root: every sessionless tool |
| A person's token holding `mcp:call` | The tools their grants allow |
| A person's token without it | 403 |
| A team's key | 403: a team key opens the proxy and nothing else |
| A session's own token | 401: a session has its own tools endpoint |
| No token, or one this host does not know | 401 |

Each 401 carries `WWW-Authenticate: Bearer realm="ahpd"`, with `error="invalid_token"` when a token came that the door does not take.

OAuth is not served yet. A client that asks for it is told to use a bearer token.

## What it does not do

Nothing is kept between requests. Each request names its caller again, so a token taken away stops the next call. The list a person sees is built for that request, from the grants they hold then.

No stream is opened. A `GET` answers 405, and a client finds a changed list on its next `tools/list`. That is enough for a client that re-lists when it needs to, and it is all a door with no state can promise.

## A session's own server

Each session is offered its own endpoint at `/ahp-mcp/<uuid>`, with a token only that session holds. It serves the host's tools and the backend's client tools, and it stops answering when the session does. `/mcp` is for a person, and does not serve client tools. The two share one answer, so a session's endpoint answers exactly as it did before `/mcp` existed.
