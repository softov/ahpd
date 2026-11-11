# @ahpd/push

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fpush)](https://www.npmjs.com/package/@ahpd/push)
[![CI](https://github.com/ahpio/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/ahpio/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 1.0.0](https://img.shields.io/badge/AHP-1.0.0-0b7285)

Push notifications for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A phone registers its Expo push token, or a browser registers its Web Push subscription. Each hears about a session that needs a person while the app or the tab is closed.

It is two halves. A `push:` resource provider keeps the registered devices. The plugin is VS Code's sessions window notifier, carried to a phone or a browser: a client of the daemon that holds its session list and tells a person's devices when one of their sessions needs them, completes or fails.

Part of [ahpd](https://github.com/ahpio/ahpd). The source is in [`packages/push`](https://github.com/ahpio/ahpd/tree/main/packages/push).

## Install

```bash
ahpd plugin install @ahpd/push
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/ahpio/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

In the configuration file, with every option set:

```json
{
  "plugins": [
    "@ahpd/agent-claude",
    {
      "name": "@ahpd/push",
      "grants": ["session:list"],
      "options": {
        "accessToken": { "$secret": "host:expo" }
      }
    }
  ]
}
```

No option is required. A daemon that names none still pushes, without an access token.

On a daemon where people sign in, the plugin's entry grants `session:list`, which is how the plugin reads the sessions the daemon already holds when it starts. Without it, the plugin says once in the log that the list could not be read, and tells only the sessions made after the daemon started. A daemon where nobody signs in gates nothing, and needs no grant.

| Option | Default | What it does |
| --- | --- | --- |
| `accessToken` | none | An Expo access token, where the project has push security on. Given here as a `{ "$secret": "<name>" }`, the vault is read at each send rather than at load |
| `webPushHosts` | `*.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com` | The hosts a browser's endpoint may be at. A pattern of `*.<domain>` matches every host under that domain. An endpoint at another host is refused at the write |
| `contact` | none | A `mailto:` or `https:` URI sent as the VAPID `sub` claim, which a push service may use to contact the operator |

`accessToken` is `writeOnly`, so reading the options back answers `<set>` rather than the token, and `secretAtUse`, so the name in `{ "$secret": ... }` reaches the plugin unresolved and is read with `host.secret` when a send happens. A name the vault does not hold fails that send, with one line in the log and nothing else.

`webPushHosts` is checked when a browser registers, not at each send. The default list is the push services of Safari, Chrome, Firefox and Edge. A browser whose endpoint is elsewhere is refused. The endpoint comes from the client, and an open list would let it aim the host at any address.

`contact` is sent on every request when it is given. Apple's push service may insist on a `sub` claim, so a host that pushes to Safari should set one.

## The `push:` scheme

A device is addressed by its install id, which is the URI path:

| Command | What it does |
| --- | --- |
| `resourceWrite push://devices/<id>` | Registers a device, replacing what the id held |
| `resourceRead push://devices/<id>` | The record, as JSON, without its credential: no token, and for a browser no endpoint or keys |
| `resourceResolve push://devices/<id>` | Its size and its `etag`. A device that is not there is refused `-32008`. No `mtime` or `ctime` is answered, because the file keeps no times |
| `resourceList push://devices` | The registered device ids |
| `resourceDelete push://devices/<id>` | Unregisters. A device that is not there is refused `-32008` |

The body is JSON. A phone has a non-empty `token` and a `platform` of `ios` or `android`. A browser has `platform: "web"`, an `endpoint` and `keys: { p256dh, auth }`, which are the fields of a subscription's `toJSON()`. `lang` is optional, a BCP 47 tag such as `pt-BR` that the device's notifications are worded in. `audience` is optional, `person` or `device`, which sessions the device hears about. A body that is neither is refused `-32602`. The person a device belongs to is the one the writing connection is signed in as, and its client the id that connection gave at `initialize`; the body names neither.

A browser's `endpoint` must be an `https:` URL on a host that `webPushHosts` allows. A write with another endpoint is refused `-32602`. The endpoint and the keys are never read back, because an endpoint is a capability URL to the device. A write with `createOnly` against an id that is already there is refused `-32010`. A write whose `ifMatch` is not the device's `etag` is refused `-32011`, and so is one with an `ifMatch` naming an id that is not there. A URI of another scheme is refused `-32602`.

`push://` and `push://devices` are directories, and nothing below `push://devices/<id>` names anything. A write or a delete of either is refused `-32009`.

### `push://vapid`

`push://vapid` is one read-only record, `{ "publicKey": "<base64url>" }`. It is the host's VAPID public key, which a browser passes as `applicationServerKey` when it subscribes. The key pair is made at the first load and kept in `push-vapid.json`, written `0600`. A host with no pair refuses the read `-32008`, and a write or delete against it is refused `-32009`.

A registration is gated like any other write, so it needs `file:write`: a guest with read only cannot register. A client finds out whether a host can push from `_meta.ahpd.resourceProviders`, the same way it finds `computer`.

## What a notification says

The words are those of VS Code's sessions window notifier, in the language the device registered with: Portuguese and Spanish from the plugin's catalogs, and English otherwise.

| | |
| --- | --- |
| Title | `Session: <title>`, the session's title, or `Session` and the first eight characters of its id when it has none |
| Body | `Attention needed.` when it needs a person, `Session completed.` when it completes, `Session failed.` when it fails; `Attention needed in <workspace>.`, `Completed in <workspace>.` or `Failed in <workspace>.` when it has a workspace, its project's name or its first folder's |
| Data | `{ uri: <session>, kind }`, which the app reads to open the session. `kind` is VS Code's notification kind: `needsInput`, or `idle` for a session that completed or failed |

A notification never repeats what the session is asking. The text passes through Expo's service or a browser's push service, and sits on a lock screen. A prompt belongs in neither.

## When a session is told

The plugin watches each session's status as VS Code's sessions window reads it: needing input over running over failed, and completed for anything else. Waiting on a client running a tool is not needing input, because the daemon's status leaves it out.

- A move into needing input or into failure is told at once.
- A move into completed is told a second and a half later, and only if the session is still completed then. A queued turn that starts in between is told nothing.
- Any move drops a completed notice still to come.
- The status a session is listed or added at is where it starts, and is not told. A second request while a session already needs input is not a move, and sends nothing.

## Which devices are told

Each device chooses with its `audience`. A `person` device, which is one that says nothing, hears every session of its person, as VS Code's window tells its user: on a daemon where people sign in, the sessions whose owner registered it, and on a daemon where nobody signs in, every session, its one person's. A `device` device hears only the sessions its own client created or opened. Every device also hears the sessions its own client created or opened, whoever's they are.

## How a notification is sent

A phone's notification goes to Expo's push service, a hundred messages to a request. A request that fails on the network, or that Expo answers with a 429 or a 5xx, is sent again after one second and then after two more, as Expo asks a sender to back off; one still failing then is a line in the daemon's log. Expo answers a ticket for each message, and the plugin reads the tickets' receipts fifteen minutes after the send, as Expo recommends. A ticket with no receipt by then is a line in the log too. A daemon that stops within those fifteen minutes reads none of that send's receipts.

A browser's notification is one request to its push service, which keeps the message for four weeks while the browser is not connected, the web-push library's default.

## Where devices are kept

One file, `push-devices.json`, under the daemon's configuration directory, written whole and read when the daemon starts. It is written `0600`, because a push token or a subscription is a credential to that device's notifications.

The VAPID pair is in `push-vapid.json`, beside it, and written the same way. A host that loses that file makes a new pair, and every subscription made with the old key fails until each browser subscribes again.

A device Expo answers `DeviceNotRegistered` for, in a ticket or a receipt, is removed: the token has been retired, and a message sent there is wasted from then on.

A browser's push service answers 404 or 410 for an endpoint it no longer knows. That device is removed too: the subscription is gone, and the browser has to subscribe again.

A push service sees which host talks to which browser, and when. The message is sealed for the browser, but the traffic is not hidden from the service that carries it.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/ahpio/ahpd/blob/main/docs/plugins/PLUGINS.md) | Writing and loading a plugin, and the events a plugin may watch |
| [GET-STARTED.md](https://github.com/ahpio/ahpd/blob/main/docs/server/GET-STARTED.md) | Running the daemon |

## License

MIT.
