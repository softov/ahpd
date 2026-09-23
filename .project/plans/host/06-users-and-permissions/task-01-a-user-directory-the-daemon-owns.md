---
title: A user directory the daemon owns
status: done
depends: []
layer: "packages/sdk, packages/server"
refs:
  - "[code://packages/sdk/src/sessions.ts#L109](../../../../packages/sdk/src/sessions.ts#L109) - `fileSessions`, the shape a file-backed port takes here: a factory returning the port, with the path in its options"
  - "[code://packages/sdk/src/listen.ts#L58-L70](../../../../packages/sdk/src/listen.ts#L58-L70) - `same`, the constant-time compare to reuse for a token hash"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the config keys, where `users` joins"
  - "[code://packages/server/src/main.ts#L317-L340](../../../../packages/server/src/main.ts#L317-L340) - the verb dispatch, and `plugin` as the precedent for a verb with sub-verbs"
  - "[code://packages/server/src/main.ts#L140-L160](../../../../packages/server/src/main.ts#L140-L160) - the help text and the sentence saying every flag is also a config key"
---

## Objective

`ahpd` can be told about people: a file holds one record per person with an id, roles and a hashed token, a `Users` port answers whether a token belongs to somebody, and four CLI verbs manage the file without a running daemon.
Nothing in the host uses any of it yet.

## Files

- `CREATE: packages/sdk/src/types/users.ts` - `Capability`, `Principal`, `Users` and `UserRecord`.
- `CREATE: packages/sdk/src/users.ts` - `fileUsers({ path })`, the file-backed implementation.
- `UPDATE: packages/sdk/src/types/index.ts` - export the four types, the way `ResourceProvider` had to be exported for `plugin/08`'s fixture to name it.
- `UPDATE: packages/sdk/src/index.ts` - export `fileUsers`.
- `UPDATE: packages/server/src/config.ts` - a `users?: string` key, the path to the file, absent by default.
- `UPDATE: packages/server/src/main.ts` - a `user` verb with `add`, `rm`, `list` and `token`, beside `plugin`, and the help text for it.
- `CREATE: test/users.test.ts` - the directory's own cases.

## Steps

1. Write the types.
   - `type Capability = 'read' | 'write' | 'session' | 'terminal' | 'automation' | 'diagnostics'`.
   - `interface Principal { id: string; roles: string[]; can(capability: Capability): boolean }`, so the gate asks a question rather than reading a set and deciding for itself.
   - `interface UserRecord { id: string; roles: string[]; token: string }`, where `token` is the hash and never a secret.
   - `interface Users { verify(token: string): Promise<Principal | undefined>; list(): Promise<Omit<UserRecord, 'token'>[]>; add(id: string, roles: string[]): Promise<void>; remove(id: string): Promise<boolean>; mint(id: string): Promise<string> }`. `mint` answers the plaintext once and stores only its hash.
2. Write `fileUsers`. The file is JSON with two keys: `roles`, a record of name to capability list, and `users`, a list of `UserRecord`. `admin` and `member` are built in and need no entry: `admin` is every capability, `member` is `read`, `write`, `session` and `terminal`. A role named in the file wins over a built-in of the same name, and a role a record names that does not exist contributes nothing and is logged rather than throwing, so one bad line does not lock everybody out.
3. Hash with SHA-256 over the token's UTF-8 bytes, hex, stored as `sha256:<hex>` so the algorithm is on the record and a second one can be added later. Compare with the same constant-time `same` that `listen.ts` uses, exported for reuse rather than copied (decision 2 says outright that a password hash is wrong here: the token is 256 bits of randomness and the cost would be paid on every sign-in for nothing).
4. `mint` generates 32 bytes from `randomBytes`, encodes them base64url, and writes the hash. The plaintext is returned and never stored, so `token` re-run for the same person replaces the old one rather than reading it.
5. Add the `user` verb, mirroring `plugin`'s shape: an unknown sub-verb writes one sentence to stderr and exits 2. `add <id> --role <name>` (repeatable, defaulting to `member`), `rm <id>`, `list`, `token <id>`. `token` writes the secret to stdout alone, on one line, so it can be piped, and writes the warning that it is shown once to stderr. Every verb reads the path from `--users` or the config key, and says so plainly when neither is set rather than creating a file somebody did not ask for.
6. Add `users` to the config key list in the help text's sentence, and a line per verb to the help.
7. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/users.test.ts`:
  - a minted token verifies and answers a principal with the record's roles; a token one character different does not;
  - `admin` can every capability and `member` cannot `automation` or `diagnostics`;
  - a role defined in the file overrides the built-in of the same name, and a role named by a record but defined nowhere contributes no capability and does not throw;
  - `mint` twice gives two different secrets and only the second verifies;
  - `remove` answers `true` once and `false` after, and the removed record's token stops verifying;
  - a file that is absent, empty or malformed answers no principal for every token rather than throwing, because a broken file must fail closed.
- By hand: `ahpd user add a --role admin`, `ahpd user token a`, `ahpd user list`, `ahpd user rm a`, and `ahpd user bogus` exiting 2.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green. No host behaviour changes in this task, so no existing case moves.

## Resume


Done 2026-09-23, as written. See [implemented.md](implemented.md).
