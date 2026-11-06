---
title: A connector signs in with its provider
domain: plugin
status: built
priority: medium
created: 2026-10-27
revalidated: 2026-10-27
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L226-L253](../../../../packages/sdk/src/types/connectors.ts#L226-L253) - `Adapter`, which gets an optional `signIn`"
  - "[code://packages/sdk/src/connectors/channel.ts#L491-L520](../../../../packages/sdk/src/connectors/channel.ts#L491-L520) - `x-ahpd/connectors/put`, which a finished sign-in runs with the key filled in"
  - "[code://packages/sdk/src/connectors/channel.ts#L15-L23](../../../../packages/sdk/src/connectors/channel.ts#L15-L23) - a `writeOnly` field moves to the vault under `connector/<id>/<field>` in the owner's scope"
  - "[code://packages/sdk/src/connectors/channel.ts#L649](../../../../packages/sdk/src/connectors/channel.ts#L649) - the channel's commands, which get two more"
  - "[code://packages/sdk/src/connectors/adapters.ts#L56-L69](../../../../packages/sdk/src/connectors/adapters.ts#L56-L69) - `rowOf`, the adapter row a client draws the form from"
  - "[code://packages/server/src/proxy/adapters.ts#L302-L333](../../../../packages/server/src/proxy/adapters.ts#L302-L333) - the `openrouter` adapter, whose `key` a person types today"
  - https://openrouter.ai/docs/use-cases/oauth-pkce - OpenRouter's PKCE flow, with no client id and a code shown on the page
---

## Goal

A person signs in to OpenRouter from a client, and the host keeps the key that the sign-in gives.
The person does not copy an API key by hand.
An adapter of any plugin declares a sign-in the same way, so the next provider adds only its own URLs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "pkce|code_verifier|device_code" packages/*/src` - no match. ahpd has no sign-in flow.
- `rg -n "writeOnly" packages/sdk/src/connectors` - a `writeOnly` field is a secret, and a put keeps it in the vault.
- `node /github/ahpc/dist/src/main.js help` - ahpc has no command that calls a channel command, so a check by hand waits for a client.

### Runtime path

```
client -> x-ahpd/connectors/signin { id, adapter, owner, title?, config } -> host keeps { verifier, params, caller } under a new state -> answers { url, state }
person opens url, signs in, copies the code
client -> x-ahpd/connectors/signin-finish { state, code } -> adapter.signIn.exchange(code, verifier) -> key
       -> the put path with config[field] = key -> vault connector/<id>/<field> -> connector row
```

### Gaps

- An adapter cannot say that it signs in.
- The connectors channel has no command that starts or finishes a sign-in.
- The adapter row tells a client nothing to draw a Connect button from.

## Answers

| What | Source | Task |
| --- | --- | --- |
| OpenRouter is the first consumer | Softov, 2026-10-27 | 02 |
| A vendor's own client id is decided per vendor, when that vendor's sign-in is planned. This plan needs none | Softov, 2026-10-27 | 01 |
| The key belongs to the connector's owner: `user:`, `team:`, or `host:` for a connector a root makes | Softov, 2026-10-27 | 01 |
| The host builds the PKCE flow with a pasted code. The device flow comes with its first consumer | (defaulted: OpenRouter needs only PKCE, and a flow with no consumer has no check) | 01 |
| A sign-in fills one `writeOnly` field of the connector, and the put path keeps it in the vault | (defaulted: the vault, the owner's scope and the remove path already exist for that field) | 01 |
| The adapter builds the sign-in URL and runs the exchange. The host makes the verifier, the challenge and the state | (defaulted: each vendor's URL and answer differ; OpenRouter's answer is a `key`, not an OAuth token) | 01 |
| The adapter row carries `signIn: { title, field }`, and the schema gets no new keyword | (defaulted: cofold refuses a schema keyword it does not enforce) | 01 |
| A started sign-in lives in memory for 10 minutes, is used once, and only its caller may finish it | (defaulted: an OpenRouter code expires after 10 minutes) | 01 |
| The sign-in uses OpenRouter's public URLs, whatever `endpoint` the connector names | (defaulted: `endpoint` is where models answer, not where a person signs in) | 02 |
| A typed `key` still works, and the field stays required | (defaulted: a host with no browser at hand keeps the old way) | 02 |
| The Connect button in ahpw is its own plan in that repository | file:///github/ahp-review/briefs/sign-in.md | - |

## Proposed architecture

- **Data flow** - `signin` checks what a put checks, except the field the sign-in fills, and answers a URL. `signin-finish` exchanges the code for a key and runs the put path with the key in that field.
- **Event flow** - a finished sign-in sends the same connector row a put sends. A started one sends nothing.
- **State flow** - the started sign-ins are a map in memory, keyed by state. A restart loses them, and the person starts again.
- **Layer responsibilities** - sdk: the `SignIn` type, the two commands, the started sign-ins and the PKCE values · server: the `openrouter` adapter's `signIn`.
- **Source-of-truth files** - [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A connector signs in with a pasted code](task-01-a-connector-signs-in-with-a-pasted-code.md) | done | - |
| [02 - OpenRouter signs in](task-02-openrouter-signs-in.md) | done | 01 |

## Risks and tradeoffs

- A code or a key in a log or an error gives away the account. No problem line, log, error or row carries the code, the verifier or the key.
- A caller could finish another person's sign-in with a stolen state. The host binds each state to the caller who started it.
- Many started sign-ins could fill memory. The host keeps at most 10 for each caller and drops the oldest.
- The exchange calls the network. It has a 10 second limit, and a failure answers the vendor's status only.

## Resume state

- **Done so far:** tasks 01 and 02 are implemented. The sdk owns `SignIn`, the two commands and the started sign-ins, and the server gives `openrouter` its `signIn`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** a finished sign-in must run the same checks as a put, again, because the caller's grants can change in 10 minutes.

## Final verification checklist

- [ ] A person signs in to OpenRouter from a client, and the connector's row is `ready`.
- [ ] The vault holds the key under `connector/<id>/key` in the owner's scope, and the record holds a `$secret` reference.
- [ ] No log line or error carries the code, the verifier or the key.
