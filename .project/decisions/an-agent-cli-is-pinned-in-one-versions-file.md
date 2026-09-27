---
title: Every agent CLI is pinned in one versions file, and none updates itself
status: accepted
date: 2026-09-26
refs:
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the ACP Registry, whose entry shape the file follows and which a bump is diffed against
  - "[code://packages/agent-claude/src/claude.ts#L20-L28](../../packages/agent-claude/src/claude.ts#L20-L28) - Claude's version today is whatever the host has installed"
---

## Context

A part is built once per version and reused by every machine, so something has to say which version.
The choices are an exact version written down, the latest one at build, or whatever the CLI fetches for itself when it runs.
Most agent CLIs update themselves by default, which would change a part under a running fleet and needs the network in every machine.

## Decision

`packages/computer/images/versions.json` names every part with an exact version, shaped like an ACP Registry entry: id, npm package or archive URL per platform, version, and a sha256 for an archive.
A scheduled job diffs it against the registry and proposes a bump.
Every part is built with its CLI's own update switched off.
Source: (defaulted: the proposal Softov asked to plan on 2026-09-26; he may erase this).

## Consequences

A part is reproducible and its tag is its version, so whether it is built is one `docker image inspect`.
A new CLI version reaches machines only through a bump, reviewed like any other change.
An agent whose update switch is undocumented (Cursor) is pinned by the build and may still try to update; its part is read-only, so the attempt fails rather than changes it.

## Options

- **Latest at build.** Always fresh, never reproducible, and two hosts building on different days run different agents under one name.
- **Fetched at run time by the CLI or `npx`.** Needs the network in the machine and changes under a running session.
