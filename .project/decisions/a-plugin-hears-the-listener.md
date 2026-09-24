---
title: A plugin hears the daemon's socket open and close, and may add a line to what the daemon announces
status: accepted
date: 2026-09-24
refs:
  - code://packages/sdk/src/types/events.ts - `ListeningEvent` and `StoppingEvent`, the two names this adds
  - code://packages/sdk/src/types/plugin.ts - `PluginContext.say`, beside the `log` it is not
  - code://packages/sdk/src/plugins.ts - `raise`, the one implementation both the host and the daemon call
  - code://packages/server/src/main.ts - where the daemon raises them, and where the collected lines are written
  - code://.project/decisions/plugin-events-are-observed-not-answered.md - the rule these two events keep
  - code://.project/decisions/plugin-registration-kinds.md - the closed set these are not a new member of
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/tunnelAgentHost.ts - the discovery convention that needs the bound port
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/tunnelAgentHostConnector.ts#L110-L130 - `deriveConnectionToken`, why `guarded` is on the event
---

## Context

A Dev Tunnel forwards a fixed port to a host and a client opens it by a convention VS Code defines, so something has to stand up a forward to whatever port the daemon bound, after it is bound and before anybody is told the daemon is ready.
Nothing in the plugin surface could do it.
Every `PortKey` is something a *session* touches - resources, terminals, changes, worktrees, computers - and the listener is not one of them: `createHost` answers connections and never opens one, and `listen` is the daemon's, called after `createHost` with the folded options already in hand.
So a tunnel had two places it could live, and neither was good.
Inside the daemon it would put a Microsoft .NET CLI into the knowledge of every host that will never run one.
As a new port it would invent a `set` kind, with one conflict rule and one `replace` word, for a thing that replaces nothing.

The timing is the other half.
A tunnel takes seconds to make, and the address it produces belongs in what `ahpd status` reads - which is stdout, parsed by `recordOf`, and not the stderr log a plugin already had through `log`.
A URL printed before the tunnel works is a URL somebody pastes into a client that then cannot reach it.

## Decision

Two event names, `listening` and `stopping`, and one more thing a plugin may write.

`listening` carries the `Listener` the daemon got back: `runtime`, `host`, `port` and `guarded`.
It is raised by the daemon rather than by `createHost`, because the socket is the daemon's, and it is raised before anything is announced.
`stopping` carries nothing and is raised before `listener.close()`, so what went up at `listening` comes down while there is still a port to name.
Neither is raised over stdio, where there is no address for anybody to reach.

`PluginContext.say(line)` puts one line into what the daemon announces, after the daemon's own and in plugin order.
It is not `log`: `log` is stderr for a person, `say` is stdout for `ahpd status`.
Lines are collected while `listening` is handled and written once, and a line offered after the announcement is dropped rather than printed on its own - a late line on stdout is a line `recordOf` would read as part of an announcement it has already parsed.

`raise(handlers, event, onProblem)` moves to the SDK and both callers use it, so the daemon's two events reach a plugin under exactly the rules `plugin-events-are-observed-not-answered` describes: registration order, each handler awaited, a handler that throws reported against its plugin and the rest carrying on, whatever a handler returns ignored.
It keys on `event.type`, which the host's own `fire` used to pass again as a separate argument.

`guarded` is on the event because of what the convention does with tokens.
A client connecting over a tunnel derives its connection token from the tunnel's id and presents that; it asks nobody and reads nothing off the tunnel.
So a daemon with a connection token of its own refuses exactly the client a tunnel exists to admit, and a plugin that cannot see `guarded` cannot say so.

## Consequences

A tunnel is `@ahpd/tunnel-devtunnel`, installed by the people who want one and invisible to everybody else, and the daemon keeps knowing nothing about `devtunnel`.
The seam is not about tunnels: ngrok, Cloudflare, an mDNS announcement and a reverse proxy registration are the same two moments and the same line.

`ahpd start` now waits for `listening` handlers before it announces.
That is the intended order and it is also a way for a slow plugin to make the daemon look slow, which is the cost awaiting already has everywhere else in `on`.

`stopping` is on the shutdown path, so a handler that hangs is a daemon that will not stop.
The signal handler is guarded against running twice, because both `SIGINT` and `SIGTERM` are wired and `ahpd stop` sends one to a daemon somebody may also be holding a terminal on.

`say` is optional on the loader's options and required on `PluginContext`: only the daemon has an announcement, and a loader in a test has nothing for a line to go into.
The default drops what it is given rather than making every caller invent a sink.

Two event names is two more rows in a union the decision above says is the contract, so adding them is a change to `@ahpd/sdk` and not a discovery.

## Options

- **A `registerTunnel` port, or a `transport` registration kind.**
  Rejected: it is a `set` kind with a conflict rule and a `replace` word for something that replaces nothing, and the listener is not a port a session reaches through.
- **`devtunnel` inside `packages/server`, as `ahpd tunnel`.**
  Rejected: it puts a .NET CLI into every install for a feature most of them will never use, and the subcommand was the weaker half of the argument for it - `ahpd status` reading a plugin's line answers the same need.
- **Let a handler return the line it wants announced.**
  Rejected: `plugin-events-are-observed-not-answered` says a return value is ignored, and one event where it is not is the beginning of the waterfall that decision refuses.
- **Announce first, raise `listening` after.**
  Rejected: it prints a local address and a tunnel address seconds apart, and `recordOf` reads the announcement once.
- **Let the plugin write to stdout itself.**
  Rejected: the announcement is a block `daemon.ts` parses, and a second writer means a plugin deciding where in it its line lands.
