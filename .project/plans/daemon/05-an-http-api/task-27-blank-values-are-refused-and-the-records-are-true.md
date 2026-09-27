---
title: A blank token or host is refused, and the comments and refs say what is true
status: todo
depends: [task-22-the-docs-comments-and-refs-say-what-the-code-does.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/main.ts#L60-L80](../../../../packages/server/src/main.ts#L60-L80) - `tokenFor`, which sends `--token=` as an empty bearer"
  - "[code://packages/server/src/commands/options.ts#L297-L305](../../../../packages/server/src/commands/options.ts#L297-L305) - `http.host`, where `\" 127.0.0.1 \"` passes and fails at bind"
  - "[code://packages/server/src/commands/authorize.ts#L12-L14](../../../../packages/server/src/commands/authorize.ts#L12-L14) - a comment citing `the-http-api-is-on-the-daemon-port-under-api` for what it does not say"
---

## Objective

`--token=` with nothing after it is refused as a missing token, an `http.host` with surrounding space is refused at start with exit 2, no comment cites a decision for something it does not say, and task 22's own ref names the paragraph it describes.

## Files

- `UPDATE: packages/server/src/main.ts:60-80` - an empty or blank token is no token.
- `UPDATE: packages/server/src/commands/options.ts:297-305` - the host is refused unless it equals its trimmed self and is not empty.
- `UPDATE: packages/server/src/commands/authorize.ts:12-14` - the citation.
- `UPDATE: task-22-the-docs-comments-and-refs-say-what-the-code-does.md` - its `docs/DAEMON.md` ref.
- `UPDATE: packages/server/test/server-cli.test.ts` - the cases below.

## Steps

1. `tokenFor` treats a blank token from `--token`, `--token-file` or `AHPD_TOKEN` like none, so the refusal that names the three is what the person reads.
2. `http.host` with leading or trailing space stops with the sentence the empty host gets.
3. `authorize.ts`: the 403 carrying the WebSocket's sentence is the plan's own row; the comment says what the function does and cites nothing.
4. Task 22's ref points at the served-commands paragraph in `docs/DAEMON.md`.

## Validation

- `server-cli.test.ts`: `--remote http://127.0.0.1:9 --token= status` exits 2 with the needs-a-token sentence; `{"http":{"port":0,"host":" 127.0.0.1 "}}` exits 2 with the host sentence.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume
