---
title: The ahpd part follows the last release
domain: container
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
refs:
  - git://1da0d0325 - the last commit that holds the problem file this plan and its brief replace, `problems/the-ahpd-part-does-not-follow-the-release.md`
  - "[code://scripts/parts-bump.mjs#L147-L150](../../../../scripts/parts-bump.mjs#L147-L150) - `bumpOf` skips the ahpd part, and says its version moves with the package"
  - "[code://scripts/parts-bump.mjs#L94-L97](../../../../scripts/parts-bump.mjs#L94-L97) - `npmVersion`, the npm read this plan widens to the two channels"
  - "[code://scripts/parts-bump.mjs#L126-L144](../../../../scripts/parts-bump.mjs#L126-L144) - `newerThan`, which refuses a prerelease"
  - "[code://scripts/parts-bump.mjs#L58-L60](../../../../scripts/parts-bump.mjs#L58-L60) - `dependenciesOf` already locks the ahpd part at its version"
  - "[code://packages/computer/images/versions.json#L22-L23](../../../../packages/computer/images/versions.json#L22-L23) - the ahpd part's version"
  - "[code://packages/computer/src/hostinstall.ts#L163-L180](../../../../packages/computer/src/hostinstall.ts#L163-L180) - the install on a box reads the same version and lock"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts) - the bump cases, with an npm on `PATH`"
  - "[code://.github/workflows/parts-bump.yml](../../../../.github/workflows/parts-bump.yml) - the weekly bump, which opens a pull request"
  - "[code://docs/plugins/COMPUTERS.md#L1058-L1070](../../../../docs/plugins/COMPUTERS.md#L1058-L1070) - how a part is added and bumped"
---

## Goal

The ahpd part in a machine, and the ahpd installed on an ssh box, run the last release that npm serves.
The weekly parts bump proposes it, as it proposes every other part, so nobody moves the pin by hand.
The same version as the host is the brief [the-ahpd-part-is-the-releases-own-build.md](../../../briefs/the-ahpd-part-is-the-releases-own-build.md), for 0.16.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "kind === 'ahpd'" scripts/parts-bump.mjs` - `bumpOf` skips the part, and `dependenciesOf` and `lockable` already handle it.
- `rg -n "ahpd" packages/computer/test/parts-bump.test.ts` - the locks case writes the ahpd part's manifest. No case moves its version.
- `npm view @ahpd/server dist-tags` on 2026-11-13 - `latest` is `0.14.0` and `next` is `0.15.0-rc.2`.

### Runtime path

```
parts-bump.yml weekly -> parts-bump.mjs -> npm dist-tags of @ahpd/server -> versions.json and parts/ahpd lock -> pull request
```

### Gaps

- `bumpOf` never moves the ahpd part, so its version stays where a person left it.
- `newerThan` refuses a prerelease, and a release candidate of ahpd is a version a machine should run.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The ahpd part runs the last release on npm, one release behind the host | Softov, 2026-11-13: "A now, B as a 0.16 brief" | 01 |
| The release's own build at the host's version is a brief for 0.16 | Softov, 2026-11-13: "A now, B as a 0.16 brief" | - |
| The bump reads the `latest` and `next` tags of `@ahpd/server` and takes the higher version, a prerelease included | (defaulted: `next` is where each release candidate goes, and npm serves it) | 01 |
| The weekly `parts-bump.yml` proposes the move, and the release's own bump does not touch the part | (defaulted: the bump workflow is how every other part moves) | 01 |

## Proposed architecture

- **Data flow** - `bumpOf` asks npm for the dist-tags of `@ahpd/server`, takes the higher of `latest` and `next`, and moves the part when that is newer. `lock` then writes `parts/ahpd/package.json` and its lock at that version.
- **Layer responsibilities** - `scripts/parts-bump.mjs`: the move · `docs/plugins/COMPUTERS.md`: the rule.
- **Source-of-truth files** - [`code://scripts/parts-bump.mjs`](../../../../scripts/parts-bump.mjs)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The bump moves the ahpd part](task-01-the-bump-moves-the-ahpd-part.md) | todo | - |

## Risks and tradeoffs

- A machine runs one release behind its host. A host on AHP 1.1.0 runs a 1.0.0 ahpd in its machines until the next bump. The protocol version each side sends keeps the two talking.
- A bump PR comes only after Softov approves a release on npm. Run `parts-bump.yml` by hand after the approval to propose it at once.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-bump-moves-the-ahpd-part.md](task-01-the-bump-moves-the-ahpd-part.md).
- **Open questions:** none.
- **Watch out for:** `newerThan` stays as it is for every other part. Only the ahpd part takes a prerelease.

## Final verification checklist

- [ ] `npx vitest run packages/computer/test/parts-bump.test.ts` passes, with the new cases.
- [ ] `node scripts/parts-bump.mjs --dry-run` on main says the ahpd part moves to the higher of `latest` and `next`, or that it is current.
