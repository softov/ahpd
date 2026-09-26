---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Rewritten 2026-09-26. History is in `git log`; the reasoning behind a decision or a plan is in its own `implemented.md`, `deferred.md` or decision file. This file is current state, what still has to be checked, and what is open.

## Read this first

- **`/github/ahpd` `main` is at `7a7e9d1`** and pushed; `origin/main` is the same commit. `v0.7.0` is the last tag, and the six commits after it are unreleased: a dev container says what it is doing and why it ended, a message's origin reaches every turn, a `!command` runs on every road a turn takes, a cofold turn that cannot start fails the turn and not the daemon, the devtunnel CLI no longer holds the event loop, and the plans below.
- **The working tree is not clean, and most of it is dsh's.** dsh is implementing `claude/04`, `daemon/04`, `daemon/05`, `plugin/14` and `plugin/15` in this tree. Do not stash, revert or commit its changes; review them when it reports back.
- **Ours, uncommitted and awaiting Softov's approval:** an automation starts its first turn on the model its session template names. `StartSession.model` in `packages/sdk/src/types/automations.ts`, copied from `session.model` in `packages/sdk/src/automations.ts`, passed through `modelIn(wanted.model)` in `startForAutomation` in `packages/sdk/src/host.ts`, and held by "starts the first turn on the model the session template names" in `test/automations.test.ts`. Also ours: nine `.project` files whose frontmatter did not parse as YAML now quote the offending value, and this file.
- **Suite:** 93 files / 1201 tests and `pnpm typecheck` green on the working tree, dsh's changes included.
- **`/github/ahpc`** is at `136fd3f`, pushed. `@softov/ahpc` is `0.5.1` on npm with unreleased commits after it. Its tree has another session's uncommitted `.project` changes.
- **`/github/ahpapp`** is at `86c4d23`, pushed. Its tree is dirty with other people's work, and among it is our uncommitted plan `plans/container/01-a-container-is-there-after-a-relaunch`.

## Checks still to perform

1. **The upgrade a 0.6.x operator actually meets.** Moved to the next release: no machine here had 0.6.x installed. The fresh install is verified.
2. **VS Code, with the seeded picker.** The chip should read `This host` or a machine's name, and appear once.
3. **ahpapp against the published packages**: the computer picker, and the dev container relay with `devcontainer.plugins` against a real container.
4. **`docs/COMPUTER.md`** was rewritten on 2026-09-25 and Softov is reading it. `packages/computer/README.md` is stale and waits on whether it becomes the full user doc.

## Open work

1. **Cofold has no default model.** With no `model` in the session, the package options or `~/.config/cofold/config.json`, `connectionOf` in `packages/agent-cofold/src/agent.ts` throws and the turn fails. Softov chooses: fall back to the first model the endpoint's catalogue lists, or require `model` in the cofold configuration and say so. The first needs the catalogue before `modelOf` returns, which is synchronous today while the catalogue is fetched with a five-second timeout.
2. **A queued `!command` still goes to the agent.** `chat/pendingMessageSet` with `kind: 'queued'` in `packages/sdk/src/host.ts` calls `session.queue` with the text, and each backend drains its queue through `begin`. `chat/turnStarted`, a resumed session and a new chat's first message go through `beginOrRun`. The backends already hold a queued command when `ran` is called mid-turn, but `ran` neither replaces an entry by id when a queued message is edited nor carries `queuedMessageId` when it runs at once, so routing the queue through it is a change in all four backends, two of which dsh is editing.
3. **Review dsh's work** on `claude/04`, `daemon/04`, `daemon/05`, `plugin/14` and `plugin/15`. Its task files say `status: implemented`, which is not a task status; `done` is.
4. **`container/02` is parked**: VS Code does not list the ahpd dev tunnel, so task 01 is blocked and task 02 records what the try found missing.
5. **`container/01`'s ahpapp half is built, awaiting Softov's check.** Once checked, close `container/01` with its `implemented.md`.
6. **Planned and not started:** `plugin/16` (a disposable machine), `container/03` (a dev container is a computer) and `container/04` (a cofold session in a computer runs an ahpd inside it).
7. **Verify a JWT locally.** The last deferred item of `host/08`.
8. **`@ahpd/computer`'s `kvm` runtime** and the per-session gate on the machine tools, from [`research/a-computer-three-things.md`](../research/a-computer-three-things.md).
9. **The upstream backlog in `UPSTREAM.md`.** The next pass starts from VS Code `832cf23c5`.

