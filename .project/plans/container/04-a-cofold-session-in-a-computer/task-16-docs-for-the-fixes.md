---
title: The docs say how the image gets ahpd and what a nested session does
status: done
depends: [task-17-a-backend-names-its-nested-plugin.md, task-11-a-nested-session-resumes-by-id.md, task-12-the-proxy-answers-only-what-it-knows.md, task-13-models-sign-in-and-requests-cross-the-proxy.md, task-14-the-working-directory-is-the-machines.md, task-15-close-waits-for-the-inner-dispose.md]
layer: "docs | sdk test"
refs:
  - "[code://docs/COMPUTER.md#L132-L169](../../../../docs/COMPUTER.md#L132-L169) - the nested section, whose image example cannot find its plugin"
  - "[code://docs/CONTAINERS.md#L83](../../../../docs/CONTAINERS.md#L83) - the dev container launcher's `plugin install --no-enable`, the pattern to copy"
  - "[code://packages/server/src/config.ts#L218-L222](../../../../packages/server/src/config.ts#L218-L222) - `configHome` and `configDir`, `$XDG_CONFIG_HOME/ahpd` or `~/.config/ahpd`"
  - "[code://packages/server/src/config.ts#L308](../../../../packages/server/src/config.ts#L308) - `ensureConfigDir`, which a nested ahpd runs and which fails with `EACCES` where that directory cannot be made"
---

## Objective

`docs/COMPUTER.md` has an image example that works, and says what a nested session does when its host ends, how it resumes, and where it works inside the machine.
The example's user has a writable `HOME` and `XDG_CONFIG_HOME`, because a nested ahpd exits with `EACCES` when it cannot make `$XDG_CONFIG_HOME/ahpd`, and a test proves that exit reaches the session as a sentence.

## Files

- `UPDATE: docs/COMPUTER.md:146-149` - `RUN npm i -g @ahpd/server @ahpd/agent-cofold`.
- `UPDATE: docs/COMPUTER.md:132-169` - the rest of the nested section.
- `UPDATE: packages/sdk/test/nested-process.test.ts` (created by task 07) - the read-only config directory case.

## Steps

1. Replace the image example with `npm i -g @ahpd/server` and `ahpd plugin install --no-enable @ahpd/agent-cofold`, per [the decision](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md), and say that until the package is published it is installed from a packed tarball or a path.
2. Say that a session whose inner host ended refuses what follows with the reason, that a resume continues the transcript the machine holds and fails when the machine has gone, and that the inner session works at the mounted path.
3. Replace "The plugin a provider needs is `@ahpd/agent-<provider>`" with: the inner host loads the plugin that registered the agent, whatever its name or source, per [the decision](../../../decisions/the-host-records-which-plugin-registered-each-agent.md), and say that the inner host takes nothing from the outer plugin's options: what holds inside a machine is its profile and cofold's configuration file, per [the decision](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md).
4. Say that the image's user must own a writable `HOME` and `XDG_CONFIG_HOME`, and that no mount may land under them: Docker makes the parent directories of a bind target as root, so a mount under `~/.config` leaves `~/.config/ahpd` unwritable and the nested ahpd exits with `EACCES`. The example sets the user and creates its home.
5. Add a case to `packages/sdk/test/nested-process.test.ts`: the real inner host started with `XDG_CONFIG_HOME` pointed at a read-only temporary directory ends the session with a sentence carrying the inner host's `EACCES` line, and the outer process does not throw.
6. One sentence per line where the section is rewritten, no em dashes, no hard wrap.

## Validation

- By hand (Softov): build the example image and run `docker run --rm -i <image> ahpd --stdio --plugin @ahpd/agent-cofold` with an `initialize` line on stdin; it answers `initialize` rather than `Plugin @ahpd/agent-cofold is not installed`.
- By hand (Softov): in the built image, `id -u` is not 0 and `test -w "${XDG_CONFIG_HOME:-$HOME/.config}"` succeeds.
- `node_modules/.bin/vitest run packages/sdk/test/nested-process.test.ts` passes, with the read-only `XDG_CONFIG_HOME` case among its cases.
- Every link in the section resolves.

## Resume

Implemented 2026-10-06.
`docs/COMPUTER.md`'s "A backend that runs nested" section is rewritten: the plugin that registered the agent, profile-only configuration, the image example installing with `ahpd plugin install --no-enable` as `node`, the writable HOME and XDG rule and its `EACCES` end, an ended session, resume, and the mounted working directory.
The EACCES process case passed already, as a guard.
The example image was built with Docker 29.6.2 and started `ahpd --stdio --plugin @ahpd/agent-cofold` as uid 1000 and answered `initialize`; it was removed after.
