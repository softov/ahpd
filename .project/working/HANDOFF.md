# Handoff: where `ahpd` stands, and what is pending

Rewritten 2026-09-25, the day `v0.7.0` went out, replacing everything this file said about the work that shipped in it. History is in `git log`; the reasoning behind a decision or a plan is in its own `implemented.md`, `deferred.md` or decision file. This file is current state, what still has to be checked, and what is open.

## Read this first

- **`/github/ahpd` `main` is at `6bce9dd`**, "Bump every package to 0.7.0, and the SDK range with it", and it is **pushed**. `origin/main` is the same commit. The working tree is clean apart from untracked `.scratch/devc-demo`, a dev container fixture from the container work.
- **`v0.7.0` is tagged, released and live.** All eight packages are on npm at `0.7.0`, staged with provenance by `.github/workflows/release.yml` in one pass and approved: `@ahpd/sdk`, `@ahpd/agent-claude`, `@ahpd/agent-cofold`, `@ahpd/agent-acp`, `@ahpd/agent-pi`, `@ahpd/computer`, `@ahpd/tunnel-devtunnel`, `@ahpd/server`. The last three published for the first time, bootstrapped with a `0.0.1` stub that is still in their version list.
- **Suite:** 84 files / 1104 tests, with `pnpm typecheck`, `pnpm boundary` and `pnpm build` green at `6bce9dd`, and `pnpm install --frozen-lockfile` clean.
- **`/github/ahpc`** is at `a5987f2`, one commit **ahead of `origin/main` and unpushed**: the picker fix below. `@softov/ahpc` is `0.5.1` on npm with **six unreleased commits**, four of them another session's sign-in and token-file work. That repository's tree is dirty with that session's files.
- **`/github/ahpapp`** is clean at `4d2f5c7`, not touched this session.

## What 0.7.0 changes for somebody who already had it

- **The daemon bundles no agent.** `npm i -g @ahpd/server` upgraded over 0.6.x is a daemon that exits 1 until its configuration names a backend, and the update check will offer that upgrade to every running 0.6.x host. The sentence it exits with names the configuration file and the directory to `npm i` the plugin into. Decision `the-daemon-bundles-no-agent`.
- **A contributed session key's picker is seeded** at `resolveSessionConfig`, so a client draws a label for the value it is holding instead of a raw `computer://box` or an empty chip. Decision `a-contributed-picker-is-seeded-when-a-config-is-resolved`.
- **A host inside a dev container must be given plugins of its own.** `devcontainer.plugins` has no default, an empty list is not advertised as available, and `connect` refuses before anything is built.
- **`@ahpd/computer` is public.** What it does with Docker, and what an operator has to allow it, is now documentation strangers read.
- **Every plugin's `peerDependencies["@ahpd/sdk"]` is `^0.7`.** `^0.6` does not match `0.7.0`, so a 0.6.x plugin beside a 0.7.0 daemon is refused by the loader's range check, by name, before it is imported.

## Checks still to perform

1. **The upgrade a 0.6.x operator actually meets.** Moved to the next release: no machine here had 0.6.x installed. The fresh install is verified.
2. **VS Code, with the seeded picker.** The chip should read `This host` or a machine's name. The chip appearing only once is still unconfirmed. The sign-in prompt is fixed by `host/16`, implemented and awaiting this check: a root or signed-in connection is now told the host's sign-in resource is `required: false`, so VS Code on the deployment token reaches `createSession`. With a `users` directory and the issuer down, a root connection and a personal-token connection must read different `required` from the same host, in the snapshot, the live `root/agentsChanged` and a reconnect replay.
3. **ahpapp against the published packages**: the computer picker, and the dev container relay with `devcontainer.plugins`. `daemon/03` is implemented: `ahpd plugin install` installs into `~/.config/ahpd` and names it in `config.json`, and the dev container's install step runs `ahpd plugin install --no-enable` for every npm-named entry, so `"plugins": ["@ahpd/agent-cofold"]` no longer exits on startup. The relay itself is still to be run against a real container.
4. **`docs/COMPUTER.md`** was rewritten on 2026-09-25 (shorter, one paragraph per line, security in one section) and Softov is reading it. `packages/computer/README.md` is stale (it says nothing under `computer:` is written) and waits on whether it becomes the full user doc.

## Open work

1. **A real dev container run for `daemon/03`**: a session with `"plugins": ["@ahpd/agent-cofold"]` and no mounted checkout. The plan is built and the launcher is tested against the fake CLI only.
2. **`host/18` is planned, for dsh**: a fixed key picked in VS Code's New view (the computer) restarts the session before its first turn instead of being dropped, and a running session shows its fixed keys as read-only chips.
3. **`container/01`'s ahpapp half**: drawing the Dev Container CLI's own output while a container starts.
4. **ahpc has unreleased commits**, and `a5987f2` plus `136fd3f` (the token-file work) are committed and not pushed. The push was blocked by the permission check and waits on Softov.
5. **Verify a JWT locally.** The last deferred item of `host/08`: check a token against the issuer's key set instead of asking `userinfo`. Does not help GitHub, which issues opaque tokens.
6. **`@ahpd/computer`'s other two thirds**: a `kvm` runtime, the per-session gate on the machine tools proposed in [`research/a-computer-three-things.md`](../research/a-computer-three-things.md), and an ephemeral machine destroyed when its session ends.
7. **The upstream backlog in `UPSTREAM.md`** was triaged on 2026-09-26: eight Pass 4 boxes were already built and are ticked, the empty round is planned as `claude/03`, the terminal auto-approver and the turn diagnostics are ideas, and the rest is recorded as not possible from a host or not a host feature. The next pass starts from VS Code `832cf23c5`.

Closed on 2026-09-26: `host/16` (a root or signed-in connection is told sign-in is not required, checked by Softov in VS Code) and `daemon/03` (`ahpd plugin install` and `remove`, after review fixes: `plugins` gets the package name without its version, the container installs with the `host` command and skips what it already has).

Closed on 2026-09-25: host configuration has its own grant (`host/17`: `config:write` for host-wide root keys and `replace`, a sign-in for your own `defaultShell`); the npm listing is correct; route one (Claude in a machine through `spawnClaudeCodeProcess`) was already built in `packages/agent-claude/src/spawn.ts`; `@ahpd/agent-pi` is in the README; `plugin/13` has its `implemented.md`, with a real-Docker run; the `defaultShell` echo reaches only its sender (`seenBy` in `host.ts`); the worktree tests wait on the dirty check instead of the clock. `node-pty` needs `--allow-scripts=node-pty` on npm 12, now in the install docs.

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
