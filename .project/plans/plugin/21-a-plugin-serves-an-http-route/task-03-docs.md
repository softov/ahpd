---
title: The docs and the domain reference list the route kind
status: todo
depends: [task-02-the-listener-serves-routes.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L114-L140](../../../../docs/PLUGINS.md#L114-L140) - What you can register"
  - "[code://docs/PLUGINS.md#L358-L371](../../../../docs/PLUGINS.md#L358-L371) - the \"not a kind\" line to remove"
  - "[code://.project/plans/plugin/00-plugin.md](../00-plugin.md) - the registration kinds table"
---

## Objective

A plugin author finds `registerRoute` where every kind is listed, and reads that a route authenticates its own caller.

## Files

- `UPDATE: docs/PLUGINS.md:114-140` - the route, its prefix, and that it is served with `http` off.
- `UPDATE: docs/PLUGINS.md:358-371` - the "HTTP routes are not" line removed.
- `UPDATE: .project/plans/plugin/00-plugin.md` - a `route` row in the kinds table, and the "not yet" line removed.

## Steps

1. Put "a route authenticates its own caller" first, and say that what it does on the host goes through its plugin's connection and grants.

## Validation

- Read against the code by hand.

## Resume

