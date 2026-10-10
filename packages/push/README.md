# @ahpd/push

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fpush)](https://www.npmjs.com/package/@ahpd/push)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Push notifications for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A phone registers its Expo push token once, and hears about a session that needs a person while its app is closed.

It is two halves. A `push:` resource provider keeps the registered devices, and the plugin watches the host's own moments and sends to the devices whose client created or opened the session that started waiting.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/push`](https://github.com/softov/ahpd/tree/main/packages/push).

## In the daemon

```bash
ahpd plugin install @ahpd/push
```

That installs it where the daemon looks for plugins and adds it to `plugins` in the configuration file. A plugin installed with `npm i -g` is not seen.

In the configuration file, with every option set:

```json
{
  "plugins": [
    "@ahpd/agent-claude",
    {
      "name": "@ahpd/push",
      "options": {
        "title": "Build box",
        "accessToken": { "$secret": "host:expo" }
      }
    }
  ]
}
```

## Options

No option is required. A daemon that names none still pushes, titled with its own name and without an access token.

| Option | Default | What it does |
| --- | --- | --- |
| `title` | the daemon's name | What a notification is titled. A blank one falls back to the daemon's name |
| `accessToken` | none | An Expo access token, where the project has push security on. Given here as a `{ "$secret": "<name>" }`, the vault is read at each send rather than at load |

`accessToken` is `writeOnly`, so reading the options back answers `<set>` rather than the token, and `secretAtUse`, so the name in `{ "$secret": ... }` reaches the plugin unresolved and is read with `host.secret` when a send happens. A name the vault does not hold fails that send, with one line in the log and nothing else.

## The `push:` scheme

A device is addressed by its install id, which is the URI path:

| Command | What it does |
| --- | --- |
| `resourceWrite push://devices/<id>` | Registers a device, replacing what the id held |
| `resourceRead push://devices/<id>` | The record, as JSON, without its token |
| `resourceResolve push://devices/<id>` | Its metadata. A device that is not there resolves to the shape of one, so a client can draw the form before it writes |
| `resourceList push://devices` | The registered device ids |
| `resourceDelete push://devices/<id>` | Unregisters. A device that is not there is refused `-32008` |

The body is JSON with a non-empty `token` and a `platform` of `ios` or `android`; `lang` is optional and kept with the device. Anything else is refused `-32602`. A write with `createOnly` against an id that is already there is refused `-32010`, and a URI of another scheme is refused `-32602` rather than read as a path.

`push://` and `push://devices` are directories, and nothing below `push://devices/<id>` names anything.

A registration is gated like any other write, so it needs `file:write`: a guest with read only cannot register. A client finds out whether a host can push from `_meta.ahpd.resourceProviders`, the same way it finds `computer`.

## What a notification says

| | |
| --- | --- |
| Title | The `title` option, or the daemon's name |
| Body | `A session is waiting for your answer`, or `A session is waiting for your approval` for `toolConfirmation` |
| Data | `{ uri: <session>, kind }`, which only the app reads |

A notification never repeats what the session is asking. The text passes through Expo's service and sits on a lock screen, and neither is where a prompt belongs; which session it is travels in `data`, which a client opens.

## Which sessions a device hears

A device hears only about the sessions its own client created or opened, which is the rule the plugin is built around: a device is registered by a connection, the host names the client that created a session and each client that subscribed to one, and a device written by a connection that never introduced itself is kept and sent nothing.

Three more things keep a phone from being woken twice:

- One message per `(session, id)` pair. The protocol's action is an upsert keyed by `id`, so the same entry set again sends nothing; the same `id` from another session is a different pair and sends.
- A session that stops waiting sends nothing. There is no second notification that clears the first, so the pair is forgotten and a session that asks the same thing again is a new wait.
- Nothing is sent for a request that is not a person being asked. `toolClientExecution` is a client running a call that already cleared its gate, so it is not one.

## Where devices are kept

One file, `push-devices.json`, under the daemon's configuration directory, written whole and read when the daemon starts. It is written `0600`, because a push token is a credential to that device's notifications.

A device Expo answers `DeviceNotRegistered` for is removed: the token has been retired, and a message sent there is wasted from then on. The receipts are read at the next send rather than on a timer, so a daemon nobody is waiting on reads nothing.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Writing and loading a plugin, and the events a plugin may watch |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | Running the daemon |

## License

MIT.
