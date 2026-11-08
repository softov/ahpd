---
title: Nested hosts
status: current
covers:
  - packages/sdk/src/sessions/nested.ts
  - packages/sdk/src/host/spawn.ts
  - packages/sdk/src/types/agent.ts
  - packages/sdk/src/types/computers.ts
  - packages/sdk/src/plugins/plugins.ts
  - packages/computer/src/plugin.ts
  - packages/computer/src/parts.ts
decisions:
  - decisions/a-nested-host-speaks-stdio.md
  - decisions/cofold-config-reaches-a-machine-by-a-path-variable.md
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L1-L35](../../packages/sdk/src/sessions/nested.ts#L1-L35) - the proxy session, and what a `Start` passes on"
  - "[code://packages/sdk/src/sessions/nested.ts#L170-L204](../../packages/sdk/src/sessions/nested.ts#L170-L204) - `nestedAgent` and `startInside`"
  - "[code://packages/sdk/src/sessions/nested.ts#L716-L730](../../packages/sdk/src/sessions/nested.ts#L716-L730) - `servedAs`, which ends a variant's session"
  - "[code://packages/sdk/src/sessions/nested.ts#L803-L806](../../packages/sdk/src/sessions/nested.ts#L803-L806) - the protocol version check"
  - "[code://packages/sdk/src/sessions/nested.ts#L1189-L1239](../../packages/sdk/src/sessions/nested.ts#L1189-L1239) - `deleteNested`, the copy inside removed"
  - "[code://packages/sdk/src/host/spawn.ts#L516-L542](../../packages/sdk/src/host/spawn.ts#L516-L542) - when a session runs nested"
  - "[code://packages/sdk/src/plugins/plugins.ts#L365-L368](../../packages/sdk/src/plugins/plugins.ts#L365-L368) - the plugin spec kept for each agent"
  - "[code://packages/sdk/src/types/agent.ts#L547-L561](../../packages/sdk/src/types/agent.ts#L547-L561) - `runsNested`"
  - "[code://packages/sdk/src/types/computers.ts#L36-L51](../../packages/sdk/src/types/computers.ts#L36-L51) - `NestedStart`"
  - "[code://packages/computer/src/plugin.ts#L1492-L1520](../../packages/computer/src/plugin.ts#L1492-L1520) - `nestedHost`, the command that starts a host in a machine"
  - "[code://packages/computer/src/parts.ts#L645-L662](../../packages/computer/src/parts.ts#L645-L662) - the `ahpd` part, with its plugins put in by `ahpd plugin install`"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-backend-that-runs-nested-names-its-plugin, a-cofold-session-in-a-computer-runs-in-a-nested-host, a-nested-host-gets-a-per-session-proxy-token-and-url, a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install, a-nested-host-is-configured-by-the-machine-profile-only, a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent, a-nested-session-resumes-its-inner-transcript-by-id, a-session-reaches-a-nested-host-through-a-generic-proxy, any-ahpd-can-be-the-hub, the-host-records-which-plugin-registered-each-agent
---

A nested host is a whole `ahpd`, started in stdio mode inside a [computer](computers.md), that runs one session's agent there.
The outer host keeps the session that a client sees, and a proxy backend in the SDK carries it.
The proxy speaks AHP to the host inside with `AhpClient`.
It sends back what that host says as the session's own actions.
The host uses this route for a backend that cannot move its own process into a machine, such as cofold.
It also uses it for every machine that is not on this host.
The code is in [`code://packages/sdk/src/sessions/nested.ts`](../../packages/sdk/src/sessions/nested.ts), and the command that starts the host inside is in [`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts).

## Scenarios

### A session runs nested only where it has to

WHEN a session names a computer
AND its agent says `runsNested: true`, or the machine is off this host
THEN the host runs the session through the proxy backend.
WHEN the agent does not say `runsNested`
AND the machine is on this host
THEN the backend reaches the machine with the command that the `computers` port gives, as Claude Code and ACP agents do.
A session that names no computer runs on this host in either case.

### A cofold session in a computer

WHEN a cofold session names a computer
THEN the host starts `ahpd --stdio --plugin @ahpd/agent-cofold` inside the machine
AND the session runs there.
The reason: cofold's loop, tools and shell all run in its own process, so only a whole host can take them into a machine.
cofold's configuration reaches the machine as a machine need, and `PAPO_CONFIG` names the file there.

### The host inside loads the agent's own plugin

WHEN a plugin registers an agent
THEN the host keeps the plugin's spec for that agent
AND a nested session of the agent passes that spec as one `--plugin` to the host inside.
WHEN the host has no spec for the agent
THEN the session ends with a sentence that says so, and nothing is started.
The host inside loads the plugin with its defaults, so the outer plugin's options do not reach it.

### A preset agent does not run nested

WHEN the host inside does not serve the session's agent by name
AND the agent is a variant, made from a preset
THEN the session ends with a sentence that names the agents the host inside does serve.
The reason: the host inside loads the plugin without the preset, so the plain agent would use the wrong endpoint and keys.
An agent that is not a variant runs as the single agent the host inside serves.

### The command that starts the host inside

WHEN the proxy asks the `computers` port for a nested host
THEN the plugin starts the command from the machine's recipe, with `ahpd` as the default, followed by `--stdio` and the plugins
AND it reaches the machine the way every command does, such as `docker exec` or ssh.
The session's folder is mapped through the machine's mounts, or the machine's own folder is used, and the inner session starts there.
A machine off this host gets no value from this host's vault.

### The host inside comes from the ahpd part

WHEN the `ahpd` part is built from the published version
THEN its image installs `@ahpd/server` with npm and each nested plugin with `ahpd plugin install --no-enable`
AND a machine with that part mounted has the host and its plugins with no install at session start.
A part built from this checkout installs the packed plugins with npm, because `ahpd plugin install` takes a package name and not a path.

### The two hosts speak one protocol version

WHEN the host inside answers `initialize` with a protocol version that this host does not speak
THEN the session ends with a sentence that names both versions.
The reason: the proxy sends the inner actions on with only their chat URIs changed, so both hosts read them the same way.
An action that this build does not know is sent on without being kept in the outer state.

### Turns go by the same ids

WHEN a client sends a turn to a nested session
THEN the proxy sends it to the host inside with the same turn id
AND a client's optimistic write matches what comes back.

### A nested session resumes

WHEN a nested session resumes
THEN the inner session goes by the outer session's id, so the host inside continues the transcript that the machine holds.
WHEN the host inside holds no session by that id
THEN the proxy makes one and writes a log line.

### A failure is a sentence

WHEN the host inside is missing, exits before it answers or refuses the session
THEN the outer session ends with a sentence and the last lines that the host inside wrote to stderr
AND every request after that is refused with the same sentence.
A failure never leaves the session waiting with no answer.

### A nested session that is not running is deleted

WHEN a person deletes a nested session that no host runs
AND the machine's profile says `nestedDelete: "inside"`, or says nothing
THEN the host starts a host inside the machine and disposes the session's copy there.
WHEN the profile says `nestedDelete: "record"`
THEN the copy inside stays, so the session can come back where it was left.

### What the proxy does not pass on

WHEN the outer host starts a nested session
THEN the proxy passes on `resume` and the session config, without the `computer` key
AND it does not pass on credentials, host tools, instructions or this host's paths.
The machine gets its keys as the agent's machine needs say.

## Known gaps

A nested host does not yet get the session's proxy token and URL, and `NestedStart` carries no environment.
[A machine off this host reaches its models through the proxy](../plans/container/05-p12-off-host-machine-reaches-models-via-proxy/plan.md) plans this.
`ahpd join <url>`, where one ahpd dials another that then lists it as a computer, is planned in [a host joins a hub](../plans/container/05-p10-a-host-joins-a-hub/plan.md).
