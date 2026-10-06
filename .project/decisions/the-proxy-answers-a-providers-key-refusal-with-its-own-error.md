---
title: The proxy answers a provider's 401 or 403 with its own error, and the provider's words go to the log
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/server/src/proxy/listener.ts#L395-L403](../../packages/server/src/proxy/listener.ts#L395-L403) - a provider's answer is streamed back as it came, status and body"
  - "[code://packages/server/src/proxy/dialects.ts#L91](../../packages/server/src/proxy/dialects.ts#L91) - `refusalBody`, the error each dialect's client reads"
  - git://3e93f6a - proxy/02, the listener
---

## Context

The proxy calls a provider with the host's key, not the caller's.
When the provider answers 401 or 403, that is about the host's key, but the caller gets the provider's status and body as they came: a client reads a 401 as its own token being wrong and asks its person to sign in again, and the body can name the host's account or key.

## Decision

A provider's 401 or 403 is not streamed back.
The caller gets the dialect's own error, built by `refusalBody`, saying that the host's provider refused the host's key for that model, with status 502.
The provider's status and message go to the daemon's log, on the line the call already writes.

Source: Softov, 2026-10-06, asked "When a provider answers the proxy with 401 or 403, what does the caller see?" and chose "The proxy's own error". The status is `(defaulted: 502, because a 401 or 403 tells the caller its own credential is wrong)`.

## Consequences

- A client does not ask its person to sign in again over the host's key, and the host's account details stay out of its answer.
- Whoever runs the host reads the provider's words in the log, not from the person who called.
- A 401 or 403 is still not retried on the next candidate: proxy/02 retries only a refused connection, a 429 or a 5xx.

## Options

- **Pass it through unchanged.** Lost: the caller is told about a credential that is not theirs, and sees the provider's body.
