---
title: ahpd's commands are declared once, with @cofold/commands
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/main.ts#L255-L310](../../packages/server/src/main.ts#L255-L310) - the hand-written flag parser"
  - "[code://packages/server/src/main.ts#L430-L660](../../packages/server/src/main.ts#L430-L660) - the verbs: start, stop, status, config, user, plugin"
  - file:///github/cofold/packages/commands/src/registry.ts - `createRegistry`, and the `authorize` hook commands' `scopes` are checked against
  - file:///github/cofold/packages/terminal/src/program.ts - `Program`, the terminal rendering: help, completion, output modes, exit codes
  - file:///github/cofold/packages/remote/src/manifest.ts - the same declarations as a manifest and OpenAPI
---

## Context

The CLI parses about 25 flags by hand, and its verbs are separate code paths with their own output.
An HTTP API for administration is wanted, as a user's choice, with the permissions the daemon already has.
`@cofold/commands` declares a command once, and `@cofold/terminal`, `@cofold/remote` and `@cofold/mcp` render the same declaration as a CLI, HTTP and MCP.

## Decision

ahpd's verbs and flags are declared with `@cofold/commands` and run through `@cofold/terminal`, and each command's `scopes` are ahpd's grant pairs, checked by the registry's `authorize` hook.
Source: Softov, 2026-09-26, asked "What about @cofold/commands for ahpd's CLI?", answered "Adopt with the HTTP API".

## Consequences

`@ahpd/server` depends on `@cofold/sdk`, `@cofold/commands` and `@cofold/terminal`, about 4,300 lines at 0.2.0 with no third-party dependency; `@cofold/remote` joins with the HTTP API.
The daemon gains help, completion, `--json` and exit codes from one place, and the HTTP API comes from the same declarations.

## Options

- **Keep the hand-written parser.** No dependency; the HTTP API would then restate every command a second time.
- **Move the CLI now and decide HTTP later.** The same work, with the reason for it deferred.
