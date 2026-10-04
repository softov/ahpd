import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerState } from '@microsoft/agent-host-protocol';
import type { Bag, OnWire } from '@ahpd/sdk';
import { bag, list, str } from './common.js';

/**
 * RFC 9728 metadata for a server that needs signing in.
 *
 * `resource` is the one field the protocol requires of it - the canonical
 * identifier a client's `authenticate` must name - so it is the one this
 * spells out; the rest is whatever the server published.
 */
export type Published = Bag & { resource: string };

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
export function customizationsOf(init: Bag, mcp: unknown[], skills: unknown[] = [], wanted?: Map<string, Published>, plugins: unknown[] = []): Bag[] {
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
   * One container per kind, because `contents` names a single
   * `ChildCustomizationType`. The directory is the conventional one for that
   * kind - the CLI reports *what* it loaded and never where it came from, so
   * this is where a person would go to add one rather than a path this host
   * read off disk. A built-in the CLI ships has no file of its own and the
   * path under it will not exist; nothing dereferences it, because a client
   * reads a directory's `children` rather than walking it.
   */
  const home = process.env.HOME ?? '';
  const folder = (kind: string): string => `file://${home}/.claude/${kind}`;
  const container = (kind: string, contents: string, children: Bag[]): Bag | undefined =>
    (children.length === 0 ? undefined : {
      type: 'directory',
      id: `directory:${kind}`,
      uri: folder(kind),
      name: kind,
      contents,
      enabled: true,
      // The person's own directory, so a client may offer to write one.
      writable: true,
      children,
    });
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
  const reportedPlugins = list(plugins)
    .map((raw) => bag(raw))
    .filter((one) => (str(one.name) ?? '') !== '' && (str(one.path) ?? '') !== '');
  const pluginOf = (name: string): Bag | undefined =>
    reportedPlugins.find((plugin) => name.startsWith(`${str(plugin.name) ?? ''}:`));
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
      uri: str(plugin.path) as string,
      name,
      ...(str(plugin.version) !== undefined ? { version: str(plugin.version) as string } : {}),
      children: [],
    });
  }
  /** Put one attributed child under the plugin that namespaced it. */
  const under = (plugin: Bag, child: Bag): void => {
    const held = pluginContainers.get(str(plugin.name) as string);
    if (held !== undefined) (held.children as Bag[]).push(child);
  };
  const asSkills: Bag[] = [];
  const asPrompts: Bag[] = [];
  const asAgents: Bag[] = [];

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
    const command = offered.get(name);
    const described = str(skill.description) ?? str(bag(command).description);
    const hint = str(skill.argumentHint) ?? str(bag(command).argumentHint);
    const plugin = pluginOf(name);
    const leaf: Bag = {
      type: 'skill',
      id: `skill:${name}`,
      name: plugin === undefined ? name : bare(plugin, name),
      uri: plugin === undefined ? `${folder('skills')}/${name}` : `${str(plugin.path) ?? ''}/skills/${bare(plugin, name)}`,
      enabled: true,
      ...(command ? {} : { disableUserInvocation: true }),
      ...(described ? { description: described } : {}),
      // Under `_meta` for the reason the session's model is: `SkillCustomization`
      // declares `description` and the two `disable*` flags and nothing else,
      // so an argument hint sent beside them is this host's own extension.
      ...(hint ? { _meta: { argumentHint: hint } } : {}),
    };
    if (plugin === undefined) asSkills.push(leaf);
    else under(plugin, leaf);
  }

  for (const [name, command] of offered) {
    if (loaded.has(name)) continue;
    const plugin = pluginOf(name);
    const leaf: Bag = {
      type: 'prompt',
      id: `command:${name}`,
      name: plugin === undefined ? name : bare(plugin, name),
      uri: plugin === undefined ? `${folder('commands')}/${name}.md` : `${str(plugin.path) ?? ''}/commands/${bare(plugin, name)}.md`,
      enabled: true,
      ...(str(command.description) ? { description: str(command.description) as string } : {}),
      ...(str(command.argumentHint) ? { argumentHint: str(command.argumentHint) as string } : {}),
    };
    if (plugin === undefined) asPrompts.push(leaf);
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
    const path = plugin === undefined
      ? join(home, '.claude', 'agents', `${name}.md`)
      : join(str(plugin.path) ?? '', 'agents', `${own}.md`);
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
      uri: existsSync(path)
        ? (plugin === undefined ? `file://${path}` : path)
        : `${INTERNAL_AGENT}${encodeURIComponent(own)}`,
      enabled: true,
      ...(str(found.description) ? { description: str(found.description) as string } : {}),
    };
    if (plugin === undefined) asAgents.push(leaf);
    else under(plugin, leaf);
  }

  // The plugins first, each with the children that named it; then the
  // per-kind directories, which hold everything the SDK attributed to nobody.
  for (const plugin of pluginContainers.values()) out.push(plugin);

  for (const found of [
    container('skills', 'skill', asSkills),
    container('commands', 'prompt', asPrompts),
    container('agents', 'agent', asAgents),
  ]) {
    if (found) out.push(found);
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
       * Off the CLI's own word rather than off the kind above, so a server
       * that needs signing in stays switched *on* - it is enabled and
       * unreachable, which is not the same as somebody having turned it off.
       */
      enablement: [{ kind: 'session', enabled: reported !== 'failed' && reported !== 'disabled' }],
      state,
    });
  }

  return out;
}

/** The uri scheme `customizationsOf` gives an agent the CLI ships itself. */
export const INTERNAL_AGENT = 'claude-internal:/agent/';

/** The most of an agent file read for its name. */
const AGENT_FILE_MOST = 64 * 1024;

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
  // Only a regular file of an agent's size is read: the uri is the client's,
  // and a device or a huge file would hold the host up for a name.
  let said: string;
  try {
    const held = statSync(path);
    if (!held.isFile() || held.size > AGENT_FILE_MOST) return own;
    said = readFileSync(path, 'utf8');
  }
  catch { return own; }
  const front = said.startsWith('---') ? said.split(/^---$/m).slice(1, 2).join('') : '';
  const named = front.split('\n').find((line) => /^name:/.test(line.trim()));
  const value = named?.slice(named.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');
  return value === undefined || value === '' ? own : value;
}
