---
title: A start at a terminal in a folder the daemon does not serve asks to trust it, and `--no-cwd` neither serves nor asks
status: accepted
date: 2026-09-30
refs:
  - "[code://packages/server/src/commands/options.ts#L406](../../packages/server/src/commands/options.ts#L406) - with no `paths`, the current folder is served"
---

## Context

With no `paths` configured the daemon serves the folder it was started in, without asking; with `paths` configured, starting it in another folder serves nothing there, silently.
A folder a daemon serves is one its agents read, edit and run in, which Claude Code guards with a "trust this folder" prompt.

## Decision

`ahpd configure` asks to trust each folder it will serve.
`ahpd` or `ahpd start` at a terminal, in a folder not under `paths`, asks "Serve <folder>? Yes, trust this folder / No"; yes adds it to `paths` in `config.json`, no starts without it.
`--no-cwd` serves only `paths` and never asks; with no `paths` it refuses, naming `--path` and `ahpd configure`.
Without a terminal nothing is asked, and the current folder is served only as today, when `paths` is empty and `--no-cwd` is not given.

Source: Softov, 2026-09-30, asked when to ask to trust a folder: "both, --no-something to not server and not ask. so running it from a command with config.json does not server current folder and does not lock asking for folder"; asked the flag's name: "--no-cwd".

## Consequences

A person who starts the daemon in a new project is asked once, and the answer is kept.
A script or a service passes `--no-cwd` and never blocks on a question.

## Options

- **Ask only in configure**: a start in a new folder stays silent.
- **Ask only at start**: configure writes folders nobody confirmed.
