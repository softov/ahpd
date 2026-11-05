# Developing ahpd

`ahpd` is a pnpm workspace: three packages published together, two examples, and the tools that check them.
Node 22 or later.
The root manifest pins `pnpm@11.21.0`, so `corepack enable` is the shortest way to the right one.

| Package | What it is |
| --- | --- |
| [`@ahpd/sdk`](packages/sdk) | The Agent Host Protocol, and the parts to build a host: `createHost`, `listen`, the backend seam, the ports. |
| [`@ahpd/agent-claude`](packages/agent-claude) | One backend: Claude Code through the Claude Agent SDK. |
| [`@ahpd/server`](packages/server) | The `ahpd` daemon: argv, the configuration file, and the record it keeps of itself. It bundles no backend; one arrives as a plugin. |
| [`examples/echo`](examples/echo), [`examples/notes`](examples/notes) | A host, and a host with a store, to run and to read. |

The root manifest is private and is never published; it exists to hold the workspace scripts and the dev dependencies.

## Getting set up

```bash
git clone https://github.com/softov/ahpd
cd ahpd
pnpm install
pnpm build
```

On Windows, clone with `git clone -c core.longpaths=true https://github.com/softov/ahpd`. Some paths under `.project/plans` are 185 characters long, so with the clone folder in front they pass the 260 a Windows path may have, and the checkout fails with "Filename too long".

`pnpm build` compiles each package into its own `packages/*/dist` with its own `tsconfig`.
The two libraries ship `src` as well, and the daemon ships `dist` alone, which is why a change under `packages/sdk/src` is visible to the examples without a rebuild when they run with `--conditions development`.

## Running from source

```bash
pnpm dev      # the daemon, watching, straight from TypeScript
pnpm start    # the built daemon
pnpm echo     # examples/echo
pnpm notes    # examples/notes
```

`pnpm dev` runs `packages/server/src/main.ts` with `--conditions development`, so the workspace packages resolve to their `src` through their `exports` maps and nothing has to be rebuilt between edits.
Every flag is the same as the published `ahpd`, and the examples in the README are written for the command rather than the path.

To record what a client and this host say to each other, start it with `--wire <file>` or set `wire` in the configuration file: every frame in both directions is appended as one JSON line, `{ at, from, peer, frame }`.
[`scripts/tee.mjs`](scripts/tee.mjs) is the same recording as a proxy, for a host that cannot be restarted with the flag.

### On Bun, and how Node finds the sources

```bash
pnpm dev:bun     # the daemon on Bun
pnpm echo:bun    # examples/echo on Bun
pnpm notes:bun   # examples/notes on Bun
```

[`packages/sdk/src/listen.ts`](packages/sdk/src/listen.ts) is the only file that knows the runtime, and it has one code path for each of Node, Bun and Deno, so a change to it is run on more than one.
[`packages/server/src/pty.ts`](packages/server/src/pty.ts) asks it, and has a terminal binding for Bun and one for the rest, so a change there is run on Bun and on Node.
The sources import `./host.js`, the name the build emits.
Bun maps that to the `.ts` by itself; on Node, [`scripts/dev.mjs`](scripts/dev.mjs) registers [`scripts/dev-hooks.mjs`](scripts/dev-hooks.mjs) to do the same.
On a Node older than 22.15 or 23.5 the hooks run on their own thread, and importing pi takes about four times as long.
Deno runs `dist/`, or `src/` with `--sloppy-imports`.
Node strips types and does not transform them, so the sources use no enum, namespace or constructor parameter property; [`packages/sdk/test/strippable.test.ts`](packages/sdk/test/strippable.test.ts) checks it.

## How the CLI is declared

Every command and flag is one declaration under [`packages/server/src/commands`](packages/server/src/commands), and [`packages/server/src/main.ts`](packages/server/src/main.ts) renders them with `@cofold/terminal`.
Help, completion, `--json`, exit codes, the HTTP API and the `--remote` manifest all come from those declarations.
[`docs/server/REFERENCE.md`](docs/server/REFERENCE.md) is generated from them when the docs build.

## How a restart works

