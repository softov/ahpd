---
title: The container installs its backends
status: done
depends: [task-01-install-and-remove.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L235-L262](../../../../packages/computer/src/devcontainer.ts#L235-L262) - the install step, which installs only the server"
  - "[code://packages/computer/src/devcontainer.ts#L69](../../../../packages/computer/src/devcontainer.ts#L69) - `plugins`, the list the host inside is given"
  - "[code://test/devcontainer.test.ts](../../../../test/devcontainer.test.ts) - the install line's existing cases"
---

## Objective

A dev container host whose `devcontainer.plugins` names `@ahpd/agent-cofold` installs it next to the server and starts.

## Files

- `UPDATE: packages/computer/src/devcontainer.ts` - after the server install, run `ahpd plugin install --no-enable <names>` for the npm-named entries of `plugins`.
- `UPDATE: test/devcontainer.test.ts` - the new line and its skips.

## Steps

1. Pick the entries of `plugins` whose name is a package name, not a path or a URL, using the same test as task 01.
2. When there are any and `install !== false`, run `ahpd plugin install --no-enable <names>` inside the container after the server is present. `--no-enable` because the host inside is given its plugins on the command line.
3. On failure, throw a sentence naming the plugin and npm's stderr, like the server install does.
4. Run it whether or not the server was already present, since an image with the server may still lack the backend. Skip a package the probe finds already resolvable.

## Validation

- `test/devcontainer.test.ts`: the plugin line runs after the server line; not run for path-only plugins; not run with `install: false`; a failure refuses with the plugin's name.
- By hand: a dev container session with `"plugins": ["@ahpd/agent-cofold"]` and no mounted checkout starts and answers a turn.

## Resume

Implemented 2026-09-26 in `packages/computer/src/devcontainer.ts`: after the server probe and install, every `plugins` entry that is a package name is installed with `ahpd plugin install --no-enable`, whether or not the image already had the server.
`test/devcontainer.test.ts` covers the line's position, a path-only list, `install: false`, a started image, and a failure naming the plugin.
One deviation: step 4's "skip a package the probe finds already resolvable" is left to npm, which is the thing that knows whether a package is installed; a start that finds it there pays a lookup rather than a build. The real-container half under *Validation* is the verifier's.

