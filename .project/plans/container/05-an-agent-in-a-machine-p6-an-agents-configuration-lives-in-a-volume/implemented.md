---
title: An agent's configuration lives in a volume per profile, owner and provider, seeded from the host once - implemented
date: 2026-10-05
refs:
  - git://cecc459
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - `StateNeed`, `Seed`, `StateMode`, `when`, and `seed` and `provider` on `ResolvedNeed`"
  - "[code://packages/sdk/src/machine.ts](../../../../packages/sdk/src/machine.ts) - `resolveNeeds` with the mode, and the seeds resolved"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - `Profile.state`, `Profile.stateScope`, `sameNeed`, `oneNeedEach` and `statesAsked`"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - `stateVolumeOf`, `seedState`, the flags, the label and the removal"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the profile schema and checks, and each volume named before a machine is made"
  - "[code://packages/computer/src/parts.ts](../../../../packages/computer/src/parts.ts) - a long tar path in the ustar prefix, and `firstFileOf`"
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts) - `computerConfigDir` defaulting to `/ahpd/<provider>`"
---

An agent can declare a state directory with the host files that seed it, and a machine from a profile in `state: "volume"`, the default, mounts it as a named volume per profile, owner and provider, or per profile and provider with `stateScope: "shared"`, or per machine id without a profile.
The volume is seeded before the machine starts, only for a seed whose size, mtime or filters changed, and what the agent wrote beside the seeds stays.
Two agents asking for one env value or one state directory get it once, and two asking for different things at one target are refused with both needs named.
`state: "host"` makes exactly the machine made before.

## What was built

- [`code://packages/sdk/src/types/machine.ts`](../../../../packages/sdk/src/types/machine.ts) and [`code://packages/sdk/src/machine.ts`](../../../../packages/sdk/src/machine.ts) - the `state` kind, `when` on every need, and `resolveNeeds(needs, sources, home, mode = 'volume')`, which leaves out a need of the other mode; a state need is `volume` alone, and a seed whose `keep` or `drop` names `__proto__`, `constructor` or `prototype` is refused.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - `Profile.state` and `Profile.stateScope`, the mode passed to resolution, each state need tagged with its provider, `sameNeed` and `oneNeedEach`, state targets in `oneMountEach`, and `statesAsked` and `stateScope` on the spec.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - `state` and `stateScope` in the profile schema and in `profilesOf`, refused by name when neither answer, and `states` named with `stateVolumeOf` before a machine is made, the owner as `claimOf` answers it.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `stateVolumeOf`, `-v <volume>:<dir>` and `--mount type=volume` on the two routes, the `ahpd.state=volume` label, `seedState` with its stamp and filters writing an archive owned by the machine's user with `docker cp -a`, a symlink inside a seeded directory skipped with a log line, a dev container that builds its image seeded after `up` inside its running container, and a machine made without a profile losing its volumes on remove.
- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - a tar path over 100 bytes split into the ustar prefix, a uid, gid and directory type on an entry, and `firstFileOf` for what `docker cp ... -` writes.
- [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) and its `plugin.ts` - `computerConfigDir` defaults to `/ahpd/<provider>`.
- `test/fixtures/docker.mjs` - volume contents kept across containers, a copy in and out by content, `run --rm` and `exec` answering `id`, `cp -a` recording each entry's owner, an entry landing in the volume its path falls in, and an image's `Config.User`.
- `docs/COMPUTER.md` and `packages/agent-claude/README.md`.

## Verified

- `packages/sdk/test/machine-needs.test.ts` (3 new), `packages/computer/test/computer-needs.test.ts` (11 new), `packages/computer/test/computer-options.test.ts` (1 new), `packages/computer/test/computer-state-seed.test.ts` (8, new file) and `packages/agent-claude/test/agent-claude-presets.test.ts` (1 new).
- Each failed before its change, except four guards that passed already: one `-e` for one value, two variants' identical mounts once, a profile's volume kept on remove, and a seed whose source is a link being followed.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` and `pnpm build` green.
- Run once against Docker 29.6.2 on this machine, with an image `FROM node:22-slim` and `USER node`: `ls -lnaR` in the volume showed the root, the directories and the files owned by `1000:1000`, `touch` as `node` worked, and a second create copied nothing.
- A dev container whose definition builds `FROM node:22-slim` with `USER node` was made once through the real Dev Container CLI and Docker: no helper container was created, `ls -lnaR /ahpd/claude` showed the root, `skills/` and every file owned by `1000:1000`, and `touch` as `node` worked in both directories.

## Departures from the plan

- The `ahpd.state=volume` label is put only on a machine with a state volume, not on every machine, so `state: "host"` makes exactly today's flags as the validation asks.
- The profile name in a volume name is lowercased with every character outside `[a-z0-9-]` as a dash, as the owner and the provider are, since a Docker volume name allows only a few characters.
- The stamp is read with `docker cp` out of a helper created from the machine's image, for every image, rather than `docker run ... cat` with a fallback; the seeds are filtered in memory and piped as one tar, so no temporary file is written.
- The helper mounts the volume at `/ahpd-seed/state` and the archive is written into `/ahpd-seed` with every entry under `state/`, rather than with a `./` entry for the volume root, because the real Docker check showed `docker cp -a` does not apply the owner of a `./` entry to the directory it writes into.
- A state volume with no seeds is still stamped the first time, so its root is given to the machine's user and a non-root user can write in it.
- The removal of a profile-less machine's volumes is in the runtime's `remove`, which holds the machine's labels, rather than in the plugin's.
- A profile's or an option's value for a state need names another state directory inside the machine, by the same rule a part's value names another part.
- Task 05's state cases were written with task 02, once the state need existed.
- `plans/index.md` is not updated, as this build was told not to edit it.

## Open questions

- None.

## Left for later

- The by-hand checklist lines against a real Docker, beyond the ownership check above.
- The tasks stay `implemented` until Softov reviews them.