1. `ahpd restart` sends the recorded process `SIGHUP`, or `SIGUSR2` with `--force`. On Windows it writes one JSON line, the key and the signal, to the named pipe in the record.
2. The daemon reads its recorded arguments over the configuration as it is now. It refuses when either cannot be read.
3. It runs the installed entry once with those arguments and `AHPD_CHECK_LINE` set, which reads them strictly. A refusal there leaves the daemon running.
4. It fires no automation, ends every session and terminal, waits up to five seconds for their processes, and closes its stores.
5. It starts the successor with the same token, environment and working directory, and exits.

The daemon writes `restart: stopping (SIGHUP)` or `(SIGUSR2)` to `daemon.log`, and each refusal names its signal, so the terminal reads only the answer to its own kind of request.
The terminal waits five seconds for that line, then as long as the old daemon takes to stop, then 25 seconds for the successor.
One restart runs at a time, and `ahpd stop` during a restart wins.

## The checks

Every check below runs in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) and again in the release workflow.
CI runs them on Linux and on Windows, and a failure on either fails the run.
On Windows the tests are `pnpm test:unit`: the daemon's command line, the HTTP server, the computer plugin and a nested host are tested in CI on Linux only.
They pass on Windows too, run by hand one file at a time on a Windows machine, with Docker Desktop for the cases that need a real Docker.
A test that is POSIX by nature, such as one that sends a signal or reads a file mode, skips on Windows with `it.skipIf(!posix)` from [`tools/posix.ts`](tools/posix.ts), and says why in a comment beside it.

| Command | What it checks |
| --- | --- |
| `pnpm boundary` | Each package imports only what it declares. Run it first when a change moves code between packages: a host that imports a backend passes every other check and is still wrong. |
| `pnpm typecheck` | `tsc --noEmit` over the workspace. |
| `pnpm test` | `node tools/schema.mjs`, then the vitest suite. |
| `pnpm schema` | Regenerate `tools/ahp.strict.schema.json` from the protocol package's own types, every object closed. |
| `pnpm wire -- <capture>` | Check a `--wire` recording against that schema. |
| `pnpm build` | Every package compiles, into what `files` would publish. |

### The boundary between the packages

`@ahpd/sdk` declares one runtime dependency, `@microsoft/agent-host-protocol`, and its only other packages are optional - `ws`, which it imports only on Node, and `node-pty`, which a Node host may hand in - so a host on Bun or Deno never installs them. There is no backend, no agent SDK and no `zod` in it, which is what stops the library that implements the protocol from quietly becoming a library that runs Claude. `@ahpd/agent-claude` is where those live, and nothing depends on it: the daemon loads it as a plugin, so the package that implements the protocol and the package that runs Claude are installed separately and released separately.

That boundary is enforced twice. npm hoists every dependency in a workspace into one `node_modules` at the root, so any package can import anything installed anywhere and it resolves, including something it never declared. pnpm links each package only what its own `package.json` declares, so `packages/sdk/node_modules` holds the protocol package and its two optionals and nothing else, and an undeclared import fails where it is written rather than in somebody else's install. `pnpm boundary` is the second check and the one CI runs first: it reads every import in each package's `src/`, compares it with what that package declares, and reports the package, the import it did not declare, and the files that import it.

It is static, so it needs no install to be in any particular shape and cannot be fooled by one - it asks what the code says rather than what resolved today. `devDependencies` are deliberately treated as undeclared, because they are absent for anybody who installs the package, so a `src/` importing one works here and breaks there.

This is not hypothetical. `catalogue`, the listing of a backend's sessions on disk, was once written inside the host and reached for the Claude Agent SDK's `listSessions`, which compiled only because hoisting resolved it. It now lives in [`packages/agent-claude/src/catalog.ts`](packages/agent-claude/src/catalog.ts), and the host learns a listing through the backend seam; [`packages/sdk/src/sessions/catalog.ts`](packages/sdk/src/sessions/catalog.ts) is what is left on the host's side, how a session is named and what its status bits are worth.

### The conformance and wire checks

[`packages/sdk/test/conformance.test.ts`](packages/sdk/test/conformance.test.ts) drives the host and replays every action it emitted through the protocol package's own reducers - `rootReducer`, `sessionReducer`, `chatReducer`, `terminalReducer`, `changesetReducer` - rather than reading state back out of a snapshot this host also wrote.
A snapshot is this host agreeing with itself; the reducer is what VS Code and `ahpc` actually run.

