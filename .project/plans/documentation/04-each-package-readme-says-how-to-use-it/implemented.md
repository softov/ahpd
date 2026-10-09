---
title: Each package's README says how to use it, how to configure it and what each option does - implemented
date: 2026-10-09
refs:
  - git://90ecb7f
  - "[code://packages/server/README.md](../../../../packages/server/README.md)"
  - "[code://packages/sdk/README.md](../../../../packages/sdk/README.md)"
---

Each package README now has the same sections in the same order. Each plugin README shows a complete `config.json` block and a table row for each option, with its default from the code. It also lists the ahpd commands for the package and shows how to load the plugin in your own host. The server README links each command and flag to `docs/DAEMON.md`. The sdk README has one row for each `HostOptions` property.

## What was built

- [`code://packages/server/README.md`](../../../../packages/server/README.md) - rows for the global output flags `--json`, `--quiet`, `--verbose`, `--no-color` and `--yes`, and links to the `DAEMON.md` command sections.
- [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md) - the `plugin update` row.
- [`code://packages/agent-acp/README.md`](../../../../packages/agent-acp/README.md) - the plugin section order, a default on each row, and the `presets.<id>` and `presets.<id>.machine` tables.
- [`code://packages/agent-cofold/README.md`](../../../../packages/agent-cofold/README.md) - the plugin section order, and the `tools` and `tools.web.search` tables.
- [`code://packages/agent-pi/README.md`](../../../../packages/agent-pi/README.md) - the plugin section order, and the defaults from the code.
- [`code://packages/computer/README.md`](../../../../packages/computer/README.md) - 19 top-level options, a `profiles.<name>` table and a `devcontainer` table.
- [`code://packages/bot/README.md`](../../../../packages/bot/README.md) - the plugin section order.
- [`code://packages/tunnel-devtunnel/README.md`](../../../../packages/tunnel-devtunnel/README.md) - the plugin section order. The embedder example raises `listening` and `stopping`.
- [`code://packages/sdk/README.md`](../../../../packages/sdk/README.md) - 38 `Options` rows, one for each `HostOptions` property, with defaults.
- `packages/agent-cofold/LICENSE` and `packages/bot/LICENSE` - copies of the root `LICENSE`. Each package lists `LICENSE` in `files`.

## Verified

- `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- A script checked each link in the nine READMEs against the local file and its heading anchors. No link is broken.
- The `In your own host` examples of the seven plugins typecheck against the built packages.
- The sdk `Use` example ran unchanged. A WebSocket client sent `initialize` and the host answered with protocol `0.9.0`.
- The READMEs contain no em dashes and no hard-wrapped prose.

## Departures from the plan

- The checklist says that no row names a property that the schema does not have. Some rows name fields that `optionsSchema` does not declare but the code validates and uses. These READMEs keep those rows, because the code wins:
  - Claude preset fields `sandbox`, `thinking`, `outputStyle` and `extraArgs`.
  - acp `machine` fields `part`, `state` and `seed`.
  - computer profile fields `title`, `description`, `image`, `cpus`, `memory`, `workdir`, `mounts`, `agents`, `folder`, `host`, `disposable`, `disposableDelay`, `disposableAlone`, `sessionFolder`, `sessionRepository` and `sessionTree`.
- The tunnel embedder example raises `listening` and `stopping` itself. The plugin does its work on those events, and only the daemon raises them.
- No document describes `foldHostOptions`. The sdk README points to the `In your own host` sections and does not link a doc.

## Left for later

- Declare the fields that the code accepts in each `optionsSchema`, or decide not to.
