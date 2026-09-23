---
title: The host advertises itself and verifies a person's token
status: done
depends:
  - task-01-a-user-directory-the-daemon-owns.md
layer: "packages/sdk, packages/server"
refs:
  - "[code://packages/sdk/src/host.ts#L2005-L2014](../../../../packages/sdk/src/host.ts#L2005-L2014) - `resourcesOf`, which appends `options.github.resource` to every agent and gains one more the same way"
  - "[code://packages/sdk/src/host.ts#L2015-L2024](../../../../packages/sdk/src/host.ts#L2015-L2024) - `lent`, which spends any connection's token and must not spend a person's"
  - "[code://packages/sdk/src/host.ts#L4130-L4140](../../../../packages/sdk/src/host.ts#L4130-L4140) - `metadataFor`, which answers the RFC 9728 record an error or notification carries"
  - "[code://packages/sdk/src/host.ts#L4325-L4380](../../../../packages/sdk/src/host.ts#L4325-L4380) - `expire`, `forgetExpiry` and the `auth/required` notification"
  - "[code://packages/sdk/src/host.ts#L5100-L5190](../../../../packages/sdk/src/host.ts#L5100-L5190) - the `authenticate` handler, its resource check, its revoke and its expiry handling"
  - "[code://packages/sdk/src/types/host.ts#L405-L441](../../../../packages/sdk/src/types/host.ts#L405-L441) - `Connection`, which gains `principal` beside `tokens`"
  - "[code://packages/sdk/src/types/host.ts#L146](../../../../packages/sdk/src/types/host.ts#L146) - `HostOptions.github`, the optional host-level port `users` is modelled on"
  - "[code://packages/server/src/main.ts#L455-L470](../../../../packages/server/src/main.ts#L455-L470) - where the ports reach `createHost`"
---

## Objective

A host given a `Users` port advertises one protected resource of its own on every agent, and a client that pushes a token for that resource either gets a principal attached to its connection or a `-32007`.
A host given no port advertises nothing new and behaves exactly as it does today.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:146` - `users?: Users` beside `github`, documented as the directory that turns a credential into a person, and absent meaning there are no people.
- `UPDATE: packages/sdk/src/types/host.ts:405-441` - `Connection.principal?: Principal`, with the comment saying it is per connection for the same reason `tokens` is, and that it dies with the socket.
- `UPDATE: packages/sdk/src/host.ts:2005-2014` - `resourcesOf` appends the login record when `options.users` is set, exactly as it appends `options.github.resource`.
- `UPDATE: packages/sdk/src/host.ts:2015-2024` - `lent` skips the login resource, so one person's credential is never spent as a backend's.
- `UPDATE: packages/sdk/src/host.ts:5118-5190` - `authenticate` gains one branch, taken only for the login resource.
- `UPDATE: packages/sdk/src/host.ts:4325-4380` - the expiry path detaches the principal when the login resource is what expired.
- `UPDATE: packages/server/src/main.ts:455-470` - build `fileUsers` from the config key and hand it in, or hand in nothing.
- `CREATE: test/users-host.test.ts` - the host half.

## Steps

1. Define the login resource beside the other constants: an RFC 9728 record whose `resource` is `ahpd://users` by default, with `resource_name` naming the host and `authorization_servers` pointing at the documentation rather than an OAuth endpoint, which decision 2 says is the one place self-issuing shows through the standard shape. Make the id configurable on the port's options, because `ahp-server` will front many hosts and two of them must not share one id.
2. Append it in `resourcesOf` when `options.users` is set. Nothing else advertises it, because the protocol's discovery is per agent and `resourcesOf` is the one place that decides what an agent's list is.
3. Add the branch to `authenticate`, placed **after** the existing resource check so an unadvertised resource still answers `-32602`, and **before** the pass-through so nothing else changes:
   - `resource === login.resource` and the token is not empty: `await options.users.verify(token)`. Nothing back is `-32007` with `data.resources: [login]`, which the specification names as the answer to an invalid token. A principal back is set on `connection.principal`, and the credential is **not** put in `connection.tokens`, because it is not a credential the host spends on anything.
   - `resource === login.resource` and the token is empty: clear `connection.principal` and answer `{}`, which is the revoke the handler already implements for a token.
   - any other resource: unchanged, including the unverified pass-through that `host.ts:5112-5117` describes deliberately.
4. Fire `authenticated` for a successful sign-in as the handler already does, and log the person's id rather than the client's self-asserted `clientId`, since that is now the first thing about a connection that was actually checked.
5. In the expiry path, when the resource that expired is the login resource, clear `connection.principal` before the `auth/required` notification goes out, so a client is told to sign in again and the gate agrees with the notification.
6. Wire it in `packages/server/src/main.ts`: `users: config.users !== undefined ? fileUsers({ path: config.users }) : undefined`, beside `github: githubPullRequests()`.
7. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/users-host.test.ts`:
  - a host with no `users` port advertises exactly the resources it advertises today, which is the proof this is inert unconfigured;
  - a host with the port lists the login record on every agent's `protectedResources`;
  - `authenticate` with a good token attaches a principal and fires `authenticated`; with a bad one answers `-32007` carrying `data.resources` with the login record in it;
  - `authenticate` with an empty token for the login resource clears the principal and answers `{}`;
  - a token for a backend's resource is still held unverified and still reaches a session, which is the proof the Anthropic path did not move;
  - `lent` does not answer a person's credential for the login resource, asserted by giving one connection a principal and asking for the resource on the host's behalf;
  - an `expiresIn` that passes clears the principal and sends `auth/required` with `reason: 'expired'`.
- `test/host.test.ts` unchanged and green, which is the proof an unconfigured host did not move.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume


Done 2026-09-23, as written. See [implemented.md](implemented.md).