Next free plan numbers: `daemon` 06, `host` 19, `claude` 05, `plugin` 17, `container` 05.

## Constraints worth knowing before touching any of that

- **A bare plugin name resolves from the configuration directory only.** `createRequire` against `$XDG_CONFIG_HOME/ahpd/package.json`, so a global install is invisible to it, and `--config-file` does not move it. A path spec is tried against the working directory and then the configuration directory; a `file:`, `npm:`, `jsr:`, `https:` or `data:` spec is passed to the runtime untouched.
- **The gate has two boundaries, and they are not one.** A *command* is checked in `handle` against `NEEDS`/`capabilityFor`; a *dispatched action* is checked at the top of `applyDispatch` against `dispatchNeeds`, keyed by the channel and refusing with `rejectionReason`, because a notification carries no id to put a `-32007` in. A notification that acts is a new hole unless it is added to the second one.
- **A grant is a subject and a verb.** `file:write` is what must stay open or VS Code cannot save; `computer:write` is named or not had, and `file:write` confers no scheme. `*` stands in either position and `admin` is `*:*`. `NEEDS`, `dispatchNeeds` and `capabilityFor` in `host.ts` are the three places a method's pair lives, and the staleness test holds the first of them.
- **The door is a door.** A socket admitted on the deployment's `connectionToken` is root and `authenticate` can neither replace nor revoke it. Any other token opens the door and names nobody, so `authenticate` is what authorizes; `trustToken` on the host or on a record is the opt-out, off by default.
- **A role is read on every command.** `Users.verify` hands out a principal that answers `standing()` and `can()` by reading the file again, so removal refuses the next command with `-32007` and a changed role with `-32009`. A principal built by hand carries no `standing` and is treated as still standing.
- **A session names a machine through the plugin-contributed `computer` key**, and an empty value is this host rather than a machine called `''`. A backend that cannot reach the machine must refuse rather than run on the host: `refuseComputer` in `packages/sdk/src/computers.ts`, held by `test/computer-refusal.test.ts`.
- **`defaultShell` is the connection's**, in `Connection.config` under `PER_CONNECTION`; `rootState` drops those keys from the host's half and overlays the connection's own.
- **One envelope per dispatch, read per connection.** `test/conformance.test.ts` pins exactly one echo per dispatch, and `serverSeq` and the replay buffer are one per host. What a connection reads in an envelope is `seenBy` in `host.ts`, which the live broadcast and both replay paths call; a per-connection view of an action goes there.
- **An unconfigured daemon is inert.** No `users` file means no principal anywhere and nothing refused, so a change that makes an unconfigured host stricter is a change to the contract.
- **The review's lesson.** A handler or a notification added later is unprotected until somebody remembers it. The staleness test asserts every handler is classified; the dispatch gate and the `PER_CONNECTION` split have no such guard.

## Environment and release notes that still cost time

- **The publish list and the tag check are one list**, `PUBLISHED` in `release.yml`, in dependency order with `sdk` first and `server` last. A name npm has never seen still needs one token publish before OIDC can stage it, and that bootstrap stub must be at a version **below** the tag's, or the release skips the package as already published. An already-staged version answers `E409`, which the loop treats as done.
- **Nothing is installable until each version is approved on its npm page**, in dependency order. A tag can be moved while its release is only staged, and force-pushing it re-runs the workflow, which the resumable staging loop makes safe.
- **CI runs `pnpm test` before `pnpm build`, so the suite must pass with no `packages/*/dist`.** A test that lists a workspace package by its directory reads `missing` in CI and `ready` in a built checkout.
- **A manifest change needs `pnpm install --no-frozen-lockfile` once**, because `CI=true` implies a frozen lockfile. `pnpm-lock.yaml` carries one importer per package, and a package committed without its importer breaks `--frozen-lockfile` for everybody.
- **A plugin whose `ahpd.entry` is `dist` must be rebuilt after its source moves**, or a daemon that loads it by name gets a stale build and advertises it faithfully. `pnpm build` names all eight packages now.
- **In `--stdio` mode everything the daemon says goes to stderr**, because stdout is the protocol channel. A test that reads its announcement reads `said`, not stdout.
- **`PNPM_HOME` pointing at a read-only store has broken `pnpm install` here before.** It did not reproduce on 2026-09-25; if it returns, the escape is `unset PNPM_HOME; export HOME=/github/.home CI=true` and driving vitest directly.
