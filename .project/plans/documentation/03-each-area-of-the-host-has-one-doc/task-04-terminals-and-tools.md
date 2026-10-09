---
title: Terminals and tools have their own docs
status: done
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/host/terminals.ts](../../../../packages/sdk/src/host/terminals.ts) - terminals"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - tools and MCP servers"
---

## Objective

`docs/TERMINALS.md` says what a terminal is, who opens one, where it runs, and its grants. `docs/TOOLS.md` says what tools a session is offered: host tools, plugin tools, MCP servers in root config with each field, and compact prompts.

## Files

- `CREATE: docs/TERMINALS.md`, `CREATE: docs/TOOLS.md`.

## Steps

1. Read the sources in Files and the area's code; list its terms, config keys, commands and grants.
2. Write each doc in the plan's shape, checking every claim against its code.
3. Move the named sections; leave one line and a link where each was.
4. Run `rg -n "DAEMON.md#|USERS.md#|AHP.md#" .` and fix each link that moved.
5. Find the area's decisions with `rg -ln "code://packages/<area path>" .project/decisions/` and link the ones a reader needs for why.

## Validation

- Each claim names a file it was read in; read by hand against that file.
- Softov reads the diff before commit.

## Resume

`docs/TERMINALS.md` is written, 130 lines: what a terminal is and its terms; where it runs and that any directory is accepted; pipes versus a pseudoterminal and what each makes readable; the three ways in (a client's `createTerminal`, a `!` command, a backend's `start.terminals.open`) and why only the first takes `defaultShell`; one command versus a shell to sit in; what a client sees, including the exit code inside `lifecycle`, the `128` a signal reports, and the 200,000-character scrollback; command boundaries under OSC 133 and OSC 7; the config key `defaultShell` with its values, default, per-connection rule and grant; the commands; the grants; and what to read next.

`docs/TOOLS.md` is written, 155 lines: what a tool is and its terms; the four sources (the host's own, a plugin's, a client's, an MCP server's); the host's nine session tools, its three artifact tools and its two read-only ones; a client's tools and how they are named and timed; `mcpServers` with each field, an example, the invalid-entry rule and the read-at-each-session-start rule; advanced permission beside `effects`; the four things that shape a tool (`instruction`, `compact`, `forSession`, `deferLoading`); how a model reaches them in process or over the endpoint; the config keys; the commands; the grants; and what to read next.

Read against `packages/sdk/src/terminals.ts`, `packages/sdk/src/host/terminals.ts`, `packages/sdk/src/types/terminals.ts`, `packages/server/src/pty.ts`, `packages/sdk/src/host/tooling.ts`, `packages/sdk/src/artifacttools.ts`, `packages/sdk/src/host/gate.ts`, `packages/sdk/src/host/actions.ts`, `packages/sdk/src/host/lifecycle.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/users.ts`, `packages/server/src/commands/plugin.ts` and `packages/server/src/commands/run.ts`.

Found, and written as the code does it, not as the old text did:

- The comment at `packages/sdk/src/host/terminals.ts:249-257` says a client's `createTerminal` checks the directory against the ones the host serves before the shell is spawned. `createTerminal` makes no such check: `const asked = typeof params.cwd === 'string' ? localPath(params.cwd) : dir;` is taken as given, and `packages/sdk/test/host-terminals.test.ts:439` pins the opposite, opening one in `file:///etc` and expecting it to resolve. TERMINALS.md says any directory is accepted and a directory that is not there is a shell that fails to start with exit code `127`. The same claim is in `docs/AHP.md`'s `createTerminal` row ("Opens in a directory this host serves"), which this task's Files do not cover, so it is left as it is and listed here.
- `TitleStrategy` carries three values, `activeAgent`, `utility` and `deferred` (`packages/sdk/src/types/host.ts:491`), but `strategyOf` on this host returns only `deferred` or `activeAgent` (`packages/sdk/src/host/tooling.ts:107-108`). TOOLS.md says `utility` is a shape a tool has to answer for and not one a session runs under here.

No section moved in this task, so no link pointed at anything that left. The sweep found the same anchors as after task 03, all resolving; every anchor TERMINALS.md and TOOLS.md use (`USERS.md#roles`, `AHP.md#terminal--11-of-11`, `AHP.md#a-clients-tools-are-the-clients-to-run`, `HOST.md#configuration-keys`, `HOST.md#root-config`, `LIBRARY.md#terminals`, `LIBRARY.md#the-tools`, `PLUGINS.md#what-you-can-register`, `SESSIONS.md#grants`) was checked against the heading it names.

Decisions linked: `a-role-refuses-at-the-dispatch-boundary`, `host-wide-root-settings-need-config-write` in TERMINALS.md; `the-hosts-mcp-servers-are-root-config-as-in-vscode`, `a-tool-says-when-it-needs-advanced-permission`, `a-configuration-change-applies-live-or-on-ahpd-restart`, `host-tool-declares-what-it-does`, `root-config-declares-what-vscode-pushes-and-refuses-the-rest`, `the-hosts-tools-are-an-mcp-server-each-backend-may-take` in TOOLS.md. No decision cites `terminals.ts` or `tooling.ts` by `code://`, so the set came from the rules the code states.

`docs/RESOURCES.md` does not exist yet, so TOOLS.md's two links to it resolve once task 05 lands.
