---
title: A device registers for push by writing a resource the push plugin serves
status: proposed
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts#L5555-L5572](../../packages/sdk/src/host.ts#L5555-L5572) - `advertisedSchemes`, which puts every registered provider in `_meta`, so a client can see `push` before it writes"
  - "[code://docs/PLUGINS.md#L700-L746](../../docs/PLUGINS.md#L700-L746) - a host-owned URI scheme and its optional write half"
---

## Context

A host that pushes to a phone needs that phone's push token, and the protocol has no command for a client to hand a host one.

## Decision

`@ahpd/push` serves a `push:` scheme, and a client registers by writing `{ token, platform, lang }` to `push://devices/<install id>` with the protocol's own `resourceWrite`, and unregisters with `resourceDelete`.
(defaulted: the writer chose it, since it needs no new protocol command and no new plugin kind; Softov may erase it.)

## Consequences

A client finds out whether a host can push from `_meta.ahpd.resourceProviders`, the way it finds `computer`.
A registration is gated like any write, `file:write`, so a guest with read only cannot register.
The plugin keeps the devices itself, in a file under the daemon's state directory.

## Options

- A new protocol command: the clean name, but a change to a spec this repository does not own.
- A plugin option set from the command line (`ahpd plugin config push token=…`): no client work, but a person copies a token from the phone by hand.
