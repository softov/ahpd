# Upgrade

```bash
ahpd update
```

`ahpd update` installs the newest `@ahpd/server` where this one is installed. It moves every plugin to the new `@ahpd/sdk` and starts the daemon again. It refuses before it installs anything when the result would be a daemon that cannot start, or a plugin that cannot load.

What a release changes, and what to do before you take it, is in its *Upgrading* section in [the release notes](../updates/archive.md).

| Flag | Does |
| --- | --- |
| `--check` | Say the running and the latest version, and whether the update may run. Installs nothing |
| `--version 0.13.0` | Install that version instead of npm's latest. It has to be newer than the running one |
| `--force` | Update while a turn runs, and go on when a plugin has no version for the new sdk |

## What it does

1. npm installs `@ahpd/server@<version>` where this ahpd already is. A global install is `-g --prefix <prefix>`, and a project folder is `--prefix <folder>`.
2. Each plugin in the plugin root moves to the newest version whose `@ahpd/sdk` range admits the new daemon.
3. The new binary is asked whether it takes the recorded flags, then the daemon restarts as `ahpd restart` does: 3 seconds after the answer, or, when a turn began while npm ran, once the turns end, which the answer says.

## Refusals

Each of these is refused before anything is installed:

- a checkout or a linked package, because npm did not put that folder there
- a daemon in the foreground, which cannot start itself again
- a running turn, unless `--force`: npm replaces the files of the daemon that runs it
- a plugin with no version that admits the new sdk, unless `--force`
- a version that is not newer than the running one, since that is not an update

The answer names the refusal, and the daemon keeps running. `--check` answers the same refusals as `why`, beside `may: false`.

In a container, a newer version is a newer image, and the entrypoint moves the plugins when the image's version differs from the volume's. An image older than the volume is refused before the daemon runs, because the plugins there follow a newer sdk. Set `AHPD_ALLOW_DOWNGRADE=1` to start it anyway, and expect a plugin to fail to load. See [Docker](DOCKER.md#rollback).

## HTTP and AHP

An update replaces the code the daemon runs. Over HTTP and AHP it is the deployment's own token and never a person. A person's token is refused with 403, and a person's AHP call with `-32009`.

```bash
curl http://127.0.0.1:9187/api/update \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"check": true}'
```

`x-ahpd/update` takes the same three fields: `version`, `check` and `force`.

## Windows

Windows locks the native module the daemon runs, so npm cannot replace it while the daemon is up. `ahpd update` answers, stops the daemon 3 seconds later, and a helper outside the install does the rest. The helper waits for the daemon to go, runs npm, moves the plugins and starts the daemon with the recorded flags. Each step goes to `daemon.log`. A failed npm starts the old version again.

## By hand

An install the update refuses can still be upgraded by hand:

```bash
npm i -g @ahpd/server
ahpd plugin update all
ahpd restart
```

`plugin update all` moves each plugin to its newest version that fits the new daemon. See [Plugins](PLUGINS.md#update).

npm alone moves no plugin. A plugin from an older release that the new daemon cannot load raises an error alert, and the daemon starts without it. With no agent plugin loaded, it serves no session until one is. A client moves a plugin with `x-ahpd/plugins/update`.

::: warning From 0.12
0.12 has no `ahpd update`. Update it by hand as above, and run `ahpd plugin update all` before `ahpd restart`.
:::

::: warning From 0.6
0.6 had Claude built in, so an old `config.json` names no plugin. Run `ahpd plugin install @ahpd/agent-claude` once after the upgrade.
:::

## Renamed keys

`http` is now `httpApi`, and `proxy` is now `modelProxy`. A file written with the old names still starts, and the daemon prints one warning for each:

```
http is now httpApi; rename it in /home/you/.config/ahpd/config.json.
proxy is now modelProxy; rename it in /home/you/.config/ahpd/config.json.
```

Rename the keys in `config.json` to stop the warnings. A file that holds both names of one key is refused, because the two name the same setting.

The `proxy` grant, the `proxy:call` operation and the `proxy` match type of a policy keep their names.

## Update check

The daemon asks npm every six hours if a newer `@ahpd/server` exists. `ahpd start` and `ahpd status` then say so:

```
update: @ahpd/server 0.6.0 is on npm, this is 0.5.0
```

The request runs in the background and never blocks a start. It uses `npm_config_registry` when it is set.

| Turn it off with | |
| --- | --- |
| `"updateCheck": false` | in `config.json` |
| `--no-update-check` | for one run |
| `NO_UPDATE_NOTIFIER` or `CI` | set to anything in the environment |
