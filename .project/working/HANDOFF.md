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

1. **The npm listing catches up.** The three new packages were published as a stub first, so their page, description and README may lag behind the real `0.7.0` tarball for a while. `npm view @ahpd/computer description` and the package page are the two to look at; if the stub's "Placeholder so this name can be given a trusted publisher" is still showing after the listing settles, the fix is a `0.7.1` for that package, not a re-publish.
2. **The upgrade a 0.6.x operator actually meets.** Not verified on a machine that had 0.6.3 installed globally: update check says 0.7.0 exists, `npm i -g @ahpd/server`, the daemon refuses, the sentence is followed, it starts. The fresh half **is** verified: with `@ahpd/server@0.7.0` and `@ahpd/agent-claude@0.7.0` installed from npm into a config directory and named in `plugins`, the daemon reported `claude: 11 model(s), 67 command(s)`, and the same daemon with no plugins exited 1 with the refusal naming the file.
3. **VS Code, with the seeded picker.** The computer chip should now read `This host` or a machine's name rather than a URI or nothing. Two things were seen there before the seed and are not confirmed fixed: the chip appearing once and then not again, and `Authentication is required to start a session. Please sign in and try again.`, which comes from `modelRequiresAgentAuthentication` (a model whose agent declares an auth resource with `required !== false`) and may be correct behaviour rather than a fault.
4. **ahpapp against the published packages** rather than the checkout: the computer picker, and the dev container relay with `devcontainer.plugins`.
5. **`docs/COMPUTER.md` read as an outsider**, now that the package is installable by anybody: what Docker access it needs, which images it may run, and what a deployment must set before it is safe.

## Open work

1. **The container relay installs a host and not a backend.** `packages/computer/src/devcontainer.ts` runs `npm i -g @ahpd/server@<version>` inside the container and nothing else, but the nested host resolves a bare plugin name against `$XDG_CONFIG_HOME/ahpd` in there, which a global install is not on the path of. So the documented `"plugins": ["@ahpd/agent-cofold"]` is a nested host that exits on startup. `docs/CONTAINERS.md` says so and gives the two ways through today (an absolute path into a mounted checkout, or an image that ships them). The fix is to install the npm-named plugins into the container's own config directory beside the host, pinned to this build's version, leaving path specs to the operator. Testable properly now that `@ahpd/agent-cofold@0.7.0` is on npm.
2. **Route one: Claude inside a machine.** `refuseComputer` is still the honest answer for Claude Code and cofold. The route through the Claude SDK's `spawnClaudeCodeProcess` hook, and the four things it needs, is read but not built: [`research/a-backend-inside-a-machine.md`](../research/a-backend-inside-a-machine.md). Route two, a whole host inside the container, is built and is what `container/01` is.
3. **`container/01`'s ahpapp half**: drawing the Dev Container CLI's own output while a container starts. The rest of that plan is built and verified by hand.
4. **`@ahpd/agent-pi` is published and named in no README table.** Either it gets a row beside the other three agents, or its absence is deliberate and should be written down once.
5. **`plugin/13` is the one built plan with no `implemented.md`.**
6. **ahpc has six unreleased commits** and one unpushed. Its own cut is a separate decision, and four of those commits are another session's.
7. **Verify a JWT locally.** The last deferred item of `host/08`: check a token against the issuer's key set instead of asking `userinfo`. Does not help GitHub, which issues opaque tokens.
8. **A capability for host configuration.** `root/configChanged` is gated as `write`, which is tighter than it was and still not what it is: somebody who may save a file may also change what every session is told.
9. **The `defaultShell` echo residue.** Cosmetic and documented in `docs/USERS.md`; fixing it needs the one-echo-per-dispatch conformance constraint to move first.
10. **`@ahpd/computer`'s other two thirds**: a `kvm` runtime with no hypervisor installed yet, the per-session gate on the machine tools proposed in [`research/a-computer-three-things.md`](../research/a-computer-three-things.md), and an ephemeral machine destroyed when its session ends.
11. **Two wall-clock waits in `test/worktrees.test.ts`** (300 ms and 100 ms), both waiting for a disposal *not* to happen.
12. **The upstream backlog in `UPSTREAM.md`**: the pull request `create-pr` opens recorded as a session artifact, `responseRoundEnded` for a round with no text and no tool calls, and `deferredTitleGeneration` with a `rename_chat` shaped by the session's title strategy.

## Constraints worth knowing before touching any of that

- **A bare plugin name resolves from the configuration directory only.** `createRequire` against `$XDG_CONFIG_HOME/ahpd/package.json`, so a global install is invisible to it, and `--config-file` does not move it. A path spec is tried against the working directory and then the configuration directory; a `file:`, `npm:`, `jsr:`, `https:` or `data:` spec is passed to the runtime untouched.
- **The gate has two boundaries, and they are not one.** A *command* is checked in `handle` against `NEEDS`/`capabilityFor`; a *dispatched action* is checked at the top of `applyDispatch` against `dispatchNeeds`, keyed by the channel and refusing with `rejectionReason`, because a notification carries no id to put a `-32007` in. A notification that acts is a new hole unless it is added to the second one.
- **A grant is a subject and a verb.** `file:write` is what must stay open or VS Code cannot save; `computer:write` is named or not had, and `file:write` confers no scheme. `*` stands in either position and `admin` is `*:*`. `NEEDS`, `dispatchNeeds` and `capabilityFor` in `host.ts` are the three places a method's pair lives, and the staleness test holds the first of them.
- **The door is a door.** A socket admitted on the deployment's `connectionToken` is root and `authenticate` can neither replace nor revoke it. Any other token opens the door and names nobody, so `authenticate` is what authorizes; `trustToken` on the host or on a record is the opt-out, off by default.
- **A role is read on every command.** `Users.verify` hands out a principal that answers `standing()` and `can()` by reading the file again, so removal refuses the next command with `-32007` and a changed role with `-32009`. A principal built by hand carries no `standing` and is treated as still standing.
- **A session names a machine through the plugin-contributed `computer` key**, and an empty value is this host rather than a machine called `''`. A backend that cannot reach the machine must refuse rather than run on the host: `refuseComputer` in `packages/sdk/src/computers.ts`, held by `test/computer-refusal.test.ts`.
- **`defaultShell` is the connection's**, in `Connection.config` under `PER_CONNECTION`; `rootState` drops those keys from the host's half and overlays the connection's own.
- **The root `configChanged` echo cannot be split per connection.** `test/conformance.test.ts` pins exactly one echo per dispatch, and `serverSeq` and the replay buffer are one per host.
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
