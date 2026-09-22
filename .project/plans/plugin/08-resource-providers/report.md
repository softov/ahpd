---
title: A plugin serves a host-owned URI scheme - report
date: 2026-09-22
refs:
  - code://.project/plans/plugin/08-resource-providers/plan.md
  - code://.project/plans/plugin/08-resource-providers/implemented.md
  - code://scripts/computer.mjs
  - code://docs/COMPUTER.md
---

Written after the plan closed, to say what is in the tree today, what landed beside the plan without a record, and what the records still get wrong.
Nothing here changes the plan's conclusion: all three tasks are built and the code is in `main`.

## Re-verified today

Checked against the working tree at `0194e5e`, clean except untracked `HANDOFF.md` and `TEST.md`.

- Every symbol the plan names is present in `packages/sdk/src`: `ResourceProvider`, `registerResourceProvider`, `HostOptions.resourceProviders`, `checkScheme`, `checkResourceProvider`, `reservedScheme` and `storeFor`.
- The fixture is where task 03 put it: `test/fixtures/plugin-uri-resources/` with `package.json` and `index.ts`.
- The five test files the plan touches run green, 32 tests: `plugin-validate` 12, `plugin-fold` 10, `plugin-host` 2, `uri-resources` 5, `uri-resources-plugin` 3. The counts match `implemented.md` exactly, so nothing has drifted since it was written.

## What landed after the plan closed, and is in no record

Commit `0194e5e`, *Add a disposable-computer script and the Docker and KVM setup*, is the first piece of what `implemented.md` filed under *Left for later*. It adds `scripts/computer.mjs` (209 lines), `docs/COMPUTER.md` (112 lines), a README row and two lines in `docs/PLUGINS.md`, and it is referenced from no `.project/` artifact at all.

It is the operator's half, not the provider: one Docker container owned by name and labelled `ahpd.computer=1`, with `start`, `status`, `exec`, `stop`, `rm` and `list`, plus `--cpus`, `--memory`, `--mount`, `--kvm` and `--label`. `docs/COMPUTER.md` says so itself under *What this is not*, and names this plan as the thing that built the scheme.

Exercised here, read-only: `list` prints its header and no rows, `status` answers `No computer named ahpd-computer.` and exits 1, an unknown verb prints the usage and exits 2, and `start --kvm` refuses with exit 2 and the two `usermod` commands before it starts anything. The container-starting verbs were not run, so `start`, `exec`, `stop` and `rm` are unexercised.

The script has no tests and its own header says it is not run by them. That is a deliberate choice it states, not an oversight, but it means the four verbs that touch Docker are covered by nothing.

## The machine moved under the docs

`docs/COMPUTER.md` and `.project/research` in `ahp-server` both describe an account that cannot reach Docker. That is no longer true here: `softov` is in the `docker` group and `docker info` answers `29.6.2`. The `kvm` half is unchanged, `softov` is not in the `kvm` group and `/dev/kvm` is not readable, so the first of the two `usermod` commands has been applied and the second has not.

## Corrections the records need

- The three task files carry `status: todo` in their frontmatter while their own *Resume* sections say `Done 2026-09-23` and the plan's task table says `done`. The frontmatter is what a reader greps; it should say `done`.
- Every `.project` record for this plan is dated `2026-09-23`, and the commits that carry the work are dated `Tue Sep 22 12:47 -0400`. The work is the 22nd by both the committer clock and UTC. The dates in `plan.md`, `implemented.md`, the three task files and the `plans/index.md` row are a day ahead.
- `implemented.md` should gain a line for `0194e5e`, because *Left for later* now reads as if nothing was started and a script exists.

## Still open

- A real `computer:` provider, and whatever it asks for a machine. The scheme routes, the fixture answers, and the script starts a container; nothing connects the three.
- Release. This plan and `host/05` are both unreleased, and a `0.6.4` would carry them together.

## Applied 2026-09-22

- The three task files say `status: done` in their frontmatter.
- Every `2026-09-23` date was corrected to `2026-09-22`, the corrections above included. The dates were a day ahead across this plan, `host/04`, `host/05`, `plugin/07`'s daemon run, the four decisions those produced, `plans/index.md` and `plugin/00-plugin.md`.
- `implemented.md` gained the `0194e5e` line and a truthful line about the substrate.
- Both `usermod` commands are now applied, not one: the account was already in `docker`, the `kvm` group was added and a session started after it, and `/dev/kvm` is readable. The Proxmox host was not the obstacle - the guest sees the `vmx` flag and `kvm_intel` reports `nested = Y`.
- The four verbs this report left unexercised were exercised by the session that wrote the script: `start` on `curlimages/curl`, `status`, `exec` (`hello from Linux`), idempotent `start`, `stop`, `rm`, the `exec`-while-stopped refusal and the `--kvm` refusal, with no container left behind.
