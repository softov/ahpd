---
title: An installed ahpd is found outside bash
domain: daemon
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires: []
changes:
  - specs/daemon.md
creates: []
refs:
  - git://2c0bcf78 - the commit of ahpd this plan was checked at
  - "[code://scripts/install/install.sh#L481-L496](../../../../scripts/install/install.sh#L481-L496) - `resolve_prefix`, which falls back to `~/.npm-global` when the global prefix is not writable"
  - "[code://scripts/install/install.sh#L579-L621](../../../../scripts/install/install.sh#L579-L621) - `shell_name`, `rc_path`, `path_line` and `write_path`: one PATH line, in one rc file"
  - "[code://scripts/install/install.sh#L623-L643](../../../../scripts/install/install.sh#L623-L643) - `remove_path`, which removes the line from the rc file of the shell at uninstall"
  - "[code://scripts/install/install.sh#L309-L316](../../../../scripts/install/install.sh#L309-L316) - `ahpd_prefix`, the prefix that holds an `ahpd`, which the update already uses"
  - "[code://scripts/install/install.sh#L787-L847](../../../../scripts/install/install.sh#L787-L847) - `do_uninstall`, which runs `npm uninstall -g` with no `--prefix`"
  - "[code://scripts/install/test/install-sh.test.ts#L270-L294](../../../../scripts/install/test/install-sh.test.ts#L270-L294) - `rcFile`, `rcLines` and `exportsIn`, the helpers to copy for the login file"
  - "[code://scripts/install/test/install-sh.test.ts#L566-L655](../../../../scripts/install/test/install-sh.test.ts#L566-L655) - the uninstall cases"
  - "[code://packages/server/src/install.ts#L76-L115](../../../../packages/server/src/install.ts#L76-L115) - `launch`, which looks for `npm-cli.js` on Windows only"
  - "[code://packages/server/test/plugin-install.test.ts#L160-L203](../../../../packages/server/test/plugin-install.test.ts#L160-L203) - the `launch` cases"
  - "[code://docs/server/INSTALL.md#L17](../../../../docs/server/INSTALL.md#L17) - what the script does, and line 102, what the uninstall removes"
  - https://gitlab.gnome.org/GNOME/gnome-session/-/raw/gnome-48/gnome-session/gnome-session.in - a GNOME Wayland session starts through a login `$SHELL`, so it reads the shell's login file
  - git://2c0bcf78:.project/briefs/an-installed-ahpd-is-found-outside-bash.md - the brief this plan covers; its goal also named ssh and cron, which no login file reaches
---

## Goal

The install script can put `ahpd` in `~/.npm-global`.
A login shell and the programs of a desktop session, such as ahp-desk and VS Code, then find it.
The uninstall removes what the install added, from the prefix it installed into.
The daemon runs the npm of the Node it runs under on every platform.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "bashrc|profile|npm-global|MARKER" scripts/install` - one rc file from `SHELL`, and the marker line.
- `rg -n "launch\(" packages/server` - every npm call of the daemon goes through `launch`.
- `rg -n "npm_execpath|npm-cli" .project` - daemon/23 and the daemon spec scope `npm-cli.js` to Windows, for the Windows spawn fault only.
- `rg -n -i "bashrc|npm-global|\.profile" docs README.md` - nothing; `INSTALL.md` says only that the script adds `ahpd` to the PATH.

### Runtime path

```
install.sh -> resolve_prefix -> ~/.npm-global -> write_path -> rc file and login file
  -> next login -> gnome-session through a login $SHELL -> ahp-desk finds ahpd on PATH
