---
title: A kept tunnel port with another protocol fails the tunnel's start
status: open
date: 2026-11-11
severity: major
blocks: []
refs:
  - "[code://packages/tunnel-devtunnel/src/service.ts#L409-L414](../../packages/tunnel-devtunnel/src/service.ts#L409-L414) - `add` writes the port with `createOrUpdateTunnelPort` and does not recover from a refusal"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L452-L458](../../packages/tunnel-devtunnel/src/service.ts#L452-L458) - `portOf` writes the protocol `auto`"
  - git://539740e14 - the port protocol moved to `auto`; ports written before it are `http`
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/dev_tunnels.rs#L1119-L1141 - VS Code's CLI removes the port and adds it again when the service refuses the protocol
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/dev_tunnels.rs#L1340-L1348 - VS Code's CLI matches the refusal by its text, for tunnels made before vscode#329066
---

## Symptom

Softov started a devtunnel tunnel on port 31546 from ahpw on 2026-11-11.
The tunnel went to `error` with "Tunnel service error: Invalid arguments. The tunnel port protocol cannot be changed."
`devtunnel port list` showed port 31546 on that tunnel with the protocol `http`.
After `devtunnel port delete <tunnel> -p 31546`, the error went away.

## Cause

The tunnel kept port 31546 from an ahpd older than `539740e14`, which wrote ports as `http`.
ahpd now writes the port as `auto`.
The service refuses a write that changes the protocol of a port that exists.
`add` passes the refusal on, so the start fails.

## Impact

A tunnel kept from before `539740e14` cannot start after an upgrade.
The person sees a service error and no way to clear it from a client.

## Workaround

Delete the port with `devtunnel port delete <tunnel> -p <port>`, then restart the tunnel.

## Fix

Candidate, not chosen: do what VS Code's CLI does.
When the write fails with "The tunnel port protocol cannot be changed", remove the port and write it again.
