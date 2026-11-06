---
title: A person mints tokens of their own
domain: host
status: built
priority: medium
created: 2026-10-18
revalidated: 2026-10-19
requires: []
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/access/users.ts#L948-L957](../../../../packages/sdk/src/access/users.ts#L948-L957) - `verify`, which compares a token with the one hash on each record"
  - "[code://packages/sdk/src/access/users.ts#L1275-L1284](../../../../packages/sdk/src/access/users.ts#L1275-L1284) - `mint`, which replaces a person's one hash"
  - "[code://packages/sdk/src/access/users.ts#L910-L916](../../../../packages/sdk/src/access/users.ts#L910-L916) - `standing` and `can`, where a principal's grants are read on each call"
  - "[code://packages/sdk/src/types/users.ts#L152-L156](../../../../packages/sdk/src/types/users.ts#L152-L156) - `UserRecord.token`, one hash per person"
  - "[code://packages/server/src/commands/user.ts#L218-L247](../../../../packages/server/src/commands/user.ts#L218-L247) - `user token`, which needs `user:write` and is bounded by the caller's grants"
  - "[code://packages/server/src/commands/user.ts#L303-L334](../../../../packages/server/src/commands/user.ts#L303-L334) - `user primary`, free for one's own record and `user:write` for another's"
  - "[code://packages/sdk/src/usage/usage.ts#L982-L1020](../../../../packages/sdk/src/usage/usage.ts#L982-L1020) - `usageMethods`, AHP methods that let a reader in for their own records"
  - "[code://packages/server/src/proxy/caller.ts#L99-L106](../../../../packages/server/src/proxy/caller.ts#L99-L106) - the proxy's check of a caller, which asks `standing` and `can`"
  - "[code://packages/server/src/proxy/listener.ts#L418](../../../../packages/server/src/proxy/listener.ts#L418) - `policyFor`, which charges a call to the principal's id"
---

## Goal

