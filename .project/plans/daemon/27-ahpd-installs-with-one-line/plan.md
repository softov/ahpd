---
title: ahpd installs with one line
domain: daemon
status: built
priority: medium
created: 2026-10-15
revalidated: 2026-10-15
refs:
  - "[code://packages/server/package.json#L38-L40](../../../../packages/server/package.json#L38-L40) - `engines.node` is `>=22.1`, the floor that the script checks"
  - "[code://packages/server/src/pty.ts](../../../../packages/server/src/pty.ts) - node-pty is optional, so a failed native build is a warning"
  - "[code://packages/server/src/commands/configure.ts](../../../../packages/server/src/commands/configure.ts) - `ahpd configure`, the onboarding step"
  - "[code://docs/server/INSTALL.md](../../../../docs/server/INSTALL.md) - the install page that gets the one line"
  - https://ahpio.com - the site that serves `ahpd/install.sh` and `ahpd/install.ps1` from its `public/` folder
  - "[research: how one-line installers work](../../../research/one-line-installers.md) - Claude Code, OpenClaw, Bun and Deno, read on 2026-10-15"
---

## Goal

A person installs ahpd with one line, as Claude Code and OpenClaw do:

```bash
curl -fsSL https://ahpio.com/ahpd/install.sh | bash
```

```powershell
irm https://ahpio.com/ahpd/install.ps1 | iex
```

The script checks the runtime, installs `@ahpd/server` from npm without sudo, puts `ahpd` on PATH, and runs `ahpd configure`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `ls /github/ahpio-site/public` - `favicon.svg`, `robots.txt` and `shots`. Astro serves this folder from the site root.
- `curl -sI https://ahpio.com/` - 200 on 2026-10-15.

### Runtime path

```
curl | bash -> install.sh -> node >= 22 -> npm prefix -> npm install -g @ahpd/server -> PATH -> ahpd configure (TTY) -> next step printed
```

### Gaps

- `Not found: an install script - searched install.sh and install.ps1 in /github/ahpd and /github/ahpio-site.`
- INSTALL.md starts at `npm i -g`, so a person without Node has no first step.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The scripts are served from ahpio.com | (defaulted: the site is live and serves `public/` from the root) | - |
| A missing Node is installed after a question on a TTY; without a TTY the script stops with the command | Softov, 2026-10-15, to "When Node 22+ is missing, what does the install script do?" - "Ask, then install" | - |
| The script runs on Node or on Bun, chosen with `--runtime` | Softov, 2026-10-15, to "Does the script accept Bun or Deno instead of Node?" - "Node or Bun" | - |
| Uninstall is a section in INSTALL.md, and the script takes `--uninstall` and `--purge` | Softov, 2026-10-15, to "How does a person uninstall?" - "docs now. idea for --uninstall"; Softov, 2026-10-16, asked for the idea as task 04 | 03, 04 |
| `--uninstall` runs `ahpd stop` first | Softov, 2026-10-16, chose the recommended answer for "What does `--uninstall` do when a daemon runs?" | 04 |
| `--uninstall` leaves the npm prefix `~/.npm-global` | Softov, 2026-10-16, chose the recommended answer for "Does `--uninstall` undo the npm prefix `~/.npm-global` that the script set?" | 04 |
| `--uninstall` runs `ahpd service uninstall` first, before `ahpd stop` and the npm step, when a service exists | Softov, 2026-10-16, chose the recommended answer for "Does `--uninstall` remove the service of daemon/31 when one is installed?" | 04 |
| The package that the script installs is a flag, `--package` (`-Package`, `AHPD_PACKAGE`), with `@ahpd/server` from npm as the default; the CI job uses the default | Softov, 2026-10-19, to "What does the CI install job install?" - "can it be a flag? default to npm?" | 01, 02 |
| The script tests live in `scripts/install/test/` | Softov, 2026-10-19, chose the recommended answer for "Where do the install script tests live?" | 01, 02 |
| `install.ps1` asks, then runs `winget install OpenJS.NodeJS.LTS`, when Node is missing | Softov, 2026-10-19, chose the recommended answer for "On Windows, how does install.ps1 get Node when it is missing?" | 02 |
| The ahpio-site build reads the scripts from the newest `v*` tag of `softov/ahpd`, so the site serves only released scripts | Softov, 2026-10-19, to "Where does the ahpio-site build read the install scripts from?" - "The newest v* tag" | 03 |
| The scripts are served under `/ahpd/` | Softov, 2026-10-19: 'its better to be inside https://ahpio.com/ahpd/install.sh instead https://ahpio.com/install.sh' | 03 |

## Proposed architecture

