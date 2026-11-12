---
title: Docker maps the host address
status: todo
depends:
  - task-01-the-port-answers-a-host-url.md
layer: "computer, docs"
refs:
  - "[code://packages/computer/src/runtime.ts#L3326](../../../../packages/computer/src/runtime.ts#L3326) - `docker run`, where `--add-host` goes"
  - "[code://docs/plugins/PLUGINS.md#L2506-L2510](../../../../docs/plugins/PLUGINS.md#L2506-L2510) - the rule to rewrite"
---

## Objective

The docker runtime answers `reach` with a `host.docker.internal` URL on Docker Desktop, and for a wildcard bind on other Docker.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - read `docker info` once per Docker, and answer `reach`.
- `UPDATE: packages/computer/src/runtime.ts:3326` - add `--add-host host.docker.internal:host-gateway` on Docker that is not Docker Desktop.
- `UPDATE: packages/computer/src/plugin.ts` - the plugin's port answers `reach` from its runtime.
- `UPDATE: docs/plugins/PLUGINS.md:2506-2510` - the new rule.
- `UPDATE: .project/specs/host-tools.md` - the requirement for a machine's address.
- `UPDATE: packages/computer/test/` - cases for Docker Desktop, Linux with loopback and Linux with a wildcard.

## Steps

1. Read `docker info --format {{.OperatingSystem}}` once per Docker, and keep whether it names `Docker Desktop`.
2. On Docker Desktop, answer `reach` with the URL's host replaced by `host.docker.internal`, for loopback and wildcard hosts.
3. On other Docker, answer it the same way for a wildcard host only, and `undefined` for loopback.
4. Add `--add-host host.docker.internal:host-gateway` at `docker run` on other Docker.
5. Give no answer for a remote Docker or an ssh runtime.
6. Rewrite the rule in `PLUGINS.md` and `specs/host-tools.md`.
7. Write the computer cases with a fake `docker info`.

## Validation

- The new cases for each Docker and bind.
- By hand on the Windows VM: start the daemon on 127.0.0.1, and see the host tools in a machine session.
- By hand on the Windows VM: call one host tool, and see it reach the daemon.
- `pnpm typecheck` and the computer suite pass.

## Resume
