---
title: Docs
status: implemented
depends: [task-05-a-failed-start-says-why.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - profiles"
---

## Objective

`docs/COMPUTER.md` explains which backends run nested, the profile's `host`, and what the image must carry.

## Files

- `UPDATE: docs/COMPUTER.md`

## Steps

1. An image example with ahpd and the cofold plugin installed.

## Validation

- The example works.

## Resume

Implemented 2026-09-26.
`docs/COMPUTER.md` has a new "A backend that runs nested" section: which backends run nested and why (`runsNested`, and that ACP and Claude move their own process instead), the `<host> --stdio --plugin <each>` command the profile's `host` fills in, the default `["ahpd"]` and the `node /work/ahpd/main.js` case, the machine remembering its profile, the image example with `@ahpd/server` and `@ahpd/agent-cofold` installed, the `agents`/needs sharing the provider key, and the sentence a machine without a host ends with.
The backend table's cofold row now says it runs nested rather than being refused, and the line under "A session in one" points a backend that cannot enter a machine at the new section.
The image example itself is not built here - there is no Docker in this sandbox and the plan's tests are network-free - so it is checked against the profile options the plugin reads (`host`, `agents`, `image`) and the package names the repository publishes, not by building it.
