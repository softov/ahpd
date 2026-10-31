import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerState } from '@microsoft/agent-host-protocol';
import { uriOf } from '@ahpd/sdk';
import type { Bag, OnWire } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import { frontmatterOf, projectDirOf } from './disk.js';
import type { Disk, DiskFile, DiskKind, DiskScope } from './disk.js';

/**
 * RFC 9728 metadata for a server that needs signing in.
 *
 * `resource` is the one field the protocol requires of it - the canonical
 * identifier a client's `authenticate` must name - so it is the one this
 * spells out; the rest is whatever the server published.
 */
export type Published = Bag & { resource: string };

/**
 * Where a plugin came from, which is also what its decisions are kept under.
 *
 * The root the SDK reported, where it is one. A plugin built into the CLI has
 * no root: the SDK reports `builtin` as the path of every one of them, and one
 * key for all of them switched every built-in when a person switched one. Its
 * `source`, `<name>@builtin`, is its own.
 *
 * Exported because a switch is named by it: an `enabledPlugins` setting takes
 * the source, and the reload that follows is read for the same one.
 */
export const rootOf = (plugin: Bag): string => {
  const path = str(plugin.path) as string;
  return isAbsolute(path) ? path : (str(plugin.source) ?? `${str(plugin.name)}@${path}`);
};

/**
 * What the session was handed, in the protocol's shape.
 *
 * Eight `CustomizationType`s and one flat list. `disableUserInvocation` is
 * what decides whether a skill or prompt appears after a slash - offering one
 * the host will refuse is worse than not offering it at all.
 *
 * The source is the CLI's *control* protocol, not its message stream:
 * `initializationResult()` and `mcpServerStatus()` answer without a turn
 * having happened. That matters because everything here is what a client
 * needs **before** anybody says anything - the models to pick from, the
 * commands behind a slash. Waiting for the `init` message would mean a
 * composer that can only offer them once the conversation has started, which
 * is exactly too late.
 */
