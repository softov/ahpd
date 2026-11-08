# Users

Give each person their own token and role, instead of one shared token.

## Turn it on

```json
{ "users": "users.json" }
```

or `--users <file>`. The path is relative to `config.json`'s folder.

## Add a person

```bash
ahpd user add ana --role member
ahpd user token ana --url
```

`--url` prints the whole `ws://…?tkn=…` address, once. Send it to them. Without `--url` it prints the token alone, for a script. Minting again replaces the old token.

| Command | Does |
| --- | --- |
| `ahpd user list` | Show everyone and their grants |
| `ahpd user add <id>` | Add a person. `guest` with no `--role` |
| `ahpd user token <id>` | Mint their token, shown once |
| `ahpd user rm <id>` | Remove them, and their tokens |
| `ahpd user member <id> <team[:project]>...` | Teams and projects their work may be charged to |
| `ahpd user primary <id> [team[:project]]` | Where work that names none is charged |
| `ahpd team add <id>`, `ahpd project add <id>` | Name a team or project |
| `ahpd token mint [--user <id>] [--team <team>] [--scope <team[:project]>]` | Mint a token of their own, shown once |
| `ahpd token list [--user <id>] [--team <team>]` | Show tokens, without any secret or hash |
| `ahpd token rm <token id> [--user <id>] [--team <team>]` | Revoke one token |

`user add` also takes `--issuer <name>`, `--membership <team[:project]>` and `--primary <team[:project]>`.

## Tokens of their own

A person signs in and mints tokens for their own use, or an operator mints one for them. Each token may be limited to some of the person's grants, so a laptop can carry `proxy:write` and nothing else:

```bash
ahpd token mint --user ana --grant proxy:write --label laptop
```

```
<secret>
Shown once. This host keeps only its hash. Revoke it with: ahpd token rm <id>
```

The secret goes to stdout and the warning to stderr, so a script can read the credential alone. `--url` prints the whole `ws://…?tkn=…` address instead. The host keeps only the hash, in the tokens file beside the users file: `users.json` and `users.tokens.json`.

Without `--grant` the token holds every grant its person holds, now and later. A token never holds a grant its person does not hold. A mint refuses one, and each call reads the person's grants again, so a grant taken from the person is taken from the token too. `--expires` takes a date such as `2026-12-31` or an ISO timestamp; without it a token does not expire. A revoked or expired token fails on its next call, with no reconnection.

`--scope <team[:project]>` writes the team and project its calls are charged to, so a client given only the key and a base URL is charged where the operator said rather than where the person's primary is. The mint refuses a scope the person is not in now, and one written `team:*`. A call made with the key is charged to its scope when it names none, and refused with 403 when it names another; the scope is checked at every call, so a membership taken away stops the key without a revoke.

A token also carries spend and call limits of its own, written `amount:measure:period`. The measures are a `model` policy's - `usd`, `tokens` and `calls` - and one key has one total, so every limit is `shared`:

```bash
ahpd token mint --user ana --limit 5:usd:day --limit 100:calls:day --label laptop
```

A proxy call made with the key is refused once one of its limits has no room, with the key's sentence rather than a row's: `token:<id> has no room: 2 / 2 calls this day`. A key's limits only narrow what the policies allow: they never allow a model no policy allows, they never stop the charge to a person's or a team's limits, and they hold for a person who holds `*:*`, and with `policies.check` off. They need a usage store to be counted, because the means of counting is the same one policy limits use.

A token also carries meta of its own, written `--meta name=value` once per entry, cut at the first `=`. A name is 1 to 64 characters and a value at most 256, and a token holds 32 entries at most. A call made with the key writes the key's entries on its usage record, and adds the call's own, as LiteLLM's `spend_logs_metadata`: a name the key holds keeps the key's value. See [The model proxy](PROXY.md).

A minted token cannot mint, list or revoke tokens. Sign in with the person's full token for that. `ahpd user token <id>` still mints that one full token, and the tokens a person minted stay.

A team holds a key of its own, minted with `--team` in place of `--user`. It belongs to no person, so no person's departure takes it away, and every call made with it is charged to `team:<team>`:

```bash
ahpd token mint --team backend --grant proxy:call --label ci
```

A team key opens the proxy and no other door: the websocket, `/api` and the daemon's own port refuse it. It holds `proxy:call` or `proxy:models`, or both, and nothing else. Its scope is its team unless `--scope` names one of that team's projects. Each call is checked against the team, and a `user:` policy row never holds it. It works while its team is in the users file. Removing a team removes its keys too, so a team added back with the same name has none. Root and a caller who holds `user:write` list and revoke one. To mint one, a caller who is not root also needs `proxy:call`. `--team` with `--user` is refused.

At a terminal `--user <id>` names whose tokens they are, and `--team <team>` names a team's keys instead. `token list` without either lists everybody's; `token mint` and `token rm` need one of them, because a terminal has nobody signed in. Over `/api` a person's token acts for that person, and `--user` needs `user:write` and is bounded by that person's grants; `--team` needs `user:write` too. The host mints at most `tokensPerPerson` live tokens per person or team, ten unless configured otherwise; an expired token does not count.

`ahpd token list` shows the id, the label, the team for a team key, the grants, the scope, the meta, the creation date, the expiry and the limits of each token, and never a secret or a hash.

## Roles

| Role | Can |
| --- | --- |
| `admin` | Everything |
| `member` | Read and write files, sessions and terminals; use the proxy; run the host's tools at `/mcp`; trust a folder |
| `guest` | Read sessions and automations |

`mcp:call` is the door at `/mcp`, which serves the host's tools that need no session to a person's MCP client. `member` holds it, and `admin` holds everything, which includes it. Each tool checks its own grants again, so a caller may list only what they may run. A team key cannot hold it. See [MCP](MCP.md).

You can define your own roles in the file. See [sdk/USERS.md](../sdk/USERS.md).

## Sign in with GitHub or OpenID Connect

```bash
ahpd start --issuer github --resource https://ahpd.example.com/
```

A token from the issuer is accepted for a person whose record names it. See [sdk/AUTHENTICATION.md](../sdk/AUTHENTICATION.md#an-issuer).

`--issuer-verify` (key `issuerVerify`) says how that token is checked. `userinfo`, the default, asks the issuer who the token belongs to. `jwt` checks it here against the key set the issuer publishes. The issuer is not asked, and the token's own `exp` ends the sign-in. `auto` checks here first, and asks the issuer for a token the keys cannot answer. See [sdk/AUTHENTICATION.md](../sdk/AUTHENTICATION.md#checking-a-token-here).

## Require the issuer

By default a person's token signs them in at the door, the same as `authenticate` would. `--require-issuer` (key `requireIssuer`) asks for the issuer's token instead: their own token only opens the socket, and `authenticate` accepts the issuer's alone.