- **Data flow** - The scripts live in this repository, under `scripts/install/`. The ahpio-site build copies them into `public/ahpd/`, so the site never holds a copy that is out of date.
- **Shape** - OpenClaw's shape, scaled down: an npm install, not a native binary. A binary waits on node-pty, a native module per platform.
- **Steps in `install.sh`**
  1. Read flags and their `AHPD_*` environment twins. Refuse an unknown flag with exit 2.
  2. Refuse `sudo` from a user shell, as Claude Code does.
  3. Find `node` 22 or later on PATH, then in nvm. Else, on a TTY, ask and install Node through nvm. Without a TTY, stop with the command to get it.
  4. Set the npm prefix to `~/.npm-global` when the global prefix is not writable.
  5. Run `npm install -g --no-fund --no-audit @ahpd/server`, with `--allow-scripts=node-pty` on npm 11.16 or later.
  6. Add the npm bin folder to the rc file of `$SHELL`, with no duplicate line.
  7. On an upgrade, run `ahpd plugin update all` and print `ahpd restart`. Never restart the daemon.
  8. On a TTY and without `--no-onboard`, run `ahpd configure` with stdin from `/dev/tty`.
- **Bun** - `--runtime bun` finds `bun` and installs with `bun add -g @ahpd/server`. node-pty under Bun needs its own install step.
- **Uninstall** - `--uninstall` stops the daemon, removes the service, the package and the PATH line, and keeps `~/.config/ahpd` unless `--purge` is given. INSTALL.md names the one line and the steps by hand.
- **Flags** - `--version <v>`, `--package <spec>`, `--runtime node|bun`, `--no-onboard`, `--dry-run`, `--verbose`, `--help`. PowerShell: `-Version`, `-Package`, `-Runtime`, `-NoOnboard`, `-DryRun`.
- **Tests** - `AHPD_INSTALL_NO_RUN=1` lets a test source the script. CI runs it in a clean container with no Node, with Node 20, and with Node 22.
- **Source-of-truth files** - `scripts/install/install.sh`, `scripts/install/install.ps1`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - install.sh installs ahpd](task-01-install-sh-installs-ahpd.md) | done | - |
| [02 - install.ps1 installs ahpd](task-02-install-ps1-installs-ahpd.md) | done | 01 |
| [03 - The site serves the scripts, and the docs lead with them](task-03-the-site-serves-the-scripts-and-the-docs-lead-with-them.md) | done | 01, 02 |
| [04 - The install script uninstalls](task-04-the-install-script-uninstalls.md) | done | 01, 02 |

## Risks and tradeoffs

- A piped script runs code that the person did not read - The pages show the script URL, and the scripts stay short.
- The script installs Node through nvm - nvm installs into the home folder, so the script still needs no sudo.
- A failed node-pty build - It is optional, so the script warns and names the build tools.

## Resume state

- **Done so far:** the proposal and the research, 2026-10-15. Task 04 and its answers, 2026-10-16. Tasks 01 to 04 written 2026-10-19. Tasks 01, 02 and 04 implemented 2026-10-19: `scripts/install/install.sh`, `scripts/install/install.ps1`, their tests in `scripts/install/test/`, the `install` and `install-windows` CI jobs, and the Uninstall section of `docs/server/INSTALL.md`. Task 03 implemented 2026-10-19 in the ahpio-site worktree `/github/ahpio-site.worktrees/ahpd-27-install-scripts`, branch `ahpd/27-install-scripts`. The build step writes `public/ahpd/install.sh` and `install.ps1` from the newest `v*` tag. The three language catalogues show the one line, and INSTALL.md and GET-STARTED.md lead with it.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none. The tag `v0.14.0` contains `scripts/install/`.
- **Note:** `NVM_INSTALL_URL` is pinned to `v0.40.8`, the latest nvm release on 2026-10-19. The task files say `ahpd service` reports a service, and the CLI has no such verb. The uninstall reads the daemon/31 service file, or the `service` field in `ahpd status --json`, and then runs `ahpd service uninstall`.
- **Watch out for:** `irm | iex` cannot pass parameters, so each flag needs an environment twin. Under `iex`, `exit` closes the person's window; use `throw`. A container often has no `SHELL`, so the shell name falls back to `~/.profile`.

## Final verification checklist

- [x] ahpio.com serves `/ahpd/install.sh` and `/ahpd/install.ps1` with 200, equal to `v0.14.0`, and its three home pages and the install docs lead with the one line. Checked on 2026-11-03.
- [ ] The script installs on a clean Debian, a clean macOS and a clean Windows.
- [ ] A second run upgrades and does not add a second PATH line.
- [x] `plans/index.md` updated.
