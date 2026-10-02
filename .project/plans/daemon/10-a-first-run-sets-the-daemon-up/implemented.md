---
title: ahpd configure sets the daemon up, and a first start at a terminal offers it - implemented
date: 2026-10-02
refs:
  - "[code://packages/server/src/ask.ts](../../../../packages/server/src/ask.ts)"
  - "[code://packages/server/src/commands/configure.ts](../../../../packages/server/src/commands/configure.ts)"
  - "[code://packages/server/src/commands/start.ts](../../../../packages/server/src/commands/start.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
---

`ahpd configure` asks for the backends, host, port, token and folders at the terminal, each with the current value as its default, writes `config.json` and installs the backends chosen; a start at a terminal with no configuration offers it, and a start in a folder the daemon does not serve asks to serve it.

## What was built

- [`code://packages/server/src/ask.ts`](../../../../packages/server/src/ask.ts) - `ask`, `choose` and `confirm` over a terminal the caller passes; an ended input refuses rather than hangs.
- [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts) - `configure`: a backend already named and answered No is switched off with its options kept; a literal `connectionToken` is kept by moving it into the token file at `0600`; every folder answered No is refused; `offerConfigure`; `askToServe`, whose Enter is No.
- `options.ts` - `--no-cwd`, and the empty-`paths` refusal naming `--path` and `ahpd configure`.
- `start.ts`, `run.ts` - configure offered, then the folder question, before the options are read.
- `README.md`, `docs/DAEMON.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 163 files and 2412 tests after the rebase onto main, `pnpm boundary` clean.
- `server-ask.test.ts`, `server-configure.test.ts` over a faked terminal and a faked installer: defaults on Enter, a second run showing what it wrote, typed, generated, kept and literal tokens, a backend switched off and on, folders, a bad port, the offer and the trust question with and without a terminal and under `--no-cwd`.
- `daemon-backend.test.ts`: a real process with no configuration on a pipe refuses as before.
- Not run: `ahpd configure` at a real terminal against npm, and the trust question in a real `/tmp/new`.

## Departures from the plan

- Three rows were added to *Decisions locked in* during review: the trust question's Enter is No, a configured backend answered No is switched off, and a literal token is an existing token.
- Every folder answered No is refused rather than written as empty `paths`.

## Left for later

- See [deferred.md](deferred.md).
