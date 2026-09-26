---
title: Only the images an operator named - implemented
date: 2026-09-25
refs:
  - git://5bbd4c8
  - "[code://packages/computer/src/reference.ts](../../../../packages/computer/src/reference.ts)"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts)"
  - "[code://packages/computer/src/tools.ts](../../../../packages/computer/src/tools.ts)"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts)"
---

The `images` option on `@ahpd/computer` limits which images a machine may be made from, matched by name component, and a manifest or a tool call naming anything else is refused with the allowed set in the message.
Without the option any image is allowed, as before.

## What was built

- [`code://packages/computer/src/reference.ts`](../../../../packages/computer/src/reference.ts) - `referenceOf` and `patternOf` split a reference into registry, path, tag and digest and fold the Docker Hub spellings; `allows` and `allowedBy` match component by component with `*` and `**`; a `*` inside a component throws.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - reads `images`, checks every pattern at load, and passes the set on.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - the set is the option plus the default image plus every profile's image; `manifestOf` refuses beside the dash check; the schema publishes an `enum` only when every entry is a plain name.
- [`code://packages/computer/src/tools.ts`](../../../../packages/computer/src/tools.ts) - `request_disposable_computer` applies the same refusal, since it builds a machine without a manifest.
- [`code://docs/COMPUTER.md`](../../../../docs/COMPUTER.md) - "Allowed images" under Security, with the pattern table.

## Verified

- `test/computer-reference.test.ts` (5 cases): the four spellings of `node:22`, `acme-evil` against `acme/*`, a digest against a tag pattern, a pattern with no wildcard as an exact match.
- `test/computer.test.ts`: allowed and refused images through the provider, the default and profile images in the set without being named, the `enum` published only for a set of plain names, and no option allowing anything.
- `test/computer-plugin.test.ts`: `node:22-*` refused when the plugin loads.
- The three files, 36 tests, green on 2026-09-25.
- Against real Docker 29.6.2 on 2026-09-25, with `images: ["debian:*"]`: `curlimages/curl:latest` was refused with "This host does not run curlimages/curl:latest; it runs debian:*, debian:bookworm-slim" and made no container; `debian:bookworm-slim` made a machine, and the delete left `docker ps -a --filter label=ahpd.p13check=1` empty.

## Departures from the plan

- None in behaviour. The plan predates the current format: its decisions are in its own table rather than decision files, and its tasks are rows rather than task files. The code cites the plan's slug for decision 1.
- The docs landed under "What a body may not say"; that section is now "Security" after the 2026-09-25 rewrite of `docs/COMPUTER.md`.

## Left for later

- Nothing.
