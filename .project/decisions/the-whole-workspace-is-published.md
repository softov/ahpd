---
title: One tag publishes every package in the workspace, `@ahpd/computer` included
status: accepted
date: 2026-09-25
refs:
  - code://.github/workflows/release.yml - `PUBLISHED`, which the tag check now reads too
  - code://.project/decisions/the-computer-is-not-published-yet.md - the decision this replaces
  - code://DEVELOPER.md - the checklist somebody follows
  - code://packages/computer/package.json - the package that was held back
---

## Context

Three packages were versioned with the release and staged by nothing: `@ahpd/computer`, held back until it had been tried against a real machine, and `@ahpd/agent-pi` and `@ahpd/tunnel-devtunnel`, which arrived after `PUBLISHED` was last written and were never added to it.

The hold on the computer has expired on its own terms. It has made containers, run sessions inside them, and a whole host inside a dev container runs on it. The other two were an oversight rather than a decision, and the cost is the same either way: a plugin named by package name is a plugin only somebody with a checkout can load, so `plugins: ["@ahpd/tunnel-devtunnel"]` is a line in the documentation that nobody reading it can run.

The user, 2026-09-25: "computer also... we will publish it..."

## Decision

`PUBLISHED` names every package in the workspace, in dependency order, and the tag check reads that same list rather than a second copy of it. Eight packages, `sdk` first and `server` last.

A name npm has never seen still needs its first version published with a token before OIDC can stage anything for it, which the workflow already says and refuses to guess at. The three new names are bootstrapped with a stub - a `package.json` and nothing else, at a version below the tag's - so the trusted publisher can be configured on a package that exists. A stub at the tag's own version would make the release skip that package as already published, which is the one way this goes quietly wrong.

## Consequences

Every documented plugin can be installed by the name the documentation uses.

`@ahpd/computer` is on npm from 0.7.0, so it is a version somebody can install and depend on. What it does with Docker, and what an operator has to allow it, is documented in `docs/COMPUTER.md`, and the images it may run are the ones the deployment names.

The tag check and the publish list cannot drift apart any more: they are one list.

## Options

- **Keep the computer held back.** Rejected: the thing it was waiting for has happened, and a package nothing stages is a version that silently stops matching its own documentation.
- **Publish the plugins and keep the computer out.** Rejected: it leaves the same two lists disagreeing, which is what went wrong for `agent-pi` and `tunnel-devtunnel` in the first place.
- **A stub at the release's own version.** Rejected: the workflow skips a version already on npm, so the real tarball for that package would never be staged.
