---
title: Deferred from plugins load from configuration
---

## What waits

- **Customizations, and MCP servers through them.** A plugin contributing skills, prompts, slash commands, rules or an MCP server to every session.
  It waits because it is a new `HostOptions.customizations` merged into each session and into an agent's `probe()`, which is an SDK change and not a loader one, and it is not planned yet.
- **The required-config gate.** A plugin whose manifest names a required option the configuration does not set lists as `unconfigured` and `apply` is not called, which is what doop does before `register()`.
  It waits on the manifest carrying the options schema, which decision 2 leaves until `needs` and `provides` arrive.
- **Reading the port beneath.** A plugin that wants to decorate the store it replaces rather than replace it, so a logging or caching wrapper is possible.
  It waits because `PluginHost` exposes no accessor to what is already set, and an accessor is a different kind of contribution from a registration.
  It goes wherever a wrapping decision goes, and it is not a flag forgotten here.
- **A plugin test runtime.** doop ships `testing/plugin-test-runtime.ts`, a fake host a plugin is tested against without the daemon.
  It waits until there is a contract worth testing against.
- **`needs` and `provides` ordering.** A plugin that names a store another plugin provides, which `@cofold/store-file` is the first real case of.
  It waits because ordering is only worth implementing once two plugins depend on each other, and this plan proves the loading first.
  It goes in `packages/sdk` beside `Plugin`, with the resolution rule `packages/commands/src/registry.ts` in cofold already uses: resolve by declared dependency, refuse a missing one at startup and refuse a cycle by name.
- **`ahpd plugin add` and `ahpd plugin remove`.** Installing into the configuration directory and writing the `plugins` key.
  It waits because `npm i` in `~/.config/ahpd` is the install and the configuration file is editable by hand, and an installer is a convenience over that rather than a mechanism.
- **Hot reload.** Re-importing a changed plugin module without a restart.
  It waits because neither the daemon nor its ports are reloadable, so a plugin reload would be half a reload.
- **The root configuration schema as an option.** `ROOT_CONFIG_SCHEMA` is a fixed literal, so a plugin cannot add a key a client draws a control from.
  It waits because it is a `HostOptions` field and not a plugin-loader concern.
