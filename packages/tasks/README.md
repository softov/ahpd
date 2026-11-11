# @ahpd/tasks

[![npm](https://img.shields.io/npm/v/%40ahpd%2Ftasks)](https://www.npmjs.com/package/@ahpd/tasks)
[![CI](https://github.com/ahpio/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/ahpio/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A tasks plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. The host keeps one list of tasks and plans for every agent and person, and offers host tools so a Claude, a pi or a cofold session reads and writes the same list.

Part of [ahpd](https://github.com/ahpio/ahpd). The source is in [`packages/tasks`](https://github.com/ahpio/ahpd/tree/main/packages/tasks).

## Install

```bash
ahpd plugin install @ahpd/tasks
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/ahpio/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

In the configuration file, with every option set:

```json
{ "plugins": [{ "name": "@ahpd/tasks", "options": { "requireApproval": true, "sweepAfterDays": 30 } }] }
```

| Option | Default | What it does |
| --- | --- | --- |
| `requireApproval` | `false` | Whether an agent may set a task to `doing` before somebody approved it |
| `sweepAfterDays` | absent | How many days a `done` or `dropped` plan is kept, with the tasks that name it; absent keeps it forever |

A task is a record of the `tasks` collection and a plan a record of `plans`, kept by the host's record store. By default each one is a Markdown file beside the daemon's configuration, the fields as YAML frontmatter and a task's `body` or a plan's `goal` as the Markdown body. A plugin that takes the store over with `registerRecords(store, 'replace')` keeps them there instead, and nothing here changes.

The fields, the statuses, the stamps, the ten tools and the approve grant are in [`docs/plugins/TASK-LIST.md`](https://github.com/ahpio/ahpd/blob/main/docs/plugins/TASK-LIST.md).

No option holds a credential, so the plugin takes nothing from the vault.

## In your own host

The package's `apply` is the plugin entry. Hand it a plugin host from `@ahpd/sdk`, then fold what it registered into the host's options:

```ts
import { createHost, foldHostOptions, listen, pluginHost } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';
import { apply, name } from '@ahpd/tasks';

const path = process.cwd();
const context = { path, paths: [path], version: '0.12.0', hostName: 'my-host', configDir: '/var/lib/my-host', log: console.log, say: console.log };
const { host: plugin, contribution, seal } = pluginHost(name, context);
await apply(plugin, { requireApproval: true });
seal();

const { options } = foldHostOptions({ path, agents: [claude({ paths: [path] })] }, [contribution]);
const host = createHost(options);
await listen({ port: 9187 }, (peer) => host.accept(peer));
```
