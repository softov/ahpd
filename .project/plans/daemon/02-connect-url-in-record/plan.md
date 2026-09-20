---
title: The ready connect URL lives in the daemon record and never on stdout
domain: daemon
status: built
priority: medium
created: 2026-09-19
revalidated: 2026-09-19
requires: []
changes: []
creates: []
decisions:
  - decisions/connect-url-lives-in-the-record.md
refs:
  - code://packages/server/src/daemon.ts#L8-L18 - `Running`, the record a detached daemon writes about itself, which holds the token-free `url` and no ready URL
  - code://packages/server/src/daemon.ts#L100-L127 - the stdout poll that reads the origin the child announced
  - code://packages/server/src/daemon.ts#L129-L145 - the record built from that announcement and written at mode 0600
  - code://packages/server/src/main.ts#L225-L259 - `secret()`, which decides the token and says where it came from
  - code://packages/server/src/main.ts#L135-L211 - `parse()`, which the `start` verb already runs before spawning
  - code://packages/server/src/main.ts#L271-L318 - the `start`, `stop` and `status` verbs, where `Running` fields are printed
  - code://packages/server/src/main.ts#L457-L472 - the child's startup lines, and the comment that keeps the secret off stdout
  - code://packages/server/src/config.ts#L59-L67 - `daemonPath()`, the 0600 file beside the configuration
  - code://.project/plans/daemon/00-daemon.md#L40 - the known gap this plan closes
  - code://.project/review/2026-09-19-upstream-pass-4.md#L76 - the token-in-the-announced-URL question this plan answers
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostServerMain.ts#L342-L348 - the reference host, which prints its connect URLs with the token and is the thing this host deliberately does not copy
  - code://test/update.test.ts#L1-L40 - the temporary `XDG_CONFIG_HOME` pattern a daemon test reuses
  - code://test/sessions.test.ts#L1-L30 - the store test that builds and rebuilds a host over one file
---

## Goal

A person who started a detached daemon can copy a ready connect URL out of the 0600 record instead of assembling one from a printed origin and a token they have to find.
stdout keeps printing only where the secret came from, and `ahpd status` never prints the token.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rn "connectUrl\|tkn=" packages/server/src` - only the USAGE sentence at `main.ts:128` that tells a person to add `?tkn=` by hand; the record has no ready URL.
- `grep -rn "running()\|daemonPath()" packages/server/src` - `start`, `stop` and `status` read the record through `running()`, and `stop` and `status` take no options.
- `grep -rn "writeFileSync(daemonPath" packages/server/src` - one writer, at `daemon.ts:144`, with `mode: 0o600`.
- `grep -rn "secret(" packages/server/src` - one caller, at `main.ts:330`, in the child, so the parent has the token only if the task passes it.
- `grep -rn "sessions in\|automations " packages/server/src` - the child's stdout lines that `daemon.ts` reads back with regular expressions.

### Runtime path

```
ahpd start --connection-token <secret>
  -> main.ts parses the verb, calls secret(parsed) and passes the token to start()
  -> daemon.ts spawns the child, polls daemon.log for `ws://host:port`
  -> record { pid, url, connectUrl, paths, startedAt } written at 0600
  -> a person reads daemon.json and copies ws://host:port/?tkn=<secret>
ahpd status -> running() -> prints record.url, never record.connectUrl
stdout of the child -> `ahpd on ws://host:port`, `automations ...`, `token: from --connection-token`
```

### Gaps

- No ready URL: `Running.url` is the token-free origin read from stdout, so a connection URL is assembled by hand.
- The parent never computes the token; `secret()` is called only in the child, so `daemon.ts` cannot build the query today.
- `Not found: any test for the daemon record - searched "running(" and "daemon.json" in test/; only `test/update.test.ts` and `test/sessions.test.ts` show the temporary-configuration pattern.`
- `Not found: a single printer of the record - searched "found.url" and "begun.url" in packages/server/src; each verb prints its own line, so each is a place a token could leak.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The ready connect URL lives in the daemon record, never on stdout](../../../decisions/connect-url-lives-in-the-record.md) | Softov, asked 2026-09-19: "Keep stdout token-free; put the ready URL in the 0600 daemon record." |

