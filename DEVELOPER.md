# Developing ahpd

`ahpd` is a pnpm workspace: three packages published together, two examples, and the tools that check them.
Node 22 or later.
The root manifest pins `pnpm@11.21.0`, so `corepack enable` is the shortest way to the right one.

| Package | What it is |
| --- | --- |
| [`@ahpd/sdk`](packages/sdk) | The Agent Host Protocol, and the parts to build a host: `createHost`, `listen`, the backend seam, the ports. |
| [`@ahpd/agent-claude`](packages/agent-claude) | One backend: Claude Code through the Claude Agent SDK. |
| [`@ahpd/server`](packages/server) | The `ahpd` daemon: argv, the configuration file, and the record it keeps of itself. |
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
| `pnpm build` | The three packages compile, into what `files` would publish. |

[`test/conformance.test.ts`](test/conformance.test.ts) replays every action the host emits through the protocol package's own reducers rather than reading a snapshot back out of the host, and [`test/wire.test.ts`](test/wire.test.ts) checks that the protocol *declares* what is sent.
Both are worth reading before changing the wire.

The two repositories share one file: `test/fixtures/resource-write.json` is identical in [`ahpc`](https://github.com/softov/ahpc), and each repository's CI compares its copy against the other's `main`.
Change it in both.

## Publishing

The three packages are versioned together and one git tag releases all of them.

1. Bump `version` to the same `X.Y.Z` in [`packages/sdk/package.json`](packages/sdk/package.json), [`packages/agent-claude/package.json`](packages/agent-claude/package.json) and [`packages/server/package.json`](packages/server/package.json). The root manifest is private and does not move.
2. Commit.
3. Tag it and push the tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) takes it from there, on any `v*` tag:

- It refuses the release unless the tag equals the version in all three manifests, and does that before building anything.
- It runs the same checks CI runs, then `pnpm build`.
- It packs each package with `pnpm pack` and refuses a tarball whose manifest still contains `workspace:`.
  pnpm rather than npm is deliberate: the siblings depend on each other with `workspace:^`, and only pnpm rewrites that to a real range on the way out.
  An `npm pack` tarball carries the literal `workspace:^`, which installs here and is broken for everybody else.
- It runs `npm stage publish --provenance --access public` for `@ahpd/sdk`, `@ahpd/agent-claude` and `@ahpd/server`, in that order.

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
