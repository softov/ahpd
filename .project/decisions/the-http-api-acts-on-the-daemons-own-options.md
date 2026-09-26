---
title: The HTTP API acts on the daemon's own options, and takes no path from a request
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/options.ts#L101-L240](../../packages/server/src/commands/options.ts#L101-L240) - `serverFields`, `userFields` and `pluginWriteFields`, which carry `configFile`, `users`, `plugins` and `paths`"
  - "[code://packages/server/src/commands/options.ts#L272-L343](../../packages/server/src/commands/options.ts#L272-L343) - `optionsFrom`, which re-reads the configuration from the request's input"
  - "[code://packages/server/src/commands/user.ts#L28-L44](../../packages/server/src/commands/user.ts#L28-L44) - `people`, which opens whatever users file the input names"
  - "[code://packages/server/src/commands/status.ts#L22-L39](../../packages/server/src/commands/status.ts#L22-L39) - `status`, which reads `daemon.json` rather than the daemon answering"
  - "[code://test/server-http.test.ts#L48-L50](../../test/server-http.test.ts#L48-L50) - the test that has to run the daemon on the default configuration path for the API to agree with it"
---

## Context

The served commands take their input from the request, and that input includes `configFile`, `users`, `plugins` and `paths`.
A request therefore chooses which files the daemon reads and writes: `GET /api/plugin/list?configFile=<file>` answered with the first bytes of that file, and `user add` with `users=<path>` wrote a users file there.
Without those fields the commands re-read the default configuration path, so a daemon started with `--users` or `--config-file` is not the one its API describes, and `status` answers 500 for a daemon that was not started by `ahpd start`.

## Decision

The remote surface does not take `configFile`, `users`, `plugins` or `paths`.
A served command acts on the options the daemon was started with: its configuration file, its user directory, its plugin list and its directories.

Source: Softov, 2026-09-26, asked "Should the remote surface drop path-valued fields (`configFile`, `users`, `plugins`, `paths`) and bind to the daemon's own options, or keep them with an allow-list?": "drop them from the remote surface; the API acts on the daemon's own options".

## Consequences

A request can no longer name a file on the host.
`ahpd --remote` loses `--config-file`, `--users`, `--plugin` and `--path` on the served commands, because the manifest no longer declares them.
The served registry is built with the running daemon's options, so `status` describes the process that answers.

## Options

- **Keep them with an allow-list.** Every new path field is one more entry to get right, and the default path still disagrees with a daemon started on another.
