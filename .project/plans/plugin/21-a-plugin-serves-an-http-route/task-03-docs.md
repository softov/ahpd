---
title: The docs and the domain reference list the route kind
status: done
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

- `docs/PLUGINS.md` gains a `registerRoute(handler)` row in **What you can register**, as `register, open key`.
- A new section, **A route authenticates its own caller**, sits directly under the table and before *What a backend needs from a machine*, and it is first because it is the thing an author must know before writing the handler: no bearer token in front of it, the `Host` check is the only guard, check the signature yourself. It then says what the route does on the host goes through the plugin's connection and its grants - the link is plan 20, which has not landed, so the docs name the gate that will be there rather than one that is.
- The section covers the prefix and the encoding (`@acme/webhooks` is `/plugins/%40acme/webhooks/`), that nothing is refused for the shape of a name, that the path reaches the handler whole, whole-segment matching, that a route is served with `http` off and on the daemon's own port, that `/api` is unaffected, and that a throwing handler is a 500 with the reason in the log.
- The "What is not a kind" list in `docs/PLUGINS.md` loses its `**HTTP routes** are not, because there is no HTTP server.` bullet; the three that remain are models, slash commands and UI, and the list is under a heading that does not count them.
- `.project/plans/plugin/00-plugin.md` gains the `HTTP route` row after `event`, with the method, the operation, what it lands in (the fold's `routes`, keyed by plugin name, beside `HostOptions` rather than in it) and `built 2026-10-04` with the plan link. Its "not yet" line is gone, and the count above the list changed from four things to three.
- `plans/index.md` was not touched.

