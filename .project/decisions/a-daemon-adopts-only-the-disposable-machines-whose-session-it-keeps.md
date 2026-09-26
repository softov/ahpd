---
title: A daemon adopts only the disposable machines whose session it keeps
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/plugin.ts#L308-L323](../../packages/computer/src/plugin.ts#L308-L323) - the startup listing that arms a removal for every labelled disposable machine it finds"
  - "[code://packages/sdk/src/host.ts#L8025](../../packages/sdk/src/host.ts#L8025) - a listed session resumed through `spawn`, which never calls `enter`"
---

## Context

At startup the computer plugin lists every disposable machine carrying its label and arms each one's removal with no session counted.
Two daemons sharing one Docker with the default label `ahpd.computer=1` therefore remove each other's live disposable machines, and a session this daemon keeps and resumes later is not counted, so its machine is removed under it about five minutes after a restart.

## Decision

A disposable machine records the session it was made for as a label.
At startup a daemon adopts only the leftover disposable machines whose recorded session it keeps, and counts that session as a user until the session is disposed.
A leftover whose session this daemon does not keep is not this daemon's, and is left alone.
Source: Softov, 2026-09-26, asked "plugin/16: two daemons sharing one Docker remove each other's disposable machines at startup. How does a daemon know which leftovers are its own?": "Adopt only kept sessions".

## Consequences

Two daemons can share one Docker without configuration.
A session this daemon keeps holds its machine across a restart, whether or not anybody resumes it before the delay.
A leftover whose session was deleted while the daemon was down is never removed by any daemon; the docs say how to find and remove such machines by label.

## Options

- **A daemon identity label.** Every machine carries the daemon's identity; it still leaves the kept-but-not-resumed session uncounted, and needs a stable identity per daemon.
- **Each daemon sets its own `label`.** A documented rule with nothing enforcing it, and the default still collides.