daemon -> launch('npm') -> node npm-cli.js beside process.execPath -> npm install --prefix <plugins>
```

### Gaps

- The PATH line goes only into the rc file, which a login shell and a desktop session do not read.
- An update finds `~/.npm-global/bin` on the PATH and writes no line, so an install from before this plan never gets the login line.
- `remove_path` reads only the rc file of the shell at uninstall.
- `do_uninstall` asks npm's own prefix, not the one that holds the package.
- `launch` runs `npm` from the PATH on Linux and macOS.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The script also writes the PATH line into the shell's login file, beside the rc file | Softov, 2026-10-31, chose "Login file line" | 01 |
| The login file is `~/.zprofile` for zsh; for bash, the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists, else `~/.profile`; for fish, none; for any other shell, `~/.profile` | (defaulted: the file a login shell of that kind reads; bash reads only the first one that exists, and fish reads `config.fish` in every shell) | 01 |
| Each file gets the line when it does not have the marker; nothing is written when the bin folder is on the PATH and no file of the script has the marker | (defaulted: an update of an install from before this plan gets the login line, and a container's `/usr/local` still gets none) | 01 |
| `--uninstall` removes the marked line from every file the script can write | the brief; a line written under another shell stays today | 01 |
| `--uninstall` passes `--prefix` with the prefix that holds the found `ahpd` | the brief; [code://scripts/install/install.sh#L309](../../../../scripts/install/install.sh#L309), which the update uses | 02 |
| `launch` takes `npm_execpath`, then `npm-cli.js` beside `process.execPath`, on every platform; on Unix that is `../lib/node_modules/npm/bin/npm-cli.js` | Softov's text, 2026-10-31 | 03 |
| With no `npm-cli.js`, Unix runs `npm` by its name with no shell, and Windows runs it through the shell as today | [code://packages/server/src/install.ts#L111-L113](../../../../packages/server/src/install.ts#L111-L113) | 03 |
| `ssh host 'ahpd status'` and cron stay out: neither reads a login file | Softov, 2026-10-31, chose the login file after this was said | - |
| `install.ps1` stays as it is: it installs into npm's own global prefix, which a person can write on Windows | [code://scripts/install/install.ps1#L161-L167](../../../../scripts/install/install.ps1#L161-L167) | - |

## Proposed architecture

- **Data flow** - `write_path` writes the marker and the line into each target file that lacks it. `remove_path` removes them from each file the script can write.
- **Event flow** - none.
- **State flow** - the marker line in each file is the state; `~/.npmrc` and the npm configuration stay as they are.
- **Layer responsibilities** - scripts/install: `install.sh` and its tests. server: `launch` in `install.ts` and its tests. docs: `INSTALL.md` and the daemon spec.
- **Source-of-truth files** - [`code://scripts/install/install.sh`](../../../../scripts/install/install.sh), [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The login file gets the PATH line](task-01-the-login-file-gets-the-path-line.md) | done | - |
| [02 - The uninstall uses the prefix of the package](task-02-uninstall-uses-the-package-prefix.md) | done | - |
| [03 - npm runs beside the daemon's Node](task-03-npm-runs-beside-the-node.md) | done | - |

## Risks and tradeoffs

- The login file takes effect at the next login, so a desktop app sees `ahpd` only after the person logs out and in. The script says so.
- An interactive login bash reads the login file and then `~/.bashrc`, so `PATH` holds the folder twice. That costs nothing.
- A Node from a version manager keeps npm beside it, so `launch` runs that npm, which is the one of the daemon's Node.
- A Bun or Deno daemon has no `npm-cli.js` beside its program, so it runs `npm` from the PATH as today.

## Resume state

- **Done so far:** planned 2026-10-31, and tasks 01 to 03 implemented on 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the install tests run the real script with stub programs; give each new case its own `HOME`, as `makeBox` does.

## Final verification checklist

- [x] On Debian 13 with bash, an install into `~/.npm-global` writes the line into `~/.bashrc` and `~/.profile`, and ahp-desk finds `ahpd` after the next login.
- [x] An update of an install from before this plan adds the line to `~/.profile`.
- [x] `--uninstall` removes the package from `~/.npm-global` and both lines.
- [x] A plugin install from a daemon under nvm runs the npm beside that Node.
- [ ] `pnpm typecheck` and the whole suite pass, and Windows CI is green.
