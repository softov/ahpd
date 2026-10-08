---
title: A bot owns one folder, and every session the host starts for it runs there
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/automations.ts#L638-L700](../../packages/sdk/src/host/automations.ts#L638-L700) - a run's working directory, made before anything runs in it"
---

## Context

A bot's session needs a working directory.
It can take any folder a person names, or the bot can have one folder of its own.
A bot runs on this host or on a computer that other people and bots share.

## Decision

Each bot owns one folder, its `workspace`, and every session the host starts for it has that folder as its working directory.
The folder is `<root>/<slug>`, where `root` is an option of the bot plugin with the default `~/.bots`.
On a computer, the same path is inside the machine.
The owner can name another path when they make the bot.
Two bots never share a folder.
Source: Softov, 2026-10-07: "I was thinking in each agent having its workspace. the cwd path on agents session. So each agent 'own' one folder. So when running local, or on shared computer."
Then asked "Where does the host make that folder by default, locally and on a shared computer?", answered "A plugin option root", and then: "likes ~/.agents better be ~/.bots?"

## Consequences

A bot's files, and later its memory, stay in one place that a person can open.
Two bots on one shared computer do not write over each other's files.
A deleted bot leaves its folder, because the files are its owner's.

## Options

- **Under ahpd's config dir**: rejected, it mixes a bot's work with the host's settings.
- **Any folder per session**: rejected, the bot then owns nothing.
