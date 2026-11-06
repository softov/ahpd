---
title: OpenRouter signs in
status: done
depends: [task-01-a-connector-signs-in-with-a-pasted-code.md]
layer: server
refs:
  - "[code://packages/server/src/proxy/adapters.ts#L302-L333](../../../../packages/server/src/proxy/adapters.ts#L302-L333) - the `openrouter` adapter"
  - "[code://packages/server/src/proxy/adapters.ts#L27](../../../../packages/server/src/proxy/adapters.ts#L27) - `OPENROUTER_ENDPOINT`, where models answer"
  - https://openrouter.ai/docs/use-cases/oauth-pkce - the URL, its parameters and the key exchange
---

## Objective

An `openrouter` connector signs in with OpenRouter's PKCE flow and gets its `key` from it.
A typed key still works.

## Files

- `UPDATE: packages/server/src/proxy/adapters.ts:302-333` - give `openrouter` a `signIn` that fills `key`.
- `CREATE: packages/server/test/openrouter-signin.test.ts` - the URL and the exchange against a fake fetch.
- `CREATE: .project/pending/plugin-71-sign-in-checks.md` - the check by hand, after the ahpw Connect button.
- `UPDATE: docs/plugins/PLUGINS.md` - the `openrouter` adapter signs in.

## Steps

1. Set `signIn.title` to `Sign in with OpenRouter` and `signIn.field` to `key`.
2. Build the URL as `https://openrouter.ai/auth` with `code_challenge`, `code_challenge_method=S256`, `state` and `key_label=ahpd`.
3. Leave out `callback_url`, so OpenRouter shows the code for the person to copy.
4. Exchange with a POST of `{ code, code_verifier, code_challenge_method }` to `https://openrouter.ai/api/v1/auth/keys`.
5. Answer the `key` from the reply, and refuse a reply with no string `key`.
6. Use the fetch that `hostAdapters` takes, so a test needs no network.
7. Write the pending check file with the steps a person runs once ahpw draws the Connect button.

## Validation

- `openrouter-signin.test.ts` checks the URL parameters and that the URL has no `callback_url`.
- It checks the exchange body, the answered key, and the refusal of a reply with no `key`.
- It checks that a refused exchange carries the status and no body.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.
- By hand, from the pending file: sign in to OpenRouter from ahpw, and the connector lists its models.

## Resume
