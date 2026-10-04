---
title: A scheduled job proposes a bump
status: implemented
depends: [task-01-the-versions-file.md]
layer: "ci"
refs:
  - "[code://.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) - the workflow style"
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the feed
---

## Objective

A weekly workflow compares `versions.json` with the registry and npm, and opens one pull request with every newer version and each archive's new sha256.

## Files

- `CREATE: scripts/parts-bump.mjs` - reads both, writes the file, prints what moved and what was skipped.
- `CREATE: .github/workflows/parts-bump.yml` - weekly and by hand; opens the pull request.

## Steps

1. A registry entry is matched by id; an npm part not in the registry is checked with `npm view <package> version`.
2. An archive's sha256 is computed from the downloaded file.
3. Nothing moved: no pull request.

## Validation

- `node scripts/parts-bump.mjs --dry-run` against a saved registry file prints the expected moves.

## Resume

Done 2026-10-04.

- The registry is keyed by id, and the id is the part's - so a part the registry
  spells differently is not matched. `amp` is the one today: the registry calls
  it `amp-acp`, and it is skipped with that line rather than matched by a
  guess. `node` and `ahpd` are skipped too, for the obvious reasons written into
  the script: one is fed by nobody and the other moves with the package.
- An archive takes the registry's own `sha256` where there is one, and is
  downloaded and hashed where there is not - which today is devin and cursor,
  the two feeds that ship no sums. The sum written is the sum of what was
  downloaded, so the build's `sha256sum --check` is what says whether the file
  that arrived is the file the registry meant.
- `newerThan` refuses a downgrade and refuses a feed that answers something that
  is not a version (`latest` compares as a string, and a string that is not
  numeric does not come out ahead of a number by accident). A part that is not
  offered a newer version is printed as skipped, which is the plan's risk line
  about dsh - though dsh is an npm part and so is checked with `npm view` like
  every npm part the registry does not carry.
- `layout` writes the file the way it ships: two-space JSON with a short block
  of strings on one line. That is not decoration - run against the file as it
  stands it reproduces it byte for byte, so a bump's diff is the versions and the
  sums and nothing else. A block too long for one line stays expanded, which is
  what an archive entry is.
- A part whose archive will not download is skipped by name and the rest of the
  file still lands. The workflow's `git diff --quiet` is what implements step 3:
  nothing moved means no branch and no commit, so there is no pull request to
  open.
- The branch is dated (`parts-bump-20261004`) rather than fixed. Two runs that
  each found something are two pull requests, which is the honest reading - the
  second one carries only what moved since the first.

Validated by hand, against a saved registry, both ways:

- `node scripts/parts-bump.mjs --dry-run --registry <saved>` - every part is at
  the version the feeds carry today, nothing moved, and the file is untouched.
- With a saved registry carrying an npm part, an archive part and a downgraded
  archive part: the first two are bumped, the downgrade is refused with the
  version it found, and `npm view` answers for the six npm parts the registry
  does not carry.
- The written file differs from the file it replaced in eight lines - three
  versions, three urls and two sums that were computed from the download.

**Not run by hand:** the workflow itself, and a real archive download for a
part's own archive. There is no network to GitHub's runners here and no
credentials; `gh pr create` was not exercised.