[`packages/sdk/test/wire.test.ts`](packages/sdk/test/wire.test.ts) checks the other half: not whether a client can read what the host sends, but whether the protocol *declares* it.
`tools/schema.mjs` generates a strict schema out of the package's own types - every object closed, which the shipped `state.schema.json` is not - and every frame goes through it, so an undeclared key or a missing required one fails the build.
A reducer cannot see either, and neither can TypeScript: a conditional spread is not excess-property-checked, which is how three undeclared fields reached the wire from code typed against the package.

The check that cannot be done here is driving it with a client that was not written against it.
`ahpc` is lenient in places - a `chat/reasoning` bug in this host went unnoticed for exactly that reason, because no screen ever showed what a conformant client would have - so the reducers above are the strict reader, and VS Code is the one that has to agree.
A drive against VS Code found two bugs that were invisible from the source; both are in `git log`, and what they cost is written up in [docs/sdk/AHP.md](docs/sdk/AHP.md).

The host can be tested without opening a socket: `accept()` takes a peer and returns its handler.

The two repositories share one file: `packages/sdk/test/fixtures/resource-write.json` is identical in [`ahpc`](https://github.com/ahpio/ahpc), and each repository's CI compares its copy against the other's `main`.
Change it in both.

## Publishing

Every package here is versioned together and one git tag releases them.

1. Bump `version` to the same `X.Y.Z` in every `packages/*/package.json`. The root manifest is private and does not move.
2. Date the release's section in `docs/updates/vX_Y.md`. A new minor release gets a new page, with `title`, `date` and *The good stuff*; the site lists it from the file.
3. Commit.
4. Tag it and push the tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) takes it from there, on any `v*` tag:

- It refuses the release unless the tag equals the version in every package it publishes, and does that before building anything.
- It runs the same checks CI runs, then `pnpm build`.
- It packs each package with `pnpm pack` and refuses a tarball whose manifest still contains `workspace:`.
  pnpm rather than npm is deliberate: the siblings depend on each other with `workspace:^`, and only pnpm rewrites that to a real range on the way out.
  An `npm pack` tarball carries the literal `workspace:^`, which installs here and is broken for everybody else.
- It runs `npm stage publish --provenance --access public --tag <channel>` for every package named in `PUBLISHED`, in that order: `sdk` first, then the agents, `computer` and `tunnel-devtunnel`, then `server`.
  The channel is `latest` for a stable version and `next` for a pre-release.

The publish list and the tag check are one list - decision [one tag publishes every package in the workspace](./DEVELOPER.md).
A package npm has never seen is the one thing the workflow cannot do by itself: npm configures a trusted publisher on a package, so a new name needs one token publish first.
Bootstrap it with a stub - a `package.json` and nothing else - at a version *below* the tag's, because a stub at the tag's own version makes the release skip that package as already published.

Staging is deliberate: nothing is installable until somebody approves each version on its npm package page, and they have to be approved in dependency order, `sdk` first.
A dependant must never be installable while the version it names is still waiting.

Authentication is [trusted publishing](https://docs.npmjs.com/trusted-publishers): the workflow's GitHub OIDC token is the credential (`id-token: write`), so there is no `NPM_TOKEN` secret to rotate.
The job installs npm 12 because `npm stage` and trusted publishing need it; the npm bundled with Node 22 does not have them.

To rehearse the whole thing without publishing, run the workflow from the Actions tab (`workflow_dispatch`).
`dry_run` defaults to true and packs and checks everything.
A rehearsal on a tree whose versions are already on npm is refused by npm, which the workflow recognises and reports as expected.

Two things worth knowing.
A tag can be pushed by accident and an npm version cannot be unpublished, which is why staging exists.
`--provenance` attaches a signed attestation tying each tarball to the commit and to the workflow, which npm shows on the package page.

The daemon's update check reads the `latest` dist-tag, so `ahpd start` and `ahpd status` begin telling people about a release as soon as it is approved.

### Release candidates

A version with a pre-release suffix, such as `0.15.0-rc.1`, is released the same way: bump every package to it, tag `v0.15.0-rc.1` and push the tag.
The workflow stages it under the `next` dist-tag, so `npm i @ahpd/sdk` and the daemon's update check stay on the last stable version.
Testers install it with `@next`, for example `npx @ahpd/server@next`.
A fix goes out as `rc.2`.
When a candidate is good, bump to `0.15.0` and release that; an npm version cannot be renamed, so the stable release is a new version of the same code.
