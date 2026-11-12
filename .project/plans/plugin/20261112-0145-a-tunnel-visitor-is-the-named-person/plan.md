---
title: A tunnel visitor is the person the tunnel names
domain: plugin
status: planned
priority: high
created: 2026-11-12
revalidated: 2026-11-12
requires:
  - plans/plugin/20261112-0145-a-port-with-another-protocol-is-replaced/plan.md
refs:
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L39-L99](../../../../packages/tunnel-devtunnel/src/forward.ts#L39-L99) - the hop: a listener on 31546 that sets the daemon's token on every request"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L218-L224](../../../../packages/tunnel-devtunnel/src/kind.ts#L218-L224) - `hopFor` starts the hop when the daemon is not on 31546"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L54-L79](../../../../packages/tunnel-devtunnel/src/kind.ts#L54-L79) - the tunnel record's schema, where the person setting goes"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L341-L345](../../../../packages/tunnel-devtunnel/src/service.ts#L341-L345) - `relay` makes the `TunnelRelayTunnelHost`"
  - "[code://packages/sdk/src/listen.ts#L152-L190](../../../../packages/sdk/src/listen.ts#L152-L190) - `doorOf`: the deployment token is root, and `identify` names a person"
  - "[code://packages/server/src/commands/run.ts#L743-L760](../../../../packages/server/src/commands/run.ts#L743-L760) - the daemon wires `identify` to the users directory"
  - "[code://packages/sdk/src/types/plugin.ts#L960](../../../../packages/sdk/src/types/plugin.ts#L960) - `PluginHost`, where the plugin asks for a key"
  - "[code://packages/sdk/src/types/users.ts#L42-L62](../../../../packages/sdk/src/types/users.ts#L42-L62) - `Principal`"
  - npm://@microsoft/dev-tunnels-connections@1.3.61 - `forwardConnectionsToLocalPorts` and `forwardedPortConnecting` on `TunnelRelayTunnelHost`
  - git://6616d1537 - the last commit that holds the problem file this plan replaces, `problems/the-tunnel-hop-hands-every-caller-the-root-token.md`
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/control_server.rs#L214-L215 - VS Code's CLI takes the agent host port with `add_port_direct`, with no local listener
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/agent_host.rs#L1547-L1553 - VS Code's CLI sets `?tkn=` on each request that comes through the tunnel
---

## Goal

Today the tunnel hop listens on `127.0.0.1:31546` and sets the daemon's root token on every request.
A local process, a web page and every tunnel visitor get root, and anyone does when the tunnel is anonymous.
After this plan, no local port listens for the tunnel, as with VS Code's CLI.
A visitor who presents the tunnel's derived token gets the grants of the person the tunnel names.
A visitor with their own token keeps it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "forward\(" packages/tunnel-devtunnel/src` - one caller, `hopFor` in `kind.ts`.
- `rg "forwardConnectionsToLocalPorts|forwardedPortConnecting" node_modules/@microsoft/dev-tunnels-connections` - the host SDK can hand each connection to the process as a stream.
- `rg "add_port_direct" cli/src` in VS Code at `1564f100807a` - the agent host port takes streams in the CLI's own process.
- Softov reproduced the root admission on 2026-11-11, on a tunnel with `anonymous: true`.

### Runtime path

```
tunnel relay -> forwardedPortConnecting stream -> request rewrite (derived token -> person key) -> loopback dial to the daemon -> doorOf -> identify -> Principal
```

### Gaps

- The SDK has no way for a plugin to admit a connection as a named person.
- A tunnel record names no person.
- The relay host forwards to local TCP ports, so the hop needs a listener.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A visitor who presents the derived token gets the grants of a person the tunnel names | Softov, 2026-11-08, in the problem file | 02, 03 |
| The setting names the person as `user:<id>` | Softov, 2026-11-08, in the problem file | 02 |
| No local port listens: the tunnel's streams come into the daemon's process, as VS Code's CLI | Softov, 2026-11-11: "No local port, plus a person" | 03 |
| The stream is admitted as the person with a key held only in memory, which the plugin sets on its loopback dial | Softov, 2026-11-11: "A key held only in memory" | 01, 03 |
| Any other `tkn` or `Authorization` passes through unchanged | Softov, 2026-11-08, in the problem file | 03 |
| On a host with users and no person set, the derived token is refused | Softov, 2026-11-08, in the problem file | 03 |
| On a host with no users, the derived token gets the daemon's token, as today and as VS Code's CLI | (defaulted: the operator is the host's one person) | 03 |
| A port on the tunnel other than 31546 is piped to its local port unchanged | (defaulted: only the agent host port carries tokens) | 03 |
| No `Origin` check on the WebSocket upgrade | Softov, 2026-11-08: "skip this one for now" | - |

## Proposed architecture

- **Data flow** - the relay host runs with `forwardConnectionsToLocalPorts` off. Each `forwardedPortConnecting` stream on 31546 is read as HTTP. The request's `tkn` is swapped when it equals the derived token, and the request goes to the daemon over a loopback dial.
- **State flow** - the person key lives in the daemon's memory for the plugin's lifetime. It is never written, logged or sent anywhere but the loopback dial. An unload drops it.
- **Layer responsibilities** - sdk: a `PluginHost` call that answers a person's key. · server: the key map in `identify`. · tunnel-devtunnel: the person setting, the stream handler, and no listener.
- **Source-of-truth files** - [`code://packages/sdk/src/listen.ts`](../../../../packages/sdk/src/listen.ts), [`code://packages/tunnel-devtunnel/src/forward.ts`](../../../../packages/tunnel-devtunnel/src/forward.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin admits a person by a key in memory](task-01-a-plugin-admits-a-person-by-a-key.md) | todo | - |
| [02 - A tunnel record names a person](task-02-a-tunnel-record-names-a-person.md) | todo | - |
| [03 - Tunnel streams come into the process](task-03-tunnel-streams-come-into-the-process.md) | todo | 01, 02 |
| [04 - The docs say who a visitor is](task-04-the-docs-say-who-a-visitor-is.md) | todo | 03 |

## Risks and tradeoffs

- The key is a bearer secret on a loopback dial. Only the daemon's own process holds it.
- No port listens for the tunnel, so another process can present the key only if it reads the daemon's memory.
- A host with users and no person set refuses VS Code over a tunnel until an admin names one. The tunnel's alert says so.
- `forwardConnectionsToLocalPorts` is off for the whole relay host, so every port on the tunnel needs a stream handler. Ports other than 31546 get a plain pipe.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-plugin-admits-a-person-by-a-key.md](task-01-a-plugin-admits-a-person-by-a-key.md), on a branch from plugin/20261112-0145-a-port-with-another-protocol-is-replaced.
- **Open questions:** none.
- **Watch out for:** the daemon runs on Node, Bun and Deno. The loopback dial works on all three; a stream handed to the server itself works on Node alone.

## Final verification checklist

- [ ] No process listens on 31546 while the system tunnel runs and the daemon is on another port (`ss -ltnp`).
- [ ] A request with the derived token is admitted as the named person, and a request with a person's own token as that person.
- [ ] A host with users and no person refuses the derived token, and the tunnel raises an alert.
- [ ] `pnpm typecheck` passes, and the sdk, server and tunnel-devtunnel suites pass, named with their counts.
