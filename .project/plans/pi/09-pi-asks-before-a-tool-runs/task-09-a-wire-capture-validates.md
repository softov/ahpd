---
title: A captured pi session validates against the protocol schema
status: done
depends: [task-08-the-readme-and-comments-say-what-is-true.md]
layer: "agent-pi"
refs:
  - "[code://tools/validate.mjs](../../../../tools/validate.mjs) - `pnpm wire -- <file>`, the check the plans name"
---

## Objective

The frames of a pi session that uses a host tool, a client tool, an ask approved and one declined, and a usage report, captured with `--wire`, pass `pnpm wire`.

## Files

- `UPDATE:` this task's Resume - the command and the result.

## Steps

1. Run the daemon from this tree on a scratch `XDG_CONFIG_HOME` and a port away from 9187, with `--wire <scratch file>`, and drive a pi session through the cases above; a model that answers is needed, so use a scripted backend if no key works, and say which in the Resume.
2. Run `pnpm wire -- <file>` and fix any frame this batch made invalid.

## Validation

- `pnpm wire -- <file>` reports no invalid frame.
- The Resume names the capture's cases and the command.

## Resume

Built, with a scripted backend, because no model provider key works on this machine.
The daemon ran from this tree with:

```
XDG_CONFIG_HOME=/github/pi-wire/config node --conditions development --import scripts/dev.mjs packages/server/src/main.ts run \
  --path /github/pi-wire/work --port 9287 --without-connection-token \
  --plugin /github/pi-wire/pi-scripted.ts --wire /github/pi-wire/capture.jsonl
```

`/github/pi-wire/pi-scripted.ts` lives outside the repository, so the diff stays in packages/agent-pi. It registers a `pi` agent whose session is `piSession` over a scripted `open` that raises pi's own events, and `/github/pi-wire/drive.mjs 9287` drove one client through the cases: a host tool that runs, a writing host tool that is asked about and approved, a client tool the client runs, a `bash` call that is declined, and a usage report.

`pnpm wire -- /github/pi-wire/capture.jsonl` reported `146 frames, 151 payloads checked against 473 declarations` and `nothing undeclared, nothing missing`.

The capture found frames this backend sent that the protocol does not declare, and they were fixed:
- `chat/toolCallConfirmed` with `approved: false` carries `reason: 'denied'`, from both `confirm` and `releasePending`.
- `sessionState()` no longer carries `resource`, which is declared on `SessionSummary` and not on `SessionState`.
- the `session/statusChanged` and `session/modelsChanged` emits are gone, by Softov's answer: status reaches a client as the declared `session/chatUpdated`, and a session's model list is left to `Session.models()`.

- `node_modules/.bin/vitest run packages/agent-pi` green, 90 tests; `pnpm typecheck` green.
