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

## The checks

Every check below runs in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) and again in the release workflow.

| Command | What it checks |
| --- | --- |
| `pnpm boundary` | Each package imports only what it declares. Run it first when a change moves code between packages: a host that imports a backend passes every other check and is still wrong. |
| `pnpm typecheck` | `tsc --noEmit` over the workspace. |
| `pnpm test` | `node tools/schema.mjs`, then the vitest suite. |
| `pnpm schema` | Regenerate `tools/ahp.strict.schema.json` from the protocol package's own types, every object closed. |
| `pnpm wire -- <capture>` | Check a `--wire` recording against that schema. |
| `pnpm build` | Every package compiles, into what `files` would publish. |

### The boundary between the packages

`@ahpd/sdk` declares no runtime `dependencies` at all. Its one peer is `@microsoft/agent-host-protocol`, and its only other packages are optional - `ws`, which it imports only on Node, and `node-pty`, which a Node host may hand in - so a host on Bun or Deno never installs them. There is no backend, no agent SDK and no `zod` in it, which is what stops the library that implements the protocol from quietly becoming a library that runs Claude. `@ahpd/agent-claude` is where those live, and nothing depends on it: the daemon loads it as a plugin, so the package that implements the protocol and the package that runs Claude are installed separately and released separately.

That boundary is enforced twice. npm hoists every dependency in a workspace into one `node_modules` at the root, so any package can import anything installed anywhere and it resolves, including something it never declared. pnpm links each package only what its own `package.json` declares, so `packages/sdk/node_modules` holds its peer and its two optionals and nothing else, and an undeclared import fails where it is written rather than in somebody else's install. `pnpm boundary` is the second check and the one CI runs first: it reads every import in each package's `src/`, compares it with what that package declares, and reports the package, the import it did not declare, and the files that import it.

It is static, so it needs no install to be in any particular shape and cannot be fooled by one - it asks what the code says rather than what resolved today. `devDependencies` are deliberately treated as undeclared, because they are absent for anybody who installs the package, so a `src/` importing one works here and breaks there.

This is not hypothetical. `catalogue`, the listing of a backend's sessions on disk, was once written inside the host and reached for the Claude Agent SDK's `listSessions`, which compiled only because hoisting resolved it. It now lives in [`packages/agent-claude/src/catalog.ts`](packages/agent-claude/src/catalog.ts), and the host learns a listing through the backend seam; [`packages/sdk/src/catalog.ts`](packages/sdk/src/catalog.ts) is what is left on the host's side, how a session is named and what its status bits are worth.

### The conformance and wire checks

[`test/conformance.test.ts`](test/conformance.test.ts) drives the host and replays every action it emitted through the protocol package's own reducers - `rootReducer`, `sessionReducer`, `chatReducer`, `terminalReducer`, `changesetReducer` - rather than reading state back out of a snapshot this host also wrote.
A snapshot is this host agreeing with itself; the reducer is what VS Code and `ahpc` actually run.

[`test/wire.test.ts`](test/wire.test.ts) checks the other half: not whether a client can read what the host sends, but whether the protocol *declares* it.
`tools/schema.mjs` generates a strict schema out of the package's own types - every object closed, which the shipped `state.schema.json` is not - and every frame goes through it, so an undeclared key or a missing required one fails the build.
A reducer cannot see either, and neither can TypeScript: a conditional spread is not excess-property-checked, which is how three undeclared fields reached the wire from code typed against the package.

The check that cannot be done here is driving it with a client that was not written against it.
`ahpc` is lenient in places - a `chat/reasoning` bug in this host went unnoticed for exactly that reason, because no screen ever showed what a conformant client would have - so the reducers above are the strict reader, and VS Code is the one that has to agree.
A drive against VS Code found two bugs that were invisible from the source; both are in `git log`, and what they cost is written up in [docs/AHP.md](docs/AHP.md).

The host can be tested without opening a socket: `accept()` takes a peer and returns its handler.

The two repositories share one file: `test/fixtures/resource-write.json` is identical in [`ahpc`](https://github.com/softov/ahpc), and each repository's CI compares its copy against the other's `main`.
Change it in both.

## Publishing

Every package here is versioned together and one git tag releases them.

1. Bump `version` to the same `X.Y.Z` in every `packages/*/package.json`. The root manifest is private and does not move.
2. Commit.
3. Tag it and push the tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) takes it from there, on any `v*` tag:

- It refuses the release unless the tag equals the version in `sdk`, `agent-claude`, `agent-cofold`, `agent-acp`, `server` and `computer`, and does that before building anything.
- It runs the same checks CI runs, then `pnpm build`.
- It packs each package with `pnpm pack` and refuses a tarball whose manifest still contains `workspace:`.
  pnpm rather than npm is deliberate: the siblings depend on each other with `workspace:^`, and only pnpm rewrites that to a real range on the way out.
  An `npm pack` tarball carries the literal `workspace:^`, which installs here and is broken for everybody else.
- It runs `npm stage publish --provenance --access public` for `@ahpd/sdk`, `@ahpd/agent-claude`, `@ahpd/agent-cofold`, `@ahpd/agent-acp` and `@ahpd/server`, in that order.

`@ahpd/computer` is versioned, built and packed with the rest and is not published - decision [the computer is not published yet](.project/decisions/the-computer-is-not-published-yet.md).
`@ahpd/agent-pi` and `@ahpd/tunnel-devtunnel` are in neither list: they move with the version and nothing stages them, so a plugin named by package name is unavailable to anybody who did not clone this repository.

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
