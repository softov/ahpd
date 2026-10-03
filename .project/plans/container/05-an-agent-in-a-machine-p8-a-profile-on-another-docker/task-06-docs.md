---
title: The docs say how a profile uses another Docker
status: todo
depends: [task-05-dev86s-docker-runs-a-session.md, task-07-a-profile-may-clone-from-origin.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the operator's page"
---

## Objective

`docs/COMPUTER.md` says what `dockerHost` does, how it differs from the plugin's `env.DOCKER_HOST`, what a remote machine cannot mount, and how the code gets there and back.

## Files

- `UPDATE: docs/COMPUTER.md`.

## Steps

1. One example profile against an `ssh://` Docker.
2. Say what `code: "bundle"` and `code: "clone"` each do, that `bundle` is the default and puts no credential in the box, and that `clone` needs the branch on `origin` and a `gitCredential` named from the vault for a private remote.

## Validation

- The option names match `profilesOf`.

## Resume
