---
title: ahpd join stops for good when a hub behind a reverse proxy is down
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/commands/join.ts#L180-L189](../../packages/server/src/commands/join.ts#L180-L189) - `answering` is true for any HTTP answer"
  - "[code://packages/server/src/commands/join.ts#L384-L390](../../packages/server/src/commands/join.ts#L384-L390) - an answering hub after a failed handshake is a conflict"
  - git://3a6ba76d - container/05-p10 added `ahpd join`
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A node joins a hub behind a reverse proxy.
The hub's daemon stops, and the proxy answers 502.
`ahpd join` exits, and does not try again.

## Cause

After a failed handshake, `join` asks whether the address answers HTTP.
Any answer, a 502 too, is read as a refusal, and `conflict` stops the command.

## Impact

A node behind NAT does not come back after a hub restart or update.
Somebody must start it again on the node's machine.

## Workaround

Run `ahpd join` under a service that restarts it.

## Fix

- Read a 5xx answer as not answering, and back off as for a closed port.
