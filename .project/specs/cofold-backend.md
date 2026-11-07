---
title: Cofold backend
status: current
covers:
  - packages/agent-cofold/src/**
decisions:
  - decisions/cofold-config-reaches-a-machine-by-a-path-variable.md
  - decisions/the-host-puts-each-tool-question-and-keeps-the-sessions-answer.md
refs:
  - "[code://packages/agent-cofold/src/config.ts#L57-L59](../../packages/agent-cofold/src/config.ts#L57-L59) - `harnessConfigPath`, where the harness file is found"
  - "[code://packages/agent-cofold/src/agent.ts#L113](../../packages/agent-cofold/src/agent.ts#L113) - `defaultStoreRoot`, the store at cofold's home"
  - "[code://packages/agent-cofold/src/agent.ts#L218-L222](../../packages/agent-cofold/src/agent.ts#L218-L222) - `modelReferenceOf`, the order a model reference is taken in"
  - "[code://packages/agent-cofold/src/agent.ts#L233-L268](../../packages/agent-cofold/src/agent.ts#L233-L268) - `connectionOf`, the endpoint, key and the two errors a turn can give"
  - "[code://packages/agent-cofold/src/agent.ts#L335-L346](../../packages/agent-cofold/src/agent.ts#L335-L346) - `modelOf`, where a chosen effort becomes a request param"
  - "[code://packages/agent-cofold/src/agent.ts#L589-L623](../../packages/agent-cofold/src/agent.ts#L589-L623) - the session schema and its `permissionMode` property"
  - "[code://packages/agent-cofold/src/agent.ts#L400-L433](../../packages/agent-cofold/src/agent.ts#L400-L433) - `rowOf`, a model's own `thinkingLevel`"
  - "[code://packages/agent-cofold/src/agent.ts#L725-L740](../../packages/agent-cofold/src/agent.ts#L725-L740) - `probe`, the endpoint's models with the configured one first"
  - "[code://packages/agent-cofold/src/turnagent.ts#L31-L47](../../packages/agent-cofold/src/turnagent.ts#L31-L47) - `insideDirectory` and `memoryDirOf`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L101-L108](../../packages/agent-cofold/src/turnagent.ts#L101-L108) - `modeOf`, with `auto` as the default mode"
  - "[code://packages/agent-cofold/src/turnagent.ts#L393-L399](../../packages/agent-cofold/src/turnagent.ts#L393-L399) - the policy a turn runs under"
  - "[code://packages/agent-cofold/src/turnagent.ts#L195-L215](../../packages/agent-cofold/src/turnagent.ts#L195-L215) - `onFileEdit`, the edits reported before and after a write"
  - "[code://packages/agent-cofold/src/capabilities.ts#L26-L52](../../packages/agent-cofold/src/capabilities.ts#L26-L52) - `DEFAULT_TOOLS` and `capabilitiesOf`"
  - "[code://packages/agent-cofold/src/session.ts#L91](../../packages/agent-cofold/src/session.ts#L91) - the root of a session with no working directory"
  - "[code://packages/agent-cofold/src/turns.ts#L116-L164](../../packages/agent-cofold/src/turns.ts#L116-L164) - the model reference a turn runs on"
  - "[code://packages/agent-cofold/src/turns.ts#L210-L218](../../packages/agent-cofold/src/turns.ts#L210-L218) - the reference given to the run as an option"
  - "[code://packages/agent-cofold/src/transcript.ts#L227-L237](../../packages/agent-cofold/src/transcript.ts#L227-L237) - the run's model read back into a turn"
  - "[code://packages/agent-cofold/src/runs.ts#L34-L48](../../packages/agent-cofold/src/runs.ts#L34-L48) - `cut`, the fork and the rewind"
  - npm://@cofold/agents@0.4.0 - `dist/policy/modes.js`, `policyOf` and the six permission modes
  - npm://@cofold/tools@0.4.1 - `dist/files.js` `assertCurrent` and the `r+` open; `dist/web.js` `refuseInternal`
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-cofold-read-outside-the-workspace-asks-in-default-mode, a-cofold-run-is-told-the-model-reference-it-runs-on, a-cofold-turn-with-no-model-fails-and-says-where-to-name-one, a-cofold-turns-model-is-kept-in-cofolds-store, a-cofold-write-rechecks-the-file-it-opened, a-cofold-write-to-a-file-changed-since-read-is-refused, a-session-without-a-directory-keeps-its-tools, cofold-is-the-runtime-name-everywhere, cofold-memory-is-per-workspace, cofold-runs-its-own-tools-in-its-process, facio-fork-and-rewind-needs-a-cut, listed-models-are-provider-references, permission-modes-live-in-the-harness, web-fetch-refuses-internal-addresses
---

The cofold backend `@ahpd/agent-cofold` runs the cofold harness inside the daemon, as the agent `cofold` with the title "Cofold".
It reads the harness configuration as cofold's app papo reads it, with cofold's resolver under papo's name.
The layers are `~/.config/papo/config.json`, the nearest `.papo.json` above a session's folder, and the file `$PAPO_CONFIG` names.
It keeps sessions in cofold's own file store at cofold's home, `$COFOLD_HOME` or `~/.cofold`, unless the plugin options or a record name another store.
The harness tools from `@cofold/tools` run in the cofold loop in the daemon process, as the Claude tools run in the Claude CLI.
ahpd reports each call, asks for permission through the cofold policy, and reports edits through `onFileEdit`.
The permission modes and the effort levels come from `@cofold/agents`, so the cofold library and ahpd agree on what each mode does.

## Scenarios

### A model reference names a provider and a model

WHEN a turn starts
THEN the backend takes the model reference from the session values, else from the plugin options, else from the harness file
AND it splits the reference at the first slash into a provider and a model id
AND the provider selects the endpoint, the key and the headers of that harness provider.

### A reference under the backend's own id

WHEN a reference starts with the backend's own provider id, `cofold` by default
THEN it names the endpoint that the backend was configured with
AND the harness file does not need a provider of that name.

### A turn with no model

WHEN a turn starts
AND no session value, plugin option or harness file names a model
THEN the turn fails with "no model is configured and this backend has no default"
AND the message says to add `"model"` as `"<provider>/<model>"` to the harness file, by its path.

### A reference to a provider the harness file does not have

WHEN the reference names a provider that the harness file does not configure
AND no base URL is given
THEN the turn fails
AND the message names the reference, the provider and the providers that the harness file has.

### The model list comes from the endpoint

WHEN a client asks what the backend offers
THEN the backend sends one `GET /models` to the endpoint, with a timeout of 5 seconds
AND it offers each model as `<provider>/<model id>`, where the provider is the harness provider that owns the endpoint, or the backend's own id
AND the configured model comes first when the endpoint list does not have it
AND the backend keeps the list for each endpoint and key.
The reason: OpenRouter model ids hold a slash, and the prefix keeps such an id from being read as a provider name.

### The endpoint does not answer

WHEN the endpoint gives no model list
THEN the backend offers only the configured model
AND it does not keep the empty answer, so the next probe asks again.

### The run keeps the model it ran on

WHEN a turn runs
THEN the backend gives the resolved `<provider>/<model>` reference to the cofold run as an option
AND `@cofold/agents` keeps the reference on the run record as it was given.
This is so that a session read back from the store shows the model of each turn, as the protocol `Message.model` and in the usage.

### Approvals follow the session's permission mode

WHEN a tool call needs a decision
THEN the backend asks the cofold `policyOf` with the session's `permissionMode`, or `auto` when the session names none
AND a tool is an edit when its effects say that it writes
AND a path is inside when it is under the session's working directory.

### What each permission mode asks

WHEN the mode is `default`
THEN the policy asks for a tool that writes, is destructive or uses the network
AND it asks for a read whose path is outside the working directory.
WHEN the mode is `acceptEdits`
THEN an edit inside the working directory runs without a question.
WHEN the mode is `plan`
THEN a tool that writes or is destructive is refused.
WHEN the mode is `auto`
THEN the policy asks only for a destructive tool.
WHEN the mode is `bypassPermissions`
THEN every call runs.
WHEN the mode is `dontAsk`
THEN a call that would ask is refused.

### An embedder gives its own policy or adapter

WHEN the plugin options give a policy
THEN the session schema has no `permissionMode` property.
WHEN the plugin options give a model adapter
THEN no offered model has a `configSchema`.

### Effort is a model's own

WHEN the agent's `models` declares the levels a model accepts
THEN that model's row has a `configSchema` with a `thinkingLevel` of those levels that cofold has.
WHEN nothing declares them and the catalogue lists `reasoning` among the model's parameters
THEN the `thinkingLevel` has `off`, `low`, `medium` and `high`.
WHEN neither says
THEN the model's row has no `configSchema`.
The `thinkingLevel` takes its words, labels and descriptions from VS Code's shared reasoning helpers, `off` labelled "Off".

### The session has its own reasoning

WHEN a session opens
THEN its schema has `<provider>.reasoning` with the levels `off`, `low`, `medium` and `high`
AND its default is the person's harness `reasoning`, else `off`.
The reason: cofold's app has a session-wide reasoning setting, as Codex has one in VS Code beside each model's picker.

### Effort is a request param

WHEN a turn's model selection sets `thinkingLevel` to `low`, `medium` or `high`
THEN the backend sends it as `params.reasoning.effort` on the request
AND it does not set the reasoning feature, so a model that cannot think stays that way.
WHEN a turn's model selection names no level
THEN the session's `<provider>.reasoning` decides it.

### The session gets four tool groups

WHEN a cofold session opens
THEN it gets the files, shell, web and memory tools of `@cofold/tools`
AND a tool whose name the host already offers is left out of the cofold set.

### A session with no working directory

WHEN a client opens a session with no working directory
THEN the session keeps the shell and file tools
AND relative paths resolve against the daemon's current directory.
The reason: the permission mode limits what the tools do, not the workspace.

### A write needs a current read

WHEN `write_file` or `edit_file` changes a file that exists
AND the session did not read the file with `read_file`
THEN the write is refused with "was not read in this session; read it with read_file first".
WHEN the file size or modification time changed since the read
THEN the write is refused with "changed since it was read; read it again with read_file first".
The `files.requireRead: false` option turns this check off.

### A write checks the file it opened

WHEN a write opens a file that exists
THEN it opens the file with `r+` and compares the device and inode with those of the path that was checked
AND it refuses the write when they are different
AND it writes through the open file, not through the path.
This is so that a link put in place after the check does not move the write to another file.

### Memory is kept per workspace

WHEN a session uses the memory tools
THEN the memory files are under `<store>/memory/<workspace slug>`, next to the sessions
AND a store kept in memory has no memory folder, so the session gets no memory tools.

### web_fetch refuses internal addresses

WHEN `web_fetch` gets a URL whose host is, or resolves to, a loopback, private or link-local address
THEN the call fails with "is an internal address"
AND the same check applies to each redirect.

### A fork or a rewind is a cut in the store

WHEN a session starts with `forkAt`
THEN the backend copies the conversation through that message into a new cofold session with `store.sessions.fork`.
WHEN a session starts with `rewindAt`
THEN the backend cuts the session after that message with `store.sessions.truncate`.
WHEN a session starts with both, or with either and no `resume`
THEN the session fails.
The reason: a fork that continued without a copy would add to the conversation that it was told to keep.

### A session on a computer

WHEN a cofold session runs on a computer
THEN it runs in a nested ahpd on that machine, because the backend says `runsNested`.
See [Nested hosts](nested-hosts.md).
