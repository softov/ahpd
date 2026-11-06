---
title: The login file gets the PATH line
status: done
depends: []
layer: scripts/install
refs:
  - "[code://scripts/install/install.sh#L579-L643](../../../../scripts/install/install.sh#L579-L643) - `shell_name`, `rc_path`, `path_line`, `write_path` and `remove_path`"
  - "[code://scripts/install/test/install-sh.test.ts#L338-L350](../../../../scripts/install/test/install-sh.test.ts#L338-L350) - the case that adds the PATH line once"
  - "[code://scripts/install/test/install-sh.test.ts#L500-L515](../../../../scripts/install/test/install-sh.test.ts#L500-L515) - the `~/.npm-global` case"
  - "[code://docs/server/INSTALL.md#L17](../../../../docs/server/INSTALL.md#L17) - what the script does"
---

## Objective

The install script writes its PATH line into the shell's login file as well as its rc file.
An update writes a missing line, and the uninstall removes the line from every file the script can write.

## Files

- `UPDATE: scripts/install/install.sh:579-643` - add `login_path`, and make `write_path` and `remove_path` work on a list of files.
- `UPDATE: scripts/install/test/install-sh.test.ts` - add the cases of this task, with a helper that reads the login file.
- `UPDATE: docs/server/INSTALL.md:17` - say which files get the line, and that a desktop app sees `ahpd` after the next login.
- `UPDATE: docs/server/INSTALL.md:102` - say that the uninstall removes the PATH lines it wrote.

## Steps

1. Add `login_path`, which prints `~/.zprofile` for zsh and nothing for fish.
2. For bash, make `login_path` print the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists, else `~/.profile`.
3. For any other shell, make `login_path` print `~/.profile`.
4. Make `write_path` write the marker and the line into each of `rc_path` and `login_path` that lacks the marker.
5. Write the line in the login file as `export PATH=...`, and keep `path_line` for the rc file.
6. Make `write_path` write nothing when `BIN` is on the PATH and no file of the script has the marker.
7. Make `write_path` say each file it wrote, and that a desktop app sees `ahpd` after the next login.
8. Make `remove_path` remove the marked line from `~/.bashrc`, `~/.zshrc`, fish's `config.fish`, `~/.profile`, `~/.bash_profile`, `~/.bash_login` and `~/.zprofile`.
9. Keep the write back into the file in `remove_path`, so a linked file stays a link.
10. Add a test: a bash install into `~/.npm-global` writes one line into `~/.bashrc` and one into `~/.profile`.
11. Add a test: with a `~/.bash_profile`, the line goes there and not into `~/.profile`.
12. Add a test: a zsh install writes `~/.zshrc` and `~/.zprofile`.
13. Add a test: an update with `BIN` on the PATH and a marked `~/.bashrc` adds the line to `~/.profile`.
14. Add a test: `BIN` on the PATH and no marked file writes nothing.
15. Add a test: an uninstall under zsh removes the lines that a bash install wrote.
16. Update `INSTALL.md` at lines 17 and 102.

## Validation

- `scripts/install/test/install-sh.test.ts` passes, with the new cases.
- `pnpm vitest run scripts/install` passes.
- By hand on Debian 13: after an install into `~/.npm-global` and a new login, ahp-desk finds `ahpd`.

## Resume
