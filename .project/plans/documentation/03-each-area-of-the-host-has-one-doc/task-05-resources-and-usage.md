---
title: Resources and usage have their own docs
status: implemented
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/host/resourcemethods.ts](../../../../packages/sdk/src/host/resourcemethods.ts) - resource commands"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts) - usage"
---

## Objective

`docs/RESOURCES.md` says what a resource is: schemes, read, write, list and the rest, who may read what, and how a plugin serves a scheme. `docs/USAGE.md` says what usage is: pools, costs, the provider's reported cost and the input and output split, and `usage:read`.

## Files

- `CREATE: docs/RESOURCES.md`, `CREATE: docs/USAGE.md`.
- `UPDATE: docs/USERS.md` - "People as resources" and "Policies as resources" keep their text and link RESOURCES.md.

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

`docs/RESOURCES.md` is written, 116 lines: what a resource is and its terms; what `file:` serves - the whole filesystem this process can see, the connection token as the boundary rather than the directories the daemon was started with, a read resolved through symlinks, a write with its parent resolved and its final open carrying `O_NOFOLLOW`, and the encoding a read reports rather than the one a client asked for; the eleven `resource*` methods, one line each, with the six refusal codes they answer with; the three ways a scheme comes to exist (a plugin's `registerResourceProvider`, a client's `<scheme>://<clientId>/...`, a provider's own `describe()`), and that every scheme beside `file:` arrives the first way, the daemon's own included; the watch, its channel, its coalesced batch and the rule that reads `added` off the file's own creation time instead of an inventory of the tree; the two keys a client is told (`ahpd.resourceProviders` and `ahpd.grants`) and the one helper both are read from, so they cannot drift; the config keys `paths` and `plugins` with what each changes and that neither is a boundary; why there is no `ahpd resource`; the ten-row grants table with the two groups, a provider's own `authorize` for a read and a reader's own `user://<id>`; and what to read next.

`docs/USAGE.md` is written, 93 lines: what usage is and its terms; the two record kinds behind one port (a `model` call from the proxy or the agent meter, a stretch of `computer` time); the base every record carries; a model record's three token counts and the one figure a pool's `tokens` is; the two costs and the `from` that says which of them was worked out here; the split a harness reports as `input` and `output` and the `inputUsd`/`outputUsd` a pool adds them into; the pools a record names and the live total kept per pool per day; the four `usage://` URIs; `usage.per` and `usage.timezone` with their values, their defaults and what changes, and that neither has a flag because both are deployment properties; the two commands and their two HTTP paths; and the grants, including that the provider implements `get`, `list` and `resolve` and that a `usage:watch` is a grant a role may hold and an operation nothing answers.

Read against `packages/sdk/src/host/resourcemethods.ts`, `packages/sdk/src/resources.ts`, `packages/sdk/src/host/admission.ts`, `packages/sdk/src/host/root.ts`, `packages/sdk/src/host/relay.ts`, `packages/sdk/src/host/channels.ts`, `packages/sdk/src/types/resources.ts`, `packages/sdk/src/plugins.ts`, `packages/sdk/src/people.ts`, `packages/sdk/src/policy.ts`, `packages/sdk/src/users.ts`, `packages/sdk/src/usage.ts`, `packages/sdk/src/types/usage.ts`, `packages/sdk/src/meter.ts`, `packages/sdk/src/scopes.ts`, `packages/server/src/commands/usage.ts`, `packages/server/src/commands/run.ts`, `packages/server/src/config.ts`, `packages/server/src/proxy/listener.ts`, `packages/server/src/http.ts` and `packages/computer/src/plugin.ts`.

`docs/USERS.md` kept both sections' text and gained one line each, under the `## People as resources` and `## Policies as resources` headings, pointing at RESOURCES.md for what a scheme is and which operation of it each resource method asks for. Nothing moved in this task, so no link pointed at anything that left.

The two claims in those sections that this task's subject touches were checked against their code and hold: `team`'s advertised operations are `["get", "list", "resolve", "put", "delete"]`, which is what `packages/sdk/src/people.ts` implements (it has `list`, `resolve`, `read`, `write` and `remove`, and no other), and the `read` to `get` and `write` to `put` naming is `packages/sdk/src/host/root.ts`'s `METHOD_OF`. `GET /api/usage` and `GET /api/usage/{pool}` are `packages/server/src/commands/usage.ts`'s two `http.path` values under `packages/server/src/http.ts`'s `API_PREFIX = '/api'`. No contradiction with the code was found in this task's area.

The sweep found the same anchors as after task 04, each checked against the heading it names: `DAEMON.md#the-vault`, `DAEMON.md#--plugin-and-what-naming-one-runs`, `DAEMON.md#an-http-api-for-the-commands-the-terminal-runs`, `DAEMON.md#configuration`, `DAEMON.md#commands`, `USERS.md#roles`, and AHP.md's `#commands`, `#server-to-client-commands`, `#authentication`, `#a-clients-tools-are-the-clients-to-run` and the four channel headings. Every anchor RESOURCES.md and USAGE.md use resolves, and every file they link exists: `AHP.md`, `COMPUTER.md`, `HOST.md`, `LIBRARY.md`, `PLUGINS.md`, `POLICY.md`, `PROXY.md`, `RESOURCES.md`, `SESSIONS.md`, `TOOLS.md`, `USAGE.md`, `USERS.md`.

Decisions linked: `a-resource-scheme-is-advertised-in-meta`, `host-owned-schemes-are-provider-contributions`, `a-grant-names-an-operation-and-read-and-write-are-its-groups`, `a-scheme-provider-may-authorize-a-read-itself`, `a-scheme-nobody-serves-is-not-a-permission-error`, `a-scheme-provider-implements-less-than-a-resource-store` in RESOURCES.md; `usage-is-read-through-a-usage-scheme`, `usage-and-computer-time-are-two-records-behind-one-port`, `a-record-keeps-the-providers-cost-beside-the-charged-one`, `agent-usage-is-charged-to-owner-team-and-project-pools`, `the-usage-store-answers-live-totals`, `the-agent-meter-writes-per-turn-or-per-report`, `a-scheme-provider-may-authorize-a-read-itself` in USAGE.md.

The set came from searching the decisions by this area's code, and the search is worth recording because it is not the obvious answer: `rg -ln "code://packages/sdk/src/usage.ts|code://packages/sdk/src/host/resourcemethods.ts" .project/decisions/` finds nothing, and the wider sweep over `resources.ts` and `admission.ts` finds four files, two of which are this area's (`host-owned-schemes-are-provider-contributions`, `a-scheme-nobody-serves-is-not-a-permission-error`) and two that cite `resources.ts` in passing for another subject (`an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file`, `ahpd-and-ahpc-share-no-package`). The rest of the set is decisions the area's own rules name, found by title: `usage-is-read-through-a-usage-scheme`, `a-grant-names-an-operation-and-read-and-write-are-its-groups` and the six usage ones.

This task's two docs are what `docs/TOOLS.md`'s links to `RESOURCES.md` were waiting on, so those resolve now.
