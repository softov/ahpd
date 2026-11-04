# Connect a client

A client needs the host's address and its token.

```bash
ahpd status                              # the address
cat ~/.config/ahpd/connection-token      # the token
```

| Client | What it is |
| --- | --- |
| [ahpw](https://github.com/ahpio/ahpw) | A web UI, as a plugin of the host or on its own |
| VS Code | The Chat view, through its remote agent hosts |
| [ahpc](https://github.com/softov/ahpc) | A terminal UI and CLI |

::: code-group

```bash [ahpw in the host]
ahpd plugin install @ahpd/web
ahpd restart
# open http://127.0.0.1:9187/plugins/web/ and sign in with the token
```

```bash [ahpw on its own]
npx @ahpd/web serve --connect ws://127.0.0.1:9187 --token-file ~/.config/ahpd/connection-token
# open http://127.0.0.1:5190/
```

```json [VS Code settings.json]
"chat.remoteAgentHostsEnabled": true,
"chat.remoteAgentHosts": [
  { "name": "ahpd", "address": "ws://127.0.0.1:9187", "connectionToken": "<token>" }
]
```

```bash [ahpc]
npm i -g @softov/ahpc
ahpc --host ws://127.0.0.1:9187 --token <token>
```

:::

In VS Code, `address` may be `127.0.0.1:9187` or a full `ws://` or `wss://` URL. A host on loopback with no token needs no `connectionToken`.

## How the token is sent

| Form | Example |
| --- | --- |
| On the URL | `ws://127.0.0.1:9187/?tkn=<token>` |
| As a header | `Authorization: Bearer <token>` |

A browser cannot set headers on a WebSocket, so it uses the URL form.

## Give someone their own access

With a [user directory](USERS.md), each person gets their own token:

```bash
ahpd user add ana --role member
ahpd user token ana --url
```

The URL is shown once. Send it to them; they paste it as the address.