| What | Source | Task |
| --- | --- | --- |
| The record gains a `connectUrl` beside the fields it already holds, in the same 0600 file, and `url` stays the token-free origin | decision 1 | 01 |
| The `start` verb derives the token with `secret(parsed)` and passes it to `start()`, so the parent writes a record that is the child's answer and not a guess | decision 1, and `main.ts:274-289` already parses before spawning | 01 |
| The connection query is `?tkn=<token>`, the form `main.ts:128` documents and the client reads | decision 1 and reference `tunnelAgentHostConnector.ts` | 01 |
| Every reader of the record is checked, and `start`, `stop` and `status` keep printing `url` | decision 1, Consequences | 02 |
| `status` prints the token-free origin with a tested line builder rather than a raw dump of the record | (defaulted: `status` prints one line today and a record dump is the obvious future mistake) | 02 |

## Proposed architecture

- **Data flow** - `main.ts` derives the token once with `secret(parsed)`; `daemon.ts` gains `readyUrl(origin, token)` and `recordOf(announced, pid, token)`, writes `connectUrl` beside `url`, and keeps the 0600 mode.
- **Event flow** - none; the record is written once when the child announces its origin and is rewritten whenever a daemon starts again.
- **State flow** - `daemon.json` is the only state, with `url` the connectable origin and `connectUrl` the copyable URL that carries the secret.
- **Layer responsibilities** - packages/server/src/daemon.ts: the record shape, the ready URL and the pure builders · packages/server/src/main.ts: the token the parent passes and the lines the verbs print.
- **Source-of-truth files** - `code://packages/server/src/daemon.ts`, `code://packages/server/src/main.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Record the ready URL](task-01-record-the-ready-url.md) | done | - |
| [02 - Status stays token free](task-02-status-stays-token-free.md) | done | 01 |

## Risks and tradeoffs

- A record copied or synced to another machine hands over the host with it, so the file mode matters more than before and the task keeps the write at `0o600` and asserts it.
- A future verb that dumps the whole record prints the token; task 02 audits every reader and keeps each printer on `url`, and the tested line builder is the guard.
- A daemon bound to `0.0.0.0` announces `0.0.0.0`, which is not a routable address; the ready URL inherits that from the origin `status` already prints, and choosing a routable host is out of scope.
- The parent and the child both call `secret()`; for a missing token file the parent writes it first and the child reads the same file, so both sides agree on the token.
- `docs/DAEMON.md` still tells a person the token goes on the URL and does not yet point at the record, so the ready URL is discoverable from the file and this plan leaves the document for a later change.
- `start()` is exported and its signature changes; it has one caller, and the task updates it in the same change.

## Resume state

- **Done so far:** both tasks are done; the record carries `connectUrl`, the `start` verb passes the token, and every printer of the record stays on the token-free `url`. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Does `connectUrl` exist when there is no token? - answered: yes; `readyUrl` answers the origin with a trailing slash and no query, so the field is always present and always copyable.
- **Watch out for:** `url` must stay token-free because `start`, `stop` and `status` print it; the token belongs in `connectUrl` alone, and nothing but a person reading the file consumes that field.

## Final verification checklist

- [x] `pnpm test` green, with the daemon record cases in it.
- [x] `pnpm typecheck` and `pnpm boundary` green.
- [x] By hand: `ahpd start --connection-token <secret>` writes `daemon.json` at mode 600 with `connectUrl` carrying `?tkn=<secret>` and `url` without it.
- [x] By hand: `ahpd status` prints no part of the token.
- [x] `plans/index.md` updated.
