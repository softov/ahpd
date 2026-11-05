# @ahpd/push

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fpush)](https://www.npmjs.com/package/@ahpd/push)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Push notifications for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A phone registers its Expo push token, or a browser registers its Web Push subscription. Each hears about a session that needs a person while the app or the tab is closed.

It is two halves. A `push:` resource provider keeps the registered devices. The plugin watches the host's own moments, and sends to the devices that should hear about the session that started waiting or finished a turn.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/push`](https://github.com/softov/ahpd/tree/main/packages/push).

## Install

```bash
ahpd plugin install @ahpd/push
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

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

No option is required. A daemon that names none still pushes, titled with its own name and without an access token.

| Option | Default | What it does |
| --- | --- | --- |
| `title` | the daemon's name | What a notification is titled. A blank one falls back to the daemon's name |
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

The body is JSON. A phone has a non-empty `token` and a `platform` of `ios` or `android`. A browser has `platform: "web"`, an `endpoint` and `keys: { p256dh, auth }`, which are the fields of a subscription's `toJSON()`. `lang` is optional and kept with the device. `audience` is optional on every platform. Anything else is refused `-32602`.

A browser's `endpoint` must be an `https:` URL on a host that `webPushHosts` allows. A write with another endpoint is refused `-32602`. The endpoint and the keys are never read back, because an endpoint is a capability URL to the device. A write with `createOnly` against an id that is already there is refused `-32010`. A write whose `ifMatch` is not the device's `etag` is refused `-32011`, and so is one with an `ifMatch` naming an id that is not there. A URI of another scheme is refused `-32602`.

`push://` and `push://devices` are directories, and nothing below `push://devices/<id>` names anything. A write or a delete of either is refused `-32009`.

### `push://vapid`

`push://vapid` is one read-only record, `{ "publicKey": "<base64url>" }`. It is the host's VAPID public key, which a browser passes as `applicationServerKey` when it subscribes. The key pair is made at the first load and kept in `push-vapid.json`, written `0600`. A host with no pair refuses the read `-32008`, and a write or delete against it is refused `-32009`.

A registration is gated like any other write, so it needs `file:write`: a guest with read only cannot register. A client finds out whether a host can push from `_meta.ahpd.resourceProviders`, the same way it finds `computer`.

## What a notification says

| | |
| --- | --- |
| Title | The `title` option, or the daemon's name |
| Body | `A session is waiting for your answer`, or `A session is waiting for your approval` for `toolConfirmation`, or `A session finished` when the session's own chat completes a turn |
| Data | `{ uri: <session>, kind }`, which only the app reads. `kind` is the request's kind, or `turnComplete` |

A notification never repeats what the session is asking. The text passes through Expo's service or a browser's push service, and sits on a lock screen. A prompt belongs in neither. Which session it is travels in `data`, which a client opens.

## Which sessions a device hears

A device has an `audience`, which is which sessions it hears about.

- `person` is the default. The device hears every session its person owns, and every session its own client created or opened.
- `device` is only the sessions its own client created or opened.

A device keeps as its `owner` the person who wrote it. A device with no owner has nobody to match, so it keeps the `device` rule. The host names the client that created a session and each client that subscribed to one. A device written by a connection that never introduced itself is kept and sent nothing.

Three more things keep a device from being woken twice:

- One message per `(session, id)` pair. The protocol's action is an upsert keyed by `id`, so the same entry set again sends nothing; the same `id` from another session is a different pair and sends.
- A session that stops waiting sends nothing. There is no second notification that clears the first, so the pair is forgotten and a session that asks the same thing again is a new wait.
- A turn that was stopped sends nothing, and neither does a turn of a worker's chat. A worker finishes its own turns inside one of the session's.
- Nothing is sent for a request that is not a person being asked. `toolClientExecution` is a client running a call that already cleared its gate, so it is not one.

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
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/PLUGINS.md) | Writing and loading a plugin, and the events a plugin may watch |
| [GET-STARTED.md](https://github.com/softov/ahpd/blob/main/docs/server/GET-STARTED.md) | Running the daemon |

## License

MIT.
