---
title: A question at the terminal, with its default
status: todo
depends: []
layer: "server"
refs:
  - https://nodejs.org/api/readline.html#promises-api - `readline/promises`
---

## Objective

`ask(label, current)` prints `Label [current]: `, answers the typed text or `current` on Enter, and `choose(label, options, current)` and `confirm(label, yes)` do the same for a choice and a yes or no; with no TTY each refuses rather than waiting.

## Files

- `CREATE: packages/server/src/ask.ts` - the three functions, over streams the caller passes.
- `CREATE: packages/server/test/server-ask.test.ts` - the cases below.

## Steps

1. Tests first over fake streams: Enter keeps the default, text replaces it, a choice by number and by name, an unknown choice asks again, a closed input refuses.
2. Implement; no dependency.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
