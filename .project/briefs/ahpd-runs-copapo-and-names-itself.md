---
title: ahpd runs copapo over ACP and names itself to the model
created: 2026-11-10
refs:
  - git://a09a278a4 - the commit of ahpd the facts were checked at
  - git://22396be - cofold's commit with copapo, `copapo acp` and the app option, on cofold `main`, not pushed or released
  - "[code://packages/agent-cofold/src/config.ts#L42-L107](../../packages/agent-cofold/src/config.ts#L42-L107) - the harness file and variables, read under papo's names"
  - "[code://packages/agent-cofold/src/agent.ts#L725-L730](../../packages/agent-cofold/src/agent.ts#L725-L730) - each provider is built with `openaiCompatProvider`, with no app"
  - "[code://packages/agent-cofold/src/agent.ts#L938-L995](../../packages/agent-cofold/src/agent.ts#L938-L995) - a machine's harness file at `<configDir>/papo/config.json`, named by `PAPO_CONFIG`"
  - "[code://packages/agent-cofold/src/plugin.ts#L222](../../packages/agent-cofold/src/plugin.ts#L222) - the template description names papo's files"
  - "[code://packages/sdk/src/machines/agents.ts#L92](../../packages/sdk/src/machines/agents.ts#L92) - `knownAgents`, the name, command and install line of each agent"
  - "[code://packages/agent-acp/src/presets.ts#L191-L199](../../packages/agent-acp/src/presets.ts#L191-L199) - the `pi` row, the shape of a row with a machine"
  - "[code://packages/computer/images/versions.json](../../packages/computer/images/versions.json) - what a machine image installs for each part"
  - https://github.com/softov/cofold/blob/22396be/packages/copapo/README.md - copapo's names and its *ACP* section
  - https://github.com/softov/cofold/blob/22396be/packages/model-openai-compat/src/app.ts - `AppIdentity`, `appHeaders` and the OpenRouter host test
  - https://openrouter.ai/docs/app-attribution - `HTTP-Referer` and `X-OpenRouter-Title`, read 2026-11-09
---

# ahpd runs copapo over ACP and names itself to the model

Softov renamed cofold's app papo to copapo and gave it an ACP agent, `copapo acp`, "so we can run it on acp from ahpd". He also wants each model call to name its app, so OpenRouter attributes the usage. In ahpd the app is `ahpd`, with `https://ahpio.com` as its URL. This brief is the ahpd side, once a cofold release carries both.

## What others do

- Every ACP agent ahpd runs is a row in `knownAgents` and in agent-acp's `presets`: its command, the arguments that start ACP, and its machine. OpenCode, Goose and Kilo start with `acp`, as copapo does ([presets.ts](../../packages/agent-acp/src/presets.ts#L191-L199)).
- OpenRouter makes an app page from `HTTP-Referer`, and shows `X-OpenRouter-Title` as its name. The title does nothing without the referer ([app attribution](https://openrouter.ai/docs/app-attribution)).
- cofold's adapter now takes `app: { name, version, url }`. It sends `User-Agent: <name>/<version>` on every request, and the two OpenRouter headers only to a host on `openrouter.ai`. A provider's own `headers` win over all three ([app.ts](https://github.com/softov/cofold/blob/22396be/packages/model-openai-compat/src/app.ts)).

## What ahpd has today

- agent-cofold reads the harness configuration under papo's names ([config.ts](../../packages/agent-cofold/src/config.ts#L42-L107)). The files are `PAPO_CONFIG`, `$XDG_CONFIG_HOME/papo/config.json` or `~/.config/papo/config.json`, and the nearest `.papo.json`. The variables are `PAPO_BASE_URL`, `PAPO_API_KEY` and `PAPO_MODEL`, over `COFOLD_*`. copapo reads none of these names now: they are `copapo`, `.copapo.json` and `COPAPO_*`.
- A machine gets the harness file at `<configDir>/papo/config.json`, and `PAPO_CONFIG` names it ([agent.ts](../../packages/agent-cofold/src/agent.ts#L938-L995)).
- The template description names the papo files ([plugin.ts](../../packages/agent-cofold/src/plugin.ts#L222)). So do the agent-cofold README (L45-L47, L67), `docs/plugins/PLUGINS.md` (L2161-L2266) and `docs/plugins/COMPUTERS.md` (L273-L282, L639). So do `.project/specs/cofold-backend.md` (L34-L35), `tools/test-tmpdir.ts` (L46) and about ten agent-cofold and sdk tests.
- Several comments link papo's source at cofold `ee48196`, such as `packages/papo/src/config.ts`. Those links keep working, because they name a commit.
- agent-cofold builds each provider with `openaiCompatProvider` and passes no app ([agent.ts](../../packages/agent-cofold/src/agent.ts#L725-L730)). Its calls send Node's `User-Agent: node`.
- `knownAgents` has no copapo row, and agent-acp has no copapo preset. `versions.json` has no copapo part.
- agent-cofold depends on `@cofold/model-openai-compat` `^0.2.1`. That version is on npm without the app option.

## Who writes

- No open PR on `softov/ahpd`.
- MayCXC's unmerged branches touch agent-cofold (`session.ts`, `turns.ts`, `runs.ts`, `pauses.ts`, `tools.ts`) and `PLUGINS.md`. None of them changes a papo name, the provider construction, `knownAgents` or the presets.
- cofold must release first. Its commit `22396be` is not pushed. `@cofold/copapo` has never been published, and `@cofold/model-openai-compat` needs a version after `0.2.1`.

## The change

- agent-cofold reads copapo's names: `COPAPO_CONFIG`, `$XDG_CONFIG_HOME/copapo/config.json` or `~/.config/copapo/config.json`, the nearest `.copapo.json`, and `COPAPO_BASE_URL`, `COPAPO_API_KEY`, `COPAPO_MODEL` over `COFOLD_*`.
- A machine gets the harness file at `<configDir>/copapo/config.json`, and `COPAPO_CONFIG` names it.
- The template description, the README, the docs, the spec and the tests say copapo.
- agent-cofold builds each provider with `app: { name: 'ahpd', version: <ahpd's version>, url: 'https://ahpio.com' }`.
- `knownAgents` has a `copapo` row: name `copapo`, command `copapo`, install line `npm install -g @cofold/copapo`, and copapo's variables.
- agent-acp has a `copapo` preset with `args: ['acp']`.
- agent-cofold takes the cofold release with the new adapter, after ahpd's tests pass on its release candidate.

## Open points

- Does agent-cofold also read the papo names as a fallback for a while, or move to copapo's at once, as copapo did?
- Which version goes in the User-Agent: the daemon's or agent-cofold's own? Not checked: whether a plugin can read the daemon's version.
- A machine made before the change has its harness file at `papo/config.json` in its state volume. Is it seeded again, or does a person remake it?
- The copapo preset's machine: copapo reads `$XDG_CONFIG_HOME/copapo/config.json` and keeps its sessions under `$COFOLD_HOME`. The row needs a state folder for both, and a `versions.json` part to install `@cofold/copapo`.
- `honoursTrust`: copapo reads a project's `.copapo.json` and does not ask first. Without the field, a session in a folder the host did not vouch for is refused. Is that what the row wants?
- copapo over ACP ignores the client's `mcpServers`. A session that agent-acp gives MCP servers runs without them.
