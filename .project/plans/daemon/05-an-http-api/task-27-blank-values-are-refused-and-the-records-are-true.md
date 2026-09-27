---
title: A blank token or host is refused, and the comments and refs say what is true
status: implemented
depends: [task-22-the-docs-comments-and-refs-say-what-the-code-does.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/main.ts#L67-L97](../../../../packages/server/src/main.ts#L67-L97) - `tokenFor`, where a blank token from any of the three is no token"
  - "[code://packages/server/src/commands/options.ts#L289-L297](../../../../packages/server/src/commands/options.ts#L289-L297) - `http.host`, refused when empty or when it has space around it"
  - "[code://packages/server/src/commands/authorize.ts#L11-L13](../../../../packages/server/src/commands/authorize.ts#L11-L13) - the 401 and 403 comment, which cites nothing"
---

## Objective

`--token=` with nothing after it is refused as a missing token, an `http.host` with surrounding space is refused at start with exit 2, no comment cites a decision for something it does not say, and task 22's own ref names the paragraph it describes.

## Files

- `UPDATE: packages/server/src/main.ts:67-97` - an empty or blank token is no token.
- `UPDATE: packages/server/src/commands/options.ts:289-297` - the host is refused unless it equals its trimmed self and is not empty.
- `UPDATE: packages/server/src/commands/authorize.ts:11-13` - the citation.
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

Implemented 2026-09-27. Tests first, each seen to fail: `--remote http://127.0.0.1:9 --token= status` exited 2 with `Cannot read the command surface from http://127.0.0.1:9/api/cli-manifest`, having tried the fetch with an empty bearer; `{"http":{"port":0,"host":" 127.0.0.1 "}}` exited 1, failing at bind. The token case also covers `--token '  '`, a token file holding only spaces and `AHPD_TOKEN='  '`, and each now exits 2 with exactly `ahpd: http://127.0.0.1:9 needs a token: pass --token, --token-file or AHPD_TOKEN.`.

`tokenFor` keeps the precedence it had (a file, else `--token`, else `AHPD_TOKEN`) and refuses whatever that yields when it is empty or only spaces, so a blank flag does not fall through to the environment. A file holding only spaces now gets the three-name sentence instead of `<file> is empty.`, which is what step 1 asks; a missing file keeps `no token file at <file>.`. `httpOf` refuses a host that is empty or does not equal its trimmed self, with the sentence the empty host had. `authorize.ts`'s comment cites nothing. Task 22's `docs/DAEMON.md` ref names the served-commands paragraph, L449-L453. `docs/DAEMON.md` says a blank token is refused.

The refs and `Files` ranges in tasks 07 to 27 of this plan that point into a file these tasks changed were moved by the diff against HEAD, and those in daemon/04 by the diff of this plan's changes alone.

`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts`: green in the full run below.
