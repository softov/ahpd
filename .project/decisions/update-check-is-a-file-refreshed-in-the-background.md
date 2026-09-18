---
title: The answer is read from a file, and only the long-lived process refreshes it
status: accepted
date: 2026-09-18
refs:
  - git://165020b - ROADMAP.md "Telling somebody the version is old" as written on 2026-09-06; the prose left the roadmap for this plan
  - code://packages/server/src/config.ts#L61 - `daemonPath()`, the file this one sits beside
  - code://packages/server/src/config.ts#L90 - `sessionsPath()`, the other machine-written file in the directory
  - code://packages/server/src/main.ts#L265-L293 - the `start` and `status` verbs, which print and leave
---

## Context

A start that waits on a registry is a start that hangs on a network nobody can see.
`fetch` holds the event loop open, so a verb that prints and exits would sit there after it had printed if it made one.
The daemon is the process that was going to be long-lived anyway.

## Decision

The daemon writes `update.json` beside `daemon.json` and `sessions.json`, holding the package name, the `latest` it read and when it read it.
It refreshes the file when it starts if the file is missing or older than six hours, and every six hours after that, on a timer that does not hold the process open.
The daemon's own startup line, the `start` verb and the `status` verb read the file and say what it says, and none of them touches the network.
A notice that arrives one run late is still a notice.

Source: Softov, ROADMAP.md, 2026-09-06.

## Consequences

The first run of a fresh install says nothing, because there is no file yet.
`update.json` is machine-written and never belongs in `config.json`, for the reason `automations.json` and `sessions.json` do not.
The timer must be `unref()`ed, or the daemon's shutdown waits on it.

## Options

Fetching at start, before the startup line, is what most CLIs do and is the hang described above.
Fetching from every verb makes `ahpd status` a network call, which is the wrong thing for a command that answers "is one running".