export function customizationsOf(init: Bag, mcp: unknown[], skills: unknown[] = [], wanted?: Map<string, Published>, plugins: unknown[] = [], ours?: Set<string>, off: Bag[] = [], disk?: Disk, stopRequested?: Set<string>): Bag[] {
  const out: Bag[] = [];

  /*
   * Where a customization of each kind lives, and the container it goes in.
   *
   * A top-level `Customization` is a *container* - a plugin or a directory -
   * whose leaves are its `children`, or a bare MCP server. Skills, prompts and
   * agents are `ChildCustomization`s and belong inside one. Published flat
   * they are read as plugins, and the reference client then walks
   * `<uri>/agents`, `<uri>/skills`, `<uri>/commands` and `<uri>/rules` looking
   * for their contents - four failed reads per customization, against a `uri`
   * that was a bare name rather than anything a filesystem could answer.
   *
   * One container per scope and kind, because `contents` names a single
   * `ChildCustomizationType` and a scope is where a person goes to add one.
   * The CLI reports *what* it loaded and never where it came from, so a leaf
   * names the file the disk read found under the same name, in the order the
   * CLI prefers them: managed over personal over project. What has no file - a
   * skill or command the CLI ships, an agent of its own - goes in a read-only
   * `builtin` container with an internal uri, which says it exists without
   * claiming a file for it.
   *
   * The personal and the project directories are sent with no children too,
   * so a client has somewhere to offer to write the first one. With no disk
   * read - a session in a machine, whose CLI reads its own config volume and
   * not this host's files - there is nowhere here to write, and none is sent.
   */
  const files = disk?.files ?? [];
  const folderOf: Record<DiskKind, string> = { agent: 'agents', skill: 'skills', prompt: 'commands', rule: 'rules' };
  type Placed = DiskScope | 'builtin';
  /** The directory a scope keeps a kind in, and whether a person may write there. */
  const whereOf = (scope: Placed, kind: DiskKind): { uri: string; name: string; writable: boolean } | undefined => {
    const folder = folderOf[kind];
    if (scope === 'builtin') return { uri: `claude-internal:/${folder}`, name: 'builtin', writable: false };
    if (disk === undefined) return undefined;
    if (scope === 'user') return { uri: uriOf(join(disk.configDir, folder)), name: folder, writable: true };
    if (scope === 'project') {
      const project = projectDirOf(disk);
      return project === undefined ? undefined : { uri: uriOf(join(project, folder)), name: folder, writable: true };
    }
    if (scope === 'synced') return { uri: uriOf(join(disk.configDir, 'skills', 'synced')), name: 'synced', writable: false };
    return disk.managedDir === undefined ? undefined : { uri: uriOf(join(disk.managedDir, '.claude', 'skills')), name: 'managed', writable: false };
  };
  const directories = new Map<string, Bag>();
  /** The container for one scope and kind, made the first time it is asked for. */
  const directoryOf = (scope: Placed, kind: DiskKind): Bag | undefined => {
    const key = `${scope}:${folderOf[kind]}`;
    const held = directories.get(key);
    if (held !== undefined) return held;
    const where = whereOf(scope, kind);
    if (where === undefined) return undefined;
    const made: Bag = { type: 'directory', id: `directory:${key}`, ...where, contents: kind, enabled: true, children: [] };
    directories.set(key, made);
    return made;
  };
  /** Put one leaf in the directory of its scope. */
  const place = (scope: Placed, kind: DiskKind, leaf: Bag): void => {
    (directoryOf(scope, kind)?.children as Bag[] | undefined)?.push(leaf);
  };
  /** The writable directories, in the order they are sent, made before anything is put in them. */
  const writable: Placed[] = disk === undefined ? [] : projectDirOf(disk) !== undefined ? ['project', 'user'] : ['user'];
  const sent: [Placed, DiskKind][] = [
    ...writable.flatMap((scope) => (['agent', 'skill', 'prompt', 'rule'] as DiskKind[]).map((kind) => [scope, kind] as [Placed, DiskKind])),
    ['managed', 'skill'], ['synced', 'skill'], ['builtin', 'skill'], ['builtin', 'prompt'], ['builtin', 'agent'],
  ];
  for (const scope of writable) for (const kind of ['agent', 'skill', 'prompt', 'rule'] as DiskKind[]) directoryOf(scope, kind);
  /** The file the CLI read a name from, in the order it prefers one scope over another. */
  const fileOf = (kind: DiskKind, name: string, scopes: DiskScope[]): DiskFile | undefined => {
    for (const scope of scopes) {
      const found = files.find((one) => one.kind === kind && one.scope === scope && one.name === name);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  /**
   * A skill's file. A synced skill is run as `anthropic-skills:<name>`, and by
   * its bare name where no other skill takes that name.
   */
  const skillFileOf = (name: string): DiskFile | undefined => (name.startsWith(SYNCED)
    ? fileOf('skill', name.slice(SYNCED.length), ['synced'])
    : fileOf('skill', name, ['managed', 'user', 'project', 'synced']));
  /** The uri of a leaf with no file. The name is encoded: it is a path segment here and a URI segment there. */
  const internal = (kind: string, name: string): string => `claude-internal:/${kind}/${encodeURIComponent(name)}`;
  /*
   * The plugins the SDK reported, each as its own top-level container.
   *
   * The SDK attributes a plugin's children through their names, which it
   * namespaces as `<plugin>:<name>` for both a skill and an agent. A child
   * with no such namespace cannot be attributed, so it stays in the directory
   * container for its kind rather than being moved under a plugin the SDK
   * never said it came from. The container's URI is the real plugin root the
   * SDK reported, and its name and version are the plugin's own.
   */
  /*
   * The plugins this session switched off, which the CLI has stopped reporting.
   *
   * A switch here is an `enabledPlugins` setting the CLI reads when it loads
   * its plugins, so one switched off stops being a plugin it is loading - and
   * a list built only from what the CLI reports would drop the row a person
   * had just moved. These are described the way the CLI describes one, so a
   * container is built out of them the same way.
   */
  const stopped = list(off)
    .map((raw) => bag(raw))
    .filter((one) => (str(one.name) ?? '') !== '');
  const named = new Set(list(plugins).map((raw) => str(bag(raw).name) ?? ''));
  /** The names of the plugins switched off that the CLI is not loading. */
  const switchedOff = new Set(stopped.map((one) => str(one.name) as string).filter((name) => !named.has(name)));
  const reported = [...list(plugins).map((raw) => bag(raw)), ...stopped]
    .filter((one) => (str(one.name) ?? '') !== '' && (str(one.path) ?? '') !== '');
  /*
   * The ones this host handed over itself, kept apart from the rest. The CLI
   * reports a plugin by the directory it was given, and the session's
   * customizations already carry the host's own entry for it - so a plugin
   * listed twice would be one a person is offered two switches for.
   */
  const handed = reported.filter((one) => ours?.has(str(one.path) ?? '') === true);
  const reportedPlugins = reported.filter((one) => ours?.has(str(one.path) ?? '') !== true);
  const pluginOf = (name: string): Bag | undefined =>
    reportedPlugins.find((plugin) => name.startsWith(`${str(plugin.name) ?? ''}:`));
  /*
   * The handed plugin that namespaced a name, which is the CLI's own name for
   * it: a skill of a copy is `<the name the CLI read>:<the file's name>`, and
   * the name it read is a plugin name this host wrote (see `clientplugins`).
   *
   * Read off the CLI's report rather than worked out from the path, because
   * that name is what the CLI runs a skill by, and a name this host guessed
   * would be one the CLI answers to with nothing.
   */
  const handedOf = (name: string): Bag | undefined =>
    handed.find((plugin) => name.startsWith(`${str(plugin.name) ?? ''}:`));
  /** The SDK's name with the plugin's namespace taken off it. */
  const bare = (plugin: Bag, name: string): string => {
    const prefix = `${str(plugin.name) ?? ''}:`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  };
  const pluginContainers = new Map<string, Bag>();
  for (const plugin of reportedPlugins) {
    const name = str(plugin.name) as string;
    if (pluginContainers.has(name)) continue;
    pluginContainers.set(name, {
      type: 'plugin',
      id: `plugin:${name}`,
      uri: rootOf(plugin),
      name,
      ...(str(plugin.version) !== undefined ? { version: str(plugin.version) as string } : {}),
      /*
       * The session's own answer, for a plugin it switched off.
       *
       * A switch is kept by the session that made it, and the CLI has no word
       * for it beyond having stopped loading the plugin - so without this the
       * row is one the CLI reports and nobody has decided about, which is a
       * switch drawn back on the moment it was moved.
       */
      ...(switchedOff.has(name) ? { enablement: [{ kind: 'session', enabled: false }] } : {}),
      children: [],
    });
  }
  /** Put one attributed child under the plugin that namespaced it. */
  const under = (plugin: Bag, child: Bag): void => {
    const held = pluginContainers.get(str(plugin.name) as string);
    if (held !== undefined) (held.children as Bag[]).push(child);
  };

  /*
   * Which of the commands are skills, and which skills a person can invoke.
   *
   * The CLI hands out two lists that overlap and neither says which is which:
   * `commands` is what a slash offers, `skills` is what was loaded from disk.
   * A command in both is a skill; one in `commands` alone is a built-in
   * prompt. And a skill the CLI did *not* put behind a slash is one it will
   * not let a person invoke - which is the agent-only skill the protocol has
   * `disableUserInvocation` for, read off the CLI's own two answers rather
   * than guessed from a name.
   */
  const offered = new Map(list(init.commands)
    .map((raw) => [str(bag(raw).name) ?? '', bag(raw)] as const)
    .filter(([name]) => name !== ''));
  const loaded = new Map(list(skills)
    .map((raw) => [str(bag(raw).name) ?? '', bag(raw)] as const)
    .filter(([name]) => name !== ''));

  for (const [name, skill] of loaded) {
    /*
     * A skill the CLI read out of a copy this host handed over is left out, and
     * the host's own entry for that copy is what lists it.
     *
     * The two are the same file. Listed from both, a person is offered the skill
     * twice - and under the name the CLI read it by, which for a copy is the
     * nonce its directory is named, so one of the two is `1683262406:advisor`.
     */
    if (handedOf(name) !== undefined) continue;
    const command = offered.get(name);
    const described = str(skill.description) ?? str(bag(command).description);
    const hint = str(skill.argumentHint) ?? str(bag(command).argumentHint);
    const plugin = pluginOf(name);
    const file = plugin === undefined ? skillFileOf(name) : undefined;
    const own = plugin === undefined ? name : bare(plugin, name);
    const inPlugin = plugin === undefined ? '' : `${str(plugin.path) ?? ''}/skills/${own}/SKILL.md`;
    const leaf: Bag = {
      type: 'skill',
      id: `skill:${name}`,
      name: own,
      // Its `SKILL.md`, which is what a client opens, and not the folder it is in.
      uri: plugin !== undefined
        ? (existsSync(inPlugin) ? inPlugin : internal('skill', own))
        : (file !== undefined ? uriOf(file.path) : internal('skill', name)),
      enabled: true,
      ...(command ? {} : { disableUserInvocation: true }),
      ...(described ? { description: described } : {}),
      // Under `_meta` for the reason the session's model is: `SkillCustomization`
      // declares `description` and the two `disable*` flags and nothing else,
      // so an argument hint sent beside them is this host's own extension,
      // and named as one.
      ...(hint ? { _meta: { 'ahpd.argumentHint': hint } } : {}),
    };
    if (plugin === undefined) place(file?.scope ?? 'builtin', 'skill', leaf);
    else under(plugin, leaf);
  }

  for (const [name, command] of offered) {
    if (loaded.has(name)) continue;
    // A command of a handed plugin, for the same reason as a skill of one.
    if (handedOf(name) !== undefined) continue;
    const plugin = pluginOf(name);
    const file = plugin === undefined ? fileOf('prompt', name, ['user', 'project']) : undefined;
    const leaf: Bag = {
      type: 'prompt',
      id: `command:${name}`,
      name: plugin === undefined ? name : bare(plugin, name),
      uri: plugin !== undefined
        ? `${str(plugin.path) ?? ''}/commands/${bare(plugin, name)}.md`
        : (file !== undefined ? uriOf(file.path) : internal('command', name)),
      enabled: true,
      ...(str(command.description) ? { description: str(command.description) as string } : {}),
      ...(str(command.argumentHint) ? { argumentHint: str(command.argumentHint) as string } : {}),
    };
    if (plugin === undefined) place(file?.scope ?? 'builtin', 'prompt', leaf);
    else under(plugin, leaf);
  }

  for (const raw of list(init.agents)) {
    const found = bag(raw);
    const name = str(found.name);
    if (!name) continue;
    /*
     * The agent the CLI runs when nobody picked one.
     *
     * Not listed, because it is not a choice: a person who offered it would be
     * told nothing changed. Everything else the CLI reports is a choice, so
     * this is the only name dropped.
     */
    if (name === 'general-purpose') continue;
    const plugin = pluginOf(name);
    const own = plugin === undefined ? name : bare(plugin, name);
    const file = plugin === undefined ? fileOf('agent', name, ['user', 'project']) : undefined;
    const inPlugin = plugin === undefined ? undefined : join(str(plugin.path) ?? '', 'agents', `${own}.md`);
    const at = file !== undefined ? uriOf(file.path)
      : inPlugin !== undefined && existsSync(inPlugin) ? inPlugin
        : undefined;
    const leaf: Bag = {
      type: 'agent',
      id: `agent:${name}`,
      name: own,
      /*
       * Where the file is, or that there is none.
       *
       * The CLI reports an agent's name and never where it came from, and a
       * built-in the CLI ships has no file of its own - so a `file:` uri would
       * name a path nobody has, and a client that read what it names would get
       * nothing back. Those get the internal uri instead, which says the agent
       * exists without claiming a file for it. The name is encoded, because it
       * is a path segment here and a URI segment there.
       */
      uri: at ?? `${INTERNAL_AGENT}${encodeURIComponent(own)}`,
      enabled: true,
      ...(str(found.description) ? { description: str(found.description) as string } : {}),
    };
    if (plugin === undefined) place(file?.scope ?? 'builtin', 'agent', leaf);
    else under(plugin, leaf);
  }

  /*
   * The rules: the `CLAUDE.md` files and the files of a `rules` folder.
   *
   * The CLI does not report them, so every one the disk read found is listed.
   * One with `paths` applies to the files they match, and any other always.
   */
  for (const rule of files.filter((one) => one.kind === 'rule')) {
    place(rule.scope, 'rule', {
      type: 'rule',
      id: `rule:${rule.scope}:${rule.path}`,
      uri: uriOf(rule.path),
      name: rule.name,
      enabled: true,
      ...(rule.description !== undefined ? { description: rule.description } : {}),
      ...(rule.globs !== undefined ? { globs: rule.globs } : { alwaysApply: true }),
    });
  }

  // The plugins first, each with the children that named it; then the
  // directories, which hold everything the SDK attributed to no plugin. A
  // writable one is sent empty too; a read-only one only with children.
  for (const plugin of pluginContainers.values()) out.push(plugin);
  for (const [scope, kind] of sent) {
    const found = directories.get(`${scope}:${folderOf[kind]}`);
    if (found !== undefined && (found.writable === true || (found.children as Bag[]).length > 0)) out.push(found);
  }

  // Bare, and correctly so: an MCP server is the one leaf the protocol lets a
  // session surface at the top level without a container around it.
  for (const raw of mcp) {
    const server = bag(raw);
    const name = str(server.name);
    if (!name) continue;
    const reported = str(server.status);
    const said = str(server.error);
    /*
     * The state, in the shape the kind it claims actually requires.
     *
     * The protocol's words, not the SDK's: the CLI says `connected` and
     * `failed`, a client reads `ready` and `error`. Each kind carries
     * different fields and only `error` carries any - `ready`, `starting` and
     * `stopped` are `{ kind }` and nothing else, and `error` needs a whole
     * `ErrorInfo` rather than the bare `message` this used to send.
     *
     * A server that needs signing in is `authRequired`, carrying the protected
     * resource it published. Discovered rather than invented: the server's own
     * URL is the canonical resource identifier the MCP authorization spec
     * names, and `<url>/.well-known/oauth-protected-resource` is where the
     * authorization server is announced. A stdio server has no URL and so no
     * resource to describe, and stays an error - which is the honest answer
     * for a thing a client cannot sign into over the network.
     */
    const published = wanted?.get(name);
    const state: OnWire<McpServerState> = reported === 'connected' ? { kind: 'ready' }
      : reported === 'disabled' ? { kind: 'stopped' }
        : reported === 'failed'
          ? {
            kind: 'error',
            error: { errorType: 'mcpServerFailed', message: said ?? 'The server did not start.' },
          }
          : reported === 'needs-auth'
            ? (published !== undefined
              ? {
                kind: 'authRequired',
                reason: 'required',
                resource: published,
                ...(Array.isArray(published.scopes_supported) && published.scopes_supported.length > 0
                  ? { requiredScopes: published.scopes_supported.filter((one): one is string => typeof one === 'string') }
                  : {}),
                ...(said !== undefined ? { description: said } : {}),
              }
              : {
                kind: 'error',
                error: {
                  errorType: 'mcpAuthRequired',
                  message: said ?? 'This server needs signing in, and it did not say where.',
                },
              })
            : { kind: 'starting' };
    out.push({
      type: 'mcpServer',
      id: `mcp:${name}`,
      name,
      uri: name,
      /*
       * `enablement`, not `enabled`.
       *
       * An MCP server is the one customization the protocol does not give a
       * flat flag: it carries the decision per scope, most specific first,
       * and a consumer reads `enablement[0].enabled`. This host decides at
       * one scope - the session's - because that is where a CLI's answer
       * about a server applies.
       *
       * Read off the CLI's own word about the server. One that needs signing
       * in is enabled and unreachable, so it stays switched *on*; one the CLI
       * reports `failed` or `disabled` reads off, except a server a client's
       * stop switched off: the CLI's stop is its disabled flag, and a stop
       * leaves the enabled intent where it was.
       */
      enablement: [{ kind: 'session', enabled: reported === 'disabled' ? stopRequested?.has(name) === true : reported !== 'failed' }],
      state,
    });
  }

  return out;
}

/** The namespace the CLI runs a synced skill under. */
const SYNCED = 'anthropic-skills:';

/** The uri scheme `customizationsOf` gives an agent the CLI ships itself. */
export const INTERNAL_AGENT = 'claude-internal:/agent/';

/**
 * The name the SDK's `agent` option wants, out of a customization's uri.
 *
 * A `file:` uri names the file a person wrote, and the name the CLI knows the
 * agent by is the one in that file's frontmatter - `reviewer.md` may well say
 * `name: reviewer`, and the file's own name is not what the CLI will take. A
 * file that has been deleted since the listing was made, or one whose
 * frontmatter names nothing, leaves the file's own name without its extension,
 * which is the last thing the CLI can be asked by.
 *
 * An internal uri carries no file at all: the agent is the CLI's own and the
 * last segment of the uri is its name, put there by the same function that
 * built the uri.
 *
 * Nothing rather than a wrong name, for a uri that is neither: handing the CLI
 * an agent it does not have would fail the turn over a picker.
 */
export function agentNameOf(uri: string): string | undefined {
  if (uri.startsWith(INTERNAL_AGENT)) {
    const last = uri.slice(INTERNAL_AGENT.length).split('/').filter((one) => one !== '').pop();
    if (last === undefined) return undefined;
    try { return decodeURIComponent(last); }
    catch { return undefined; }
  }
  if (!uri.startsWith('file://')) return undefined;
  let path: string;
  try { path = fileURLToPath(uri); }
  catch { return undefined; }
  const own = basename(path).replace(/\.md$/i, '');
  // The uri is the client's, so the read is the bounded one `frontmatterOf` makes.
  const named = frontmatterOf(path)?.name;
  return typeof named === 'string' && named !== '' ? named : own;
}
