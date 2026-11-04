---
title: A system tunnel that fails at the daemon's start is not retried
status: open
date: 2026-11-04
severity: major
refs:
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L225-L280](../../packages/tunnel-devtunnel/src/kind.ts#L225-L280) - `start`, which reports `error` when `service.add` throws, and is not called again"
  - "[code://packages/sdk/src/tunnels/channel.ts#L529-L538](../../packages/sdk/src/tunnels/channel.ts#L529-L538) - `enable` and `disable`, which start the record again"
---

## Symptom

On 2026-11-04 Softov's daemon started with the `devtunnel` connector named in the plugin's options. The system tunnel `devtunnel-46bba8c0` on port 31546 stayed in `status: error`, with "Tunnel service returned status code: 401 Unauthorized". A person tunnel on the same connector ran.

A `devtunnel/disable` and a `devtunnel/enable` on the system tunnel made it run, at `https://lrfbfdpc-31546.brs.devtunnels.ms/`.

## Cause

Unknown. The 401 came from the Dev Tunnels service when the tunnel started. The same connector worked later, so the token at the daemon's start is a guess, not a fact. The daemon's log was not read.

## Impact

After a restart, the host's own tunnel can stay down until a person disables and enables it. The Dev Tunnel plugin's view shows nothing while the system tunnel is down.

## Workaround

Disable and enable the system tunnel, in ahpw or with `x-ahpd/invokeOperation`.

## Fix

Not chosen. Candidates: start the system tunnel again when its connector's token is refreshed, or retry a start that failed with 401 after a delay.
