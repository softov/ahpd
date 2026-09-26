---
title: ahpd plugin install installs the package and names it in the configuration
status: accepted
date: 2026-09-25
refs:
  - "[code://packages/server/src/plugins.ts#L169-L176](../../packages/server/src/plugins.ts#L169-L176) - a bare name resolves only from the configuration directory"
  - "[code://packages/server/src/config.ts#L84-L92](../../packages/server/src/config.ts#L84-L92) - `plugins`, the list a run loads"
---

## Context

Installing a plugin today is two steps in two places: `npm i` inside `~/.config/ahpd`, then adding the name to `plugins` in `config.json`.
On 2026-09-25 the plugins were installed with `npm i -g` instead, which the daemon cannot see, and the user asked: "its there a way to make a install using ahpd? `ahpd plugin install`".

## Decision

`ahpd plugin install <name>...` installs each package into the configuration directory and adds each name to `plugins` in the configuration file, unless it is already there.
`ahpd plugin remove <name>...` takes it out of `plugins` and uninstalls it.
`--no-enable` installs without touching the configuration.

## Consequences

The daemon writes `config.json` for the first time, so it has to keep every other key and every existing entry as it found them.
One command leaves a plugin that the next run loads, which is what a person running it expects.

## Options

- **Install only, and let the person edit `plugins`.** Rejected: it keeps the second step that was the reason for asking, and `plugin list` would show an installed plugin the run does not load.

(defaulted: the user asked for the command; install-and-enable is the writer's choice and may be reversed.)
