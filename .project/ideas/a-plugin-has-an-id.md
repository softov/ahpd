---
title: A plugin has an id of its own, apart from where it is loaded from
created: 2026-10-06
---

Raised by Softov on 2026-10-06, looking at root config in VS Code: a plugin loaded from a path is keyed by that path, so its row reads `plugins../packages/agent-acp/src/index.ts`.

Today a plugin's key is its spec ([`code://packages/server/src/plugins.ts#L60`](../../packages/server/src/plugins.ts#L60), `nameOf`), and the spec is a module specifier or a path ([`code://packages/sdk/src/types/plugin.ts#L78-L85`](../../packages/sdk/src/types/plugin.ts#L78-L85)).
Moving the file, or switching from a path to the npm package, renames the plugin and leaves its options under the old key.

## The id

Most of the resolution exists already.
A folder spec reads its own `package.json` as the manifest ([`code://packages/server/src/plugins.ts#L120`](../../packages/server/src/plugins.ts#L120), `entryOf`), and a file spec takes the nearest `package.json` above it when that one has an `ahpd` field ([`code://packages/server/src/plugins.ts#L89-L92`](../../packages/server/src/plugins.ts#L89-L92), plugin/31).
The loader then names the plugin: the module's `name` export, the manifest's `name`, the file's name (its folder's for an `index` file), and the spec last ([`code://packages/server/src/plugins.ts#L655`](../../packages/server/src/plugins.ts#L655), [`code://packages/server/src/plugins.ts#L677`](../../packages/server/src/plugins.ts#L677)).
That name reaches the log and the listing only: root config keys ([`code://packages/server/src/rootconfig.ts#L153`](../../packages/server/src/rootconfig.ts#L153)), the options schemas ([`code://packages/server/src/plugins.ts#L946`](../../packages/server/src/plugins.ts#L946)) and the duplicate check ([`code://packages/server/src/plugins.ts#L910`](../../packages/server/src/plugins.ts#L910)) still use `nameOf(spec)`, the raw path.

- A spec may name it by hand: `{ id: "acp", name: "../packages/agent-acp/src/index.ts" }`.
- Otherwise the id is the name the loader already resolves; a disabled plugin is never imported, so its id stops at the manifest's name.
- Root config, `ahpd plugin` and the options are keyed by the id: `plugins.acp`, not the path.
- Two specs resolving to the same id are refused, unless the later one names an id of its own.
- A key written under the spec is moved to the id once, when the daemon starts.
- A served `plugin list` masks a URL spec's userinfo, so today a credentialed git spec's row `name` matches no plugin and can be changed only from the terminal (daemon 16, `docs/DAEMON.md`); an id holds no secret, so a row keyed by it can be passed back from any client.

## One plugin, many things

A plugin is not strict: it is the unit something is registered through, and one `apply` may call any of the `register*` calls ([`code://packages/sdk/src/types/plugin.ts#L239-L346`](../../packages/sdk/src/types/plugin.ts#L239-L346)).
A plugin could register a kind of computer and an agent that runs in it, or an agent and the resource scheme its sessions read.
With ids, the same module could also be loaded twice with different options, such as two ACP agents, each under its own id.

What a plugin registered is listed under its id, so a client can show "acp: agent `acp`, scheme `acp-files`" rather than the path it came from.
