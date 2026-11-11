---
title: A second install finds the first one off the PATH
domain: daemon
status: planned
priority: medium
created: 2026-11-11
revalidated: 2026-11-11
requires: []
changes: []
creates: []
refs:
  - git://af15608ab - the commit of ahpd this plan was checked at, and the last one that holds `problems/an-install-at-the-same-version-says-to-load-a-new-one.md`
  - "[code://scripts/install/install.sh#L775-L806](../../../../scripts/install/install.sh#L775-L806) - the version check, run only for an `ahpd` on the PATH"
  - "[code://scripts/install/install.sh#L481-L496](../../../../scripts/install/install.sh#L481-L496) - `resolve_prefix`, which picks the folder an install goes into"
  - "[code://scripts/install/install.sh#L722-L730](../../../../scripts/install/install.sh#L722-L730) - `resolve_ahpd`, which already finds an `ahpd` in that folder after the check"
  - "[code://scripts/install/test/install-sh.test.ts#L394-L405](../../../../scripts/install/test/install-sh.test.ts#L394-L405) - the case for an `ahpd` on the PATH at the target version, the pattern for the new one"
---

## Goal

A person who runs `install.sh` twice gets "Nothing to update." when the version did not change.
This holds when the first install is not on the shell's PATH yet.
On 2026-11-09 a run as `sudo -iu <user>` reinstalled the same version, updated the plugins and said to restart.
The `ahpd` it found was in the bin folder the run chose, and only an `ahpd` on the PATH got the version check.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "resolve_ahpd|command -v ahpd" scripts/install/install.sh` - the PATH lookup before the check, and `resolve_ahpd` after it.
- `rg "Nothing to update" scripts/install/test/install-sh.test.ts` - one case, with the `ahpd` on the PATH.

### Runtime path

```
do_install -> command -v ahpd (empty) -> resolve_prefix -> resolve_ahpd finds $BIN/ahpd -> install_package -> "Run ahpd restart ..."
```

### Gaps

- The version check is skipped for an `ahpd` in `$BIN` that is not on the PATH.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An `ahpd` in the bin folder `resolve_prefix` chose gets the same version check as one on the PATH | the problem's first candidate, [code://scripts/install/install.sh#L779-L806](../../../../scripts/install/install.sh#L779-L806) | 01 |
| The PATH stays first: an `ahpd` on the PATH is the one checked when both exist | [code://scripts/install/install.sh#L775-L778](../../../../scripts/install/install.sh#L775-L778) | 01 |
| `install.ps1` is not changed | `(defaulted: the problem was seen with install.sh, and install.ps1 has its own lookup)` | - |

## Proposed architecture

- **Data flow** - `do_install` runs `resolve_prefix` when no `ahpd` is on the PATH, and then takes `$BIN/ahpd` when it is executable. One block checks the version for either.
- **Event flow** - none.
- **State flow** - none.
- **Layer responsibilities** - `scripts/install/install.sh` only.
- **Source-of-truth files** - [`code://scripts/install/install.sh`](../../../../scripts/install/install.sh)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The version check reads the chosen folder](task-01-the-version-check-reads-the-chosen-folder.md) | implemented | - |

## Risks and tradeoffs

- An `ahpd` in `$BIN` that prints no version now stops the run - one on the PATH does too, and the message names the path.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-11; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** `resolve_prefix` makes `$BIN` outside `--dry-run`. Under `--dry-run` the folder may not exist, and the `-x` test is then false.

## Final verification checklist

- [x] An `ahpd` in the chosen prefix and off the PATH, at the target version, gives "Nothing to update." and no `npm install`.
- [x] The same at an older version updates and says to restart.
- [x] The install suite passes.
