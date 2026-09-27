---
title: Served answers hide the connection token, every plugin option value, and the credentials in a plugin spec's URL
status: accepted
date: 2026-09-27
supersedes: decisions/the-config-command-hides-its-secrets.md
refs:
  - "[code://packages/server/src/commands/config.ts#L24-L44](../../packages/server/src/commands/config.ts#L24-L44) - `withoutOptionValues` and `withoutSecrets`, the served masks"
  - "[code://packages/server/src/commands/plugin.ts#L36-L43](../../packages/server/src/commands/plugin.ts#L36-L43) - a served `plugin list` row, masked with `withoutOptionValues`"
  - "[code://packages/sdk/src/types/plugin.ts#L61-L68](../../packages/sdk/src/types/plugin.ts#L61-L68) - `PluginSpec`, a string or an object with `name`"
---

## Context

`GET /api/config` and `GET /api/plugin/list` hide `connectionToken` and every value under a plugin entry's `options`, and answer every other key as the file holds it.
A plugin spec can be a URL that npm installs from, and a private repository's URL carries its credential: `git+https://user:pat@host/repo`.
So a person holding `config:read` reads a deploy token back from the spec, which is the leak the option mask closes.

## Decision

A served answer replaces the userinfo of a plugin spec written as a URL, as a string or as an object's `name`, with `<set>` (`git+https://<set>@host/repo`), in `GET /api/config`, in `GET /api/plugin/list`, and in any sentence of a served row that quotes the spec.
It still answers `connectionToken` as `<set>`, and each plugin entry's `options` with its keys kept and every value `<set>`.
Every other key is answered as the file holds it.
The terminal's own `ahpd config` and `ahpd plugin list` keep printing the file.

Source: Softov, 2026-09-27, asked "daemon/05 task 31 masks the credentials in a plugin's git URL, but decision the-config-command-hides-its-secrets says every other key is answered as the file holds it. Supersede it?": "Supersede, mask userinfo".

## Consequences

A grant to read settings carries no credential written into the configuration, whether as an option or inside a spec.
A caller still sees which host and repository a plugin comes from.

## Options

- **Keep the decision it supersedes**: a credential in a spec is the owner's choice, and `config:read` shows it as written; the option mask would then close one leak and leave its neighbour open.
