---
title: Deferred from plugins load from configuration
---

## What waits

- **Customizations, and MCP servers through them.** A plugin contributing skills, prompts, slash commands, rules or an MCP server to every session.
  It waits because it is a new `HostOptions.customizations` merged into each session and into an agent's `probe()`, which is an SDK change and not a loader one, and it is the next plan in this domain.
- **The required-config gate.** A plugin whose manifest names a required option the configuration does not set lists as `unconfigured` and `apply` is not called, which is what doop does before `register()`.
  It waits on the manifest carrying the options schema, which decision 2 leaves until `needs` and `provides` arrive.
- **A plugin test runtime.** doop ships `testing/plugin-test-runtime.ts`, a fake host a plugin is tested against without the daemon.
  It waits until there is a contract worth testing against.
- **`needs` and `provides` ordering.** A plugin that names a store another plugin provides, which `@facio/store-file` is the first real case of.
  It waits because ordering is only worth implementing once two plugins depend on each other, and this plan proves the loading first.
  It goes in `packages/sdk` beside `Plugin`, with the resolution rule `packages/commands/src/registry.ts` in facio already uses: resolve by declared dependency, refuse a missing one at startup and refuse a cycle by name.
- **Hooks into a running host.** `sessionOpened`, `turnStarted`, `clientConnected` and the rest.
  It waits because the protocol already serves two of the three forms a hook can take, the in-process client and the contribution wrapper, and neither needs a change here.
  It goes in `packages/sdk/src/types/host.ts` as a `hooks` option with one call at each site that already logs, and it wants its own decision because a hook that may refuse is a different thing from one that may only watch.
- **`ahpd plugin add` and `ahpd plugin remove`.** Installing into the configuration directory and writing the `plugins` key.
  It waits because `npm i` in `~/.config/ahpd` is the install and the configuration file is editable by hand, and an installer is a convenience over that rather than a mechanism.
  It goes in the `plugin` domain after the loader is real, and it should follow deepseek-harness's `install-spec.ts` shapes if it does.
- **Hot reload.** Re-importing a changed plugin module without a restart.
  It waits because neither the daemon nor its ports are reloadable, so a plugin reload would be half a reload.
  It goes wherever a daemon-wide reload goes, if it ever does.
- **Ports through `Start`.** A backend asking the host for file and shell access, which `@ahpd/agent-acp` needs.
  It waits because it is a change to `Start` in `packages/sdk` and belongs to the agent plans in `ideas/agents-as-extensions.md`, not to the loader.
- **The root configuration schema as an option.** `ROOT_CONFIG_SCHEMA` is a fixed literal, so a plugin cannot add a key a client draws a control from.
  It waits because it is a `HostOptions` field and not a plugin-loader concern.
- **A plugin registry or a first-party plugin set.** The `@ahpd/agent-acp`, `@ahpd/agent-openai` and facio plugins themselves.
  They wait on this plan and are the five steps `ideas/agents-as-extensions.md` already orders.
