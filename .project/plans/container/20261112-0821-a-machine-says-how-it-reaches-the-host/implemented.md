---
title: A machine says how it reaches the host - implemented
date: 2026-11-12
refs:
  - git://9f86a7097 - the commit this branch was built on; the work below is uncommitted
  - "[`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts) - `ComputerPort.reach`"
  - "[`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - `serversFor` uses the answer"
  - "[`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - the docker runtime's answer and `--add-host`"
  - "[`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the plugin's port answers `reach`"
  - "[`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the new rule"
  - "[`code://.project/specs/host-tools.md`](../../../../.project/specs/host-tools.md) - the requirement for a machine's address"
---

A session in a machine now gets the host's tools where Docker publishes the host under a name the machine can reach.
Docker Desktop answers `host.docker.internal` for a daemon on a loopback or wildcard address, so those sessions stop losing the tools.
Other Docker answers it for a wildcard bind, and makes its machines with the same name pointed at the host's gateway.
A runtime with no answer keeps the old reading, so a loopback daemon elsewhere still leaves the tools out with the same line.

## What was built

- [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts) - `reach?(id, url)` beside `state`, documented as the URL a machine uses for an address of this host's, or `undefined`.
- [`code://packages/sdk/src/machines/computers.ts`](../../../../packages/sdk/src/machines/computers.ts) - unchanged: `computersFor` spreads the port, so `reach` is already carried.
- [`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - `serversFor` is async and takes the machine id, asks `computers.reach` for a machine session, and uses the answer in place of the endpoint's URL.
- [`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - no answer falls back to `toolsReachable` and the `cannot reach the daemon` line.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `reach` maps loopback and wildcard hosts on Docker Desktop, wildcard alone on other Docker, and a dev container only on Docker Desktop.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `onDockerDesktop` reads the operating system from the one `docker info --format {{json .}}` that `canMountImages` already runs.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - the image `run` adds `--add-host host.docker.internal:host-gateway` on other Docker, and not for a remote Docker.
- [`code://packages/computer/src/router.ts`](../../../../packages/computer/src/router.ts) - `reach` is routed by the id, and a runtime without one answers nothing.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the plugin's port answers `reach` from the runtime the id names.
- [`code://packages/computer/test/fixtures/docker.mjs`](../../../../packages/computer/test/fixtures/docker.mjs) - `docker info --format {{json .}}` answers an operating system, and `--add-host` is a flag with a value.
- [`code://packages/computer/test/computer-reach.test.ts`](../../../../packages/computer/test/computer-reach.test.ts) - each Docker and bind, a dev container, `--add-host` on and off, a remote Docker and the plugin's port.
- [`code://packages/computer/test/computer-parts-mount.test.ts`](../../../../packages/computer/test/computer-parts-mount.test.ts) - the case with image mounts off expects the one `info` call that the Docker Desktop check needs.
- [`code://packages/agent-acp/test/agent-acp-catalog.test.ts`](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts) - `inBox` takes a `reach`, with a case for an answer and one for no answer.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the host-tools paragraph says the new rule.
- [`code://.project/specs/host-tools.md`](../../../../.project/specs/host-tools.md) - *A machine says where the host is*, with the port's ref and the file in `covers`.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the worktree root is clean.
- The suites at review, 2026-11-12: sdk 4763 passed, 5 skipped; agent-acp 375 passed; computer 615 passed, 1 skipped, 1 failed. The failure, `computer-spawn.test.ts` "fails a turn on a session whose CLI is gone", times out on `main` too.
- The scripted Docker was read to confirm `info --format {{json .}}` answers an operating system, and that `--add-host` is not read as the image.
- One `docker info` answers both questions, asked once at a make. A daemon that does not answer is asked again at the next make or reach.

## Departures from the plan

- *Files* names `packages/sdk/src/machines/computers.ts`, and this is not edited. The gated port spreads the rest of the port, so `reach` is carried already. Wrapping it as `how` is would inspect a machine on every call, for an answer that does not depend on the machine.
- `--add-host` is left off for a remote Docker, since `host-gateway` is that box's host and not this one. The plan's step 5 gives no answer there, and a flag with no answer behind it would be a name that reaches nothing.
- `serversFor` takes the machine id rather than the `computer://` spelling it took before. The spelling is built where the line is said, and `machineIdOf` still supplies the id.
- The computer cases are one new file, `computer-reach.test.ts`, with the plugin case in it. The plan names the folder and not a file.
- A dev container has no `--add-host` on other Docker, so `reach` answers nothing for it there and `serversFor` keeps its own reading.
- The Answers table records this as `(defaulted: a name the container cannot resolve is not answered)`.

## Left for later

- The two manual checks on the Windows VM.
