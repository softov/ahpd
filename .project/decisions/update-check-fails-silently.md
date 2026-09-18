---
title: Every failure of the update check is nothing to report
status: accepted
date: 2026-09-18
refs:
  - git://165020b - ROADMAP.md "Telling somebody the version is old" as written on 2026-09-06; the prose left the roadmap for this plan
---

## Context

Offline, a proxy that blackholes, a registry that is down, a package that is not on npm yet, and a reply that is not JSON all look different on the wire.
None of them is something the person can act on from this tool.

## Decision

The check writes `update.json` only on a `200` whose body is JSON with a string `latest`.
Anything else, including a timeout, leaves the file as it was and says nothing anywhere, not even in the daemon log.
The request carries an `AbortSignal.timeout`, so a blackhole costs seconds of background time and no output.

Source: Softov, ROADMAP.md, 2026-09-06.

## Consequences

A stale file keeps saying what it last read, which is a notice one run late rather than a word about the network.
Debugging the check means reading `update.json`, not a log line.

## Options

Logging failures to `daemon.log` puts a line there on every start of every offline machine.
Reporting them on the startup line is a word on somebody's screen about something they did not ask about.
