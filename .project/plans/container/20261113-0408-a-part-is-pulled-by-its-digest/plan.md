---
title: A part is pulled by its digest
domain: container
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
refs:
  - git://549928e22 - the last commit that holds the problem file this plan replaces, `problems/part-images-are-pulled-by-a-tag-with-no-digest.md`
  - "[code://packages/computer/src/parts.ts#L986](../../../../packages/computer/src/parts.ts#L986) - `ensurePart` pulls a part from `<registry>/<tag>`"
  - "[code://packages/computer/src/parts.ts#L1323](../../../../packages/computer/src/parts.ts#L1323) - `ensureParts` pulls the joined image from `<registry>/<tag>`"
  - "[code://packages/computer/src/parts.ts#L329-L346](../../../../packages/computer/src/parts.ts#L329-L346) - `hashOf` hashes the bytes of `versions.json` into the joined image's tag"
  - "[code://packages/computer/src/parts.ts#L62](../../../../packages/computer/src/parts.ts#L62) - `versionsPath`, the pattern the digests file's path follows"
  - "[code://packages/computer/src/runtime.ts#L3734-L3741](../../../../packages/computer/src/runtime.ts#L3734-L3741) - `pullImage` pulls any reference and tags it, a digest reference included"
  - "[code://scripts/parts-publish.mjs#L65](../../../../scripts/parts-publish.mjs#L65) - `published` asks the registry for an image with `docker buildx imagetools inspect`"
  - "[code://scripts/parts-publish.mjs#L143-L174](../../../../scripts/parts-publish.mjs#L143-L174) - each image is left as published or built and pushed"
  - "[code://.github/workflows/release.yml#L22](../../../../.github/workflows/release.yml#L22) - the release job, which packs and stages the packages"
  - "[code://.github/workflows/release.yml#L243-L281](../../../../.github/workflows/release.yml#L243-L281) - the parts job, which runs beside the release job today"
  - "[code://packages/computer/test/parts-publish.test.ts](../../../../packages/computer/test/parts-publish.test.ts) - the publish cases, with a fake docker"
  - "[code://packages/computer/test/computer-parts-build.test.ts#L77-L130](../../../../packages/computer/test/computer-parts-build.test.ts#L77-L130) - the pull cases, which record each reference pulled"
  - "[code://docs/plugins/COMPUTERS.md#L1000-L1015](../../../../docs/plugins/COMPUTERS.md#L1000-L1015) - *Parts*, which says a host pulls a part at its tag"
  - "[code://DEVELOPER.md#L145-L150](../../../../DEVELOPER.md#L145-L150) - the release's parts job"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L48-L57 - VS Code installs each agent SDK from a committed lock, whose integrity hashes pin what is fetched
  - https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier - a pull by digest gets those bytes or fails
---

## Goal

A host pulls each machine part, and the joined image, by its digest, so a tag pushed again with other content is not run.
The release writes the digest of each image it publishes into the `@ahpd/computer` package.
Anyone who can push to a part's package cannot then replace an agent CLI on the hosts that run it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -il digest .project/plans .project/briefs .project/ideas .project/decisions` - no plan pins a part's digest. Plan plugin/13 parses a digest reference for the image allowlist.
- `rg -n "pullImage" packages/computer/src/parts.ts` - two pulls, a part at line 986 and the joined image at line 1323.
- `rg -n "ahpd-part" docs DEVELOPER.md` - *Parts* in `docs/plugins/COMPUTERS.md` and the release section of `DEVELOPER.md`.
- `node -p "require('./packages/computer/package.json').files"` - the package ships `images`, so a file there reaches every installed host.

### Runtime path

```
release parts job -> parts-publish.mjs --push -> registry digest per tag -> digests.json artifact -> release job packs @ahpd/computer -> host ensurePart -> docker pull <registry>/<name>@<digest> -> docker tag <tag>
```

### Gaps

- No file holds a digest, and `versions.json` cannot hold one, because `hashOf` hashes its bytes into the joined image's tag.
- `parts-publish.mjs` does not read the digest of an image it pushes or finds published.
- The release job packs the packages while the parts job still runs, so the package cannot carry what the parts job learns.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A host checks a pulled image by its pinned digest | Softov, 2026-11-08, in the problem file | 02 |
| The digests go in a file of their own, `packages/computer/images/digests.json`, and `versions.json` and every tag stay as they are | Softov, 2026-11-13: "A file of its own" | 01, 02 |
| A part with no digest, as in a checkout, is pulled by its tag, and the host logs a warning that names it | Softov, 2026-11-13: "Pull by tag, log a warning" | 02 |
| The release job waits for the parts job, and a part that fails stops the npm stage | Softov, 2026-11-13: "The release stops" | 03 |
| A checkout's own `ahpd` part is built here with no digest, as it is today | Softov, 2026-11-08, in the problem file | 02 |
| The digests file is not committed: `.gitignore` names it | (defaulted: a checkout has no digests, as the second answer says) | 01 |
| The file maps the local tag of each image, such as `ahpd-part/claude:<tag>`, to its `sha256:` digest | (defaulted: `tagOf` and the joined tag are what a host already asks for) | 01, 02 |

## Proposed architecture

- **Data flow** - `parts-publish.mjs --push` reads the digest of each image it pushes or finds published, and writes `digests.json`. The parts job uploads it, and the release job puts it in `packages/computer/images/` before it packs.
- **State flow** - `digests.json` is read once per process, beside `versions.json`. A missing file is no digests.
- **Layer responsibilities** - `scripts/parts-publish.mjs`: write the digests · `packages/computer/src/parts.ts`: read them and pull by them · `release.yml`: carry them into the package.
- **Source-of-truth files** - [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts), [`code://scripts/parts-publish.mjs`](../../../../scripts/parts-publish.mjs)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The publish job writes the digests](task-01-the-publish-job-writes-the-digests.md) | implemented | - |
| [02 - A host pulls a part by its digest](task-02-a-host-pulls-a-part-by-its-digest.md) | implemented | 01 |
| [03 - The release carries the digests](task-03-the-release-carries-the-digests.md) | implemented | 01 |
| [04 - The docs say a part is pinned](task-04-the-docs-say-a-part-is-pinned.md) | implemented | 02, 03 |

## Risks and tradeoffs

- The npm stage waits for the parts job, which has a limit of 90 minutes. A part already published is left as it is and only inspected, so a release with no part change waits a few minutes.
- A checkout pulls by tag, so a developer's daemon is not protected. An installed host is, and that is where the risk of the problem is.
- A dry run pushes nothing, so it writes no digests and packs the package without them.

## Resume state

- **Done so far:** tasks 01 to 04 are implemented on 2026-11-13, as [implemented.md](implemented.md) says.
- **Next action:** review the PR, then a dry run of `release.yml` on its branch, the first run of the artifact actions.
- **Open questions:** none.
- **Watch out for:** the joined image's tag hashes `versions.json`, so nothing may write a digest there. `pullImage` takes the remote reference and the local tag apart, so a digest reference needs no change in the runtime.

## Final verification checklist

- [ ] `npx vitest run packages/computer` passes, with the new cases of tasks 01 and 02.
- [ ] A dry run of `release.yml` passes, and its release job waits for its parts job.
- [ ] After the next tag run, the staged `@ahpd/computer` holds `images/digests.json`, with a digest for each tag the parts job published.
- [ ] A host installed from that release pulls a part by `@sha256:`, as its log or `docker images --digests` shows.
