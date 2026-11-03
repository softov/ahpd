---
title: The site serves the scripts, and the docs lead with them
status: implemented
depends: [task-01-install-sh-installs-ahpd.md, task-02-install-ps1-installs-ahpd.md]
layer: docs
refs:
  - "[code://docs/server/INSTALL.md](../../../../docs/server/INSTALL.md) - the install page, which starts at `npm i -g`"
  - "[code://docs/server/GET-STARTED.md](../../../../docs/server/GET-STARTED.md) - step 1 installs with npm"
  - https://github.com/softov/ahpio-site - the site; Astro serves its `public/` folder from the root, and `npm run deploy` builds it
---

## Objective

`https://ahpio.com/ahpd/install.sh` and `https://ahpio.com/ahpd/install.ps1` serve the scripts of this repository, and the site holds no copy that is out of date.
INSTALL.md and GET-STARTED.md show the one line first and keep `npm i -g` as the way by hand.

## Files

- `CREATE: ../ahpio-site/scripts/install-scripts.mjs` - a step that writes `public/ahpd/install.sh` and `public/ahpd/install.ps1` from this repository before the build.
- `UPDATE: ../ahpio-site/package.json` - a `prebuild` script that runs it.
- `UPDATE: ../ahpio-site/.gitignore` - ignore the two copied files, `ahpd/install.sh` and `ahpd/install.ps1`, so no copy is committed.
- `UPDATE: docs/server/INSTALL.md` - the one line for each system first, with the script URL, then `npm i -g` under "By hand".
- `UPDATE: docs/server/GET-STARTED.md` - step 1 shows the one line, and says that it runs step 2 on a terminal.

## Steps

1. Write `install-scripts.mjs` to read the two scripts from the newest `v*` tag of `softov/ahpd` on GitHub.
2. Stop the build with an error when the step cannot read a script.
3. Add the `prebuild` script and the two `.gitignore` lines in the site.
4. Put the one line for bash and for PowerShell at the top of INSTALL.md, in a code group.
5. Link the script URLs next to the one line, so a person can read the script first.
6. Name the flags and their environment twins in INSTALL.md.
7. Keep `npm i -g @ahpd/server --allow-scripts=node-pty` under a "By hand" heading.
8. Change step 1 of GET-STARTED.md to the one line.
9. Say in GET-STARTED.md that the script runs step 2 on a terminal.
10. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `npm run build` in the site writes `dist/ahpd/install.sh` and `dist/ahpd/install.ps1`, equal to the files in this repository.
- `npm run build` stops with an error when the step cannot read a script.
- `git status` in the site shows no `public/ahpd/install.*` file to commit.
- `pnpm -s docs:build` passes, and the prose lint prints nothing new for the two pages.
- By hand, after a deploy: `curl -fsSL https://ahpio.com/ahpd/install.sh | head -1` prints the shebang.

## Resume

- **Done so far:** `scripts/install-scripts.mjs` in ahpio-site reads the newest `v*` tag of `softov/ahpd` with the GitHub tags API, downloads `scripts/install/install.sh` and `install.ps1` from `raw.githubusercontent.com`. It writes them byte for byte to `public/ahpd/`. It stops with a non-zero exit and names the URL when the API or a download fails. It reads `GITHUB_TOKEN` when the build machine has one. `package.json` has a `prebuild` step for it, and `.gitignore` ignores the two copied files. The site's get-started step in the English, Spanish and Portuguese catalogues now shows the one line and names the PowerShell line. INSTALL.md leads with the two one lines and links both script URLs. It names every flag with its PowerShell name and `AHPD_*` environment twin, and keeps `npm i -g @ahpd/server --allow-scripts=node-pty` under "By hand". GET-STARTED.md step 1 shows the one line and says that the script runs step 2 on a terminal. The prose lint prints nothing for INSTALL.md, and only the pre-existing long line 5 for GET-STARTED.md. `pnpm -s docs:build` passes. `npm ci` installed the site's dependencies from its `package-lock.json`, and Astro built its five pages with the three catalogues. A run of the step against stubbed tags picked `v10.0.0` over `v9.9.9` and a release over its prereleases. It wrote both files equal to the two in this repository.
- **Next action:** none. The site is deployed, and its checks passed on 2026-11-03 at `v0.14.0`.
- **Open questions:** the newest `v*` tag, `v0.12.0` (2026-10-15), predates the install scripts, so the step stops with `404 Not Found` for `scripts/install/install.sh` at that tag. The site cannot build until a release includes the scripts; this is the error the step is meant to stop with, not a defect. `npm ci` and `npm run build` ran there with `--prefix` on 2026-10-19. `git status` in the site worktree was not run here, because this session refuses `git`.
- **Watch out for:** the site is its own repository with its own commits and its own deploy, and Softov deploys it. Its pages are in three languages, so a line added to a page needs all three. The get-started step is in `src/i18n/en.ts`, `es.ts` and `pt.ts`, and `Catalogue = typeof en` makes a missing key a build error. The installed step writes into `public/`, which Astro serves from the site root and copies into `dist/`.
