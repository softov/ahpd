---
title: The docs say how the image gets ahpd and what a nested session does
status: todo
depends: [task-17-a-backend-names-its-nested-plugin.md, task-11-a-nested-session-resumes-by-id.md, task-12-the-proxy-answers-only-what-it-knows.md, task-13-models-sign-in-and-requests-cross-the-proxy.md, task-14-the-working-directory-is-the-machines.md, task-15-close-waits-for-the-inner-dispose.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md#L132-L169](../../../../docs/COMPUTER.md#L132-L169) - the nested section, whose image example cannot find its plugin"
  - "[code://docs/CONTAINERS.md#L83](../../../../docs/CONTAINERS.md#L83) - the dev container launcher's `plugin install --no-enable`, the pattern to copy"
---

## Objective

`docs/COMPUTER.md` has an image example that works, and says what a nested session does when its host ends, how it resumes, and where it works inside the machine.

## Files

- `UPDATE: docs/COMPUTER.md:146-149` - `RUN npm i -g @ahpd/server @ahpd/agent-cofold`.
- `UPDATE: docs/COMPUTER.md:132-169` - the rest of the nested section.

## Steps

1. Replace the image example with `npm i -g @ahpd/server` and `ahpd plugin install --no-enable @ahpd/agent-cofold`, per [the decision](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md), and say that until the package is published it is installed from a packed tarball or a path.
2. Say that a session whose inner host ended refuses what follows with the reason, that a resume continues the transcript the machine holds and fails when the machine has gone, and that the inner session works at the mounted path.
3. Replace "The plugin a provider needs is `@ahpd/agent-<provider>`" and `runsNested: true` with `runsNested: { plugin }`, the package the backend names, per [the decision](../../../decisions/a-backend-that-runs-nested-names-its-plugin.md), and say that the inner host takes nothing from the outer plugin's options: what holds inside a machine is its profile and cofold's configuration file, per [the decision](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md).
4. One sentence per line where the section is rewritten, no em dashes, no hard wrap.

## Validation

- Build the example image and run `docker run --rm -i <image> ahpd --stdio --plugin @ahpd/agent-cofold` with an `initialize` line on stdin; it answers `initialize` rather than `Plugin @ahpd/agent-cofold is not installed`.
- Every link in the section resolves.

## Resume