A signed-in person mints tokens for their own use, over their connection.
Each token holds a subset of the person's grants, such as `proxy:write` alone for a laptop.
A person holds several tokens, up to a limit the host sets.
A person lists and revokes their own tokens.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
person signs in -> token mint (grants, label) -> secret shown once -> hash in the tokens file -> a call with the secret -> verify finds the token -> principal with the grants that the token and the person both hold
```

### Gaps

- A record holds one hash, and a mint replaces it.
- Only a caller with `user:write` mints, and the token has every grant of the person.
- A principal has no grants narrower than its person's.
- There is no list of tokens, no label, no expiry and no revoke of one token.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A person mints tokens over their connection, more than one each | Softov, 2026-10-18, "the user be able to generate as many as wanted (or like limited to host key...)" | 04, 05 |
| A token holds all of the person's grants or a subset of them | Softov, 2026-10-18, "All access or a refined set of access?" | 01 |
| A token can be limited to proxy calls and used on another computer | Softov, 2026-10-18, "a user could generate a token that only make proxy calls. and use on its computer" | 02 |
| A token never holds a grant its person does not hold | (defaulted: the same rule as a bot in plugin 52 p10, "the bot can't do more than its owner") | 01, 02 |
| The host key `tokensPerPerson`, default 10, and a mint past it is refused | Softov, 2026-10-19, "How many tokens may one person hold?": "Host key, default 10" | 01, 03 |
| An optional expiry at mint, and no expiry by default | Softov, 2026-10-19, "Does a token expire?": "Optional expiry at mint" | 01, 02 |
| An operator lists and revokes a person's tokens with `user:write`, bounded as `user token` is, and sees labels and grants, never a secret | Softov, 2026-10-19, "Can an operator list and revoke a person's tokens?": "Yes, with user:write" | 04, 05 |
| Each check reads the grants that the person and the token both hold now | Softov, 2026-10-19, "When a person loses a grant, does a token that holds it lose it too?": "Yes, checked each call" | 02 |
| The one token on a user record stays as the person's full token, and the users file does not change | Softov, 2026-10-19, "The one token a user record holds today: does it stay, as the person's full token?": "Stays as the full token" | 01 |
| A token without `grants` holds every grant of its person, read at each check | (defaulted: "all access" from the 2026-10-18 answer, kept live rather than copied) | 01, 02 |
| A token signs in with its person's id, so usage and policies charge the person | (defaulted: a token is the person on another computer) | 02 |
| The three calls on `Users` are optional, as `watch` is | (defaulted: a directory that is not a file may keep no tokens) | 01 |
| `ahpd user rm` removes the person's tokens too | (defaulted: a person added again with the same id gets no old token back) | 01 |
| Commands `ahpd token mint`, `list` and `rm`, and the AHP methods `x-ahpd/tokens/mint`, `list` and `revoke` | (defaulted: the HTTP API and the AHP connection, as `vault` and `usage` serve both) | 04, 05 |
| The tokens file is `<users file without .json>.tokens.json` in the folder of the users file, with no configuration key | Softov, 2026-10-19, "host/108: where does the host keep the tokens a person mints?": "Beside the users file (Recommended)" | 01 |
| A minted token cannot mint, list or revoke tokens; only the person's full sign-in can | Softov, 2026-10-19, "host/108: may a minted token mint, list or revoke tokens?": "No, full sign-in only (Recommended)" | 04, 05 |
| A minted token id never starts with `-`, so `token rm` takes it | Softov, 2026-10-20, "Main is red from the flaky token-command test (expected 400 to be 200). What should I do about it?": "Record and fix it (Recommended)" | 07 |

## Proposed architecture

- **Data flow** - a mint writes a `TokenRecord` with the hash to the tokens file. `verify` reads the users file and the tokens file, and compares the hash with each entry in one pass.
- **State flow** - each call reads the tokens file, as it reads the users file. A revoke or an expiry is in force on the next call.
- **Layer responsibilities** - sdk: the tokens file, the limit, `verify` and the narrowed principal, and the AHP methods · server: the key, the commands and the wiring.
- **Source-of-truth files** - [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the directory keeps tokens](task-01-the-directory-keeps-tokens.md) | done | - |
| [02 - a token signs in narrowed](task-02-a-token-signs-in-narrowed.md) | done | 01 |
| [03 - the tokens per person key](task-03-the-tokens-per-person-key.md) | done | 01 |
| [04 - the token commands](task-04-the-token-commands.md) | done | 02, 03 |
| [05 - the token methods over AHP](task-05-the-token-methods-over-ahp.md) | done | 02 |
| [06 - the docs name tokens](task-06-the-docs-name-tokens.md) | done | 04, 05 |
| [07 - a token id never starts with a hyphen](task-07-a-token-id-never-starts-with-a-hyphen.md) | done | 04 |

## Risks and tradeoffs

- `verify` reads a second file on each call - the file is small, and the users file is already read the same way.
- A token without `grants` follows its person, so a new role widens it - that is "all access", and a narrow token names its grants.
- A stolen token works until a revoke or its expiry - the person sees it in `token list` and revokes it.

## Resume state

- **Done so far:** draft written 2026-10-18. Questions answered and tasks written 2026-10-19. Task 01 implemented 2026-10-19: the tokens file, the three `Users` calls and their tests. Task 02 implemented 2026-10-19: a token signs in narrowed, and revoke and expiry land on the next call. Task 03 implemented 2026-10-19: the `tokensPerPerson` key. Task 04 implemented 2026-10-19: `token mint`, `token list` and `token rm`, at the terminal and over `/api`. Task 05 implemented 2026-10-19: `x-ahpd/tokens/mint`, `list` and `revoke`, with the same checks as the commands. Task 06 implemented 2026-10-19: the server and sdk docs name the commands, the methods and `tokensPerPerson`. Task 07 implemented 2026-10-20: a minted id never starts with `-`, so `token rm` takes every id a mint hands out.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:**
  - A token's secret is shown once, and only its hash is kept, as `mint` does today.
  - `verify` compares every hash in one pass and keeps the match, so the time it takes does not tell which hash matched.
  - A token never holds a grant its person lacks: a mint refuses one, and `can` asks the person and the token on each call.
  - A revoked or expired token fails on the next call: `standing` and `can` read the tokens file each time.
  - `ahpd user rm` removes the person's tokens, or a person added again with the same id gets the old tokens back.

## Final verification checklist

- [ ] Every task is `done` or `dropped`.
- [ ] A `proxy:write` token reaches the proxy from another computer, and is refused at the HTTP API.
