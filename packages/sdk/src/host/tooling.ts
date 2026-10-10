import { isAbsolute, join } from 'node:path';
import { idOf } from '../catalog.js';
import { localPath, uriOf } from '../fileuri.js';
import { frozenCopy } from '../frozen.js';
import { readJsonObject } from '../jsonfile.js';
import { partsOf } from '../pluginparts.js';
import { bodyText } from '../records.js';
import { bag, reason, str } from '../values.js';
import { ROOT, chatIdFor, chatUriFor, schemeOf } from './channels.js';
import { need } from './common.js';
import type { Bag } from '../types/common.js';
import type { ClientPlugins, SyncedPlugin } from '../types/clientplugins.js';
import type { HostTool, ToolCall, TitleStrategy } from '../types/host.js';
import type { BoundTool, McpServer } from '../types/agent.js';
import type { Session } from '../types/session.js';
import type { ToolDefinition } from '@microsoft/agent-host-protocol';
import type { ToolsEndpoint } from '../tools/server.js';
import type { Held } from './state.js';
import type { Move } from './lifecycle.js';
import type { HostContext } from './context.js';

/** What a host says about a client's plugin when it has nowhere to keep one. */
const KEEPS_NONE = 'this host keeps no client plugins';

/**
 * What a toggle on a client plugin landed on.
 *
 * A plugin and one of its servers are both this host's to switch, and only the
 * server is also the agent's: the backend running a server is named by the same
 * id and has to be told, while a plugin itself is a directory this host copied
 * for a client - the backend has never heard of it.
 */
export interface Toggled {
  /** The server's name, when the id named one of a plugin's servers. */
  readonly server?: string;
}

/**
 * One plugin a client handed a session.
 *
 * The announcement is kept exactly as it arrived: what a plugin is called,
 * which revision it is and what its children are is the client's to say, and
 * the entry a session publishes is that announcement with this host's `load`
 * on it.
 */
interface HeldPlugin {
  /** The `ClientPluginCustomization` as announced, `nonce` and `childEnablement` included. */
  announced: Bag;
  /** `loading` while it is being copied, then `loaded`, or `error` with what went wrong. */
  load: Bag;
  /** The directory the copy landed in, once one has. */
  path?: string;
  /** What the copy holds, read when it landed: the parts a client reads under this plugin. */
  parts?: Bag[] | undefined;
  /** What a toggle decided for this session, over whatever the client published. */
  decision?: Bag[];
}

/**
 * What a session's model is offered, and what a host tool sees of this host.
 *
 * The tools this host contributes and the ones its clients provide, shaped per
 * session by the title strategy, the turn a host tool is handed, and the
 * endpoints and MCP servers a backend is started with.
 */
export interface Tooling {
  /** The tools a session is offered, with the permission applied once. */
  permitted(tools: readonly HostTool[]): HostTool[];
  /** The strategy a session's uri resolves to, which is deferred for every one. */
  strategyOf(uri: string): TitleStrategy;
  /** One tool's definition for a session, after the strategy's shaping. */
  shapedDefinition(one: HostTool, uri: string): ToolDefinition | undefined;
  /** The definitions alone for one session, which is the half that goes on the wire. */
  toolDefinitions(uri: string): ToolDefinition[];
  /** The tools the clients in a session provide, as tools to offer the model. */
  clientTools(uri: string): BoundTool[];
  /**
   * The plugins a session's clients handed it, as customizations.
   *
   * Laid after whatever the backend reports wherever a session's
   * customizations go out, so a client reads one list of both.
   */
  clientPluginsOf(uri: string): Bag[];
  /**
   * Turn a client plugin, or one of its servers, on or off in a session.
   *
   * Answers nothing when the id named neither, which is what tells the caller
   * the switch is the backend's to throw rather than this host's.
   */
  toggleClientPlugin(uri: string, id: string, enablement: Bag[]): Toggled | undefined;
  /**
   * Tell a session's chats what they may offer, after the clients moved.
   *
   * The plugins a session's clients announced are copied here too: a client
   * announcing itself and a client leaving are the same event for both halves,
   * and this is where every one of them arrives.
   */
  retool(uri: string): void;
  /**
   * Wait for the copy a session's clients' plugins are still making.
   *
   * `retool` starts a copy and answers at once, because a session whose list
   * waited on a client's whole tree would show nothing while it read. The one
   * caller that may not wait is a run: its plugins are set on the session
   * before the session exists, and a backend takes its plugins when it starts
   * and offers no way to add one after.
   */
  pluginsSettled(uri: string): Promise<void>;
  /** The chat a tool means in a session: the one with that id, or the default. */
  chatMeant(held: Held, chatId: string | undefined): { uri: string; chat: Session } | undefined;
  /** A move a session's agent asked for, waiting for its turn to end. */
  moving: Map<string, Move>;
  /** Give a chat a title, and say so. */
  renameChat(uri: string, chatUri: string, title: string): void;
  /** What a host tool sees of this host, from inside one chat. */
  toolContext(uri: string, chatUri: string, provider?: string): ToolCall;
  /**
   * The client plugins a chat's agent is being handed, and a note of which they are.
   *
   * The directories the session's enabled plugins were copied to, in the order
   * the session lists them. Called where a backend is spawned, which is the
   * only moment a set can be handed over - so this also writes down what that
   * chat began with, the servers held back from those copies included, for its
   * next send to compare against.
   */
  pluginsFor(uri: string, chatUri: string): { path: string }[];
  /**
   * Whether the plugins a chat's agent was started with are still its session's set.
   *
   * A backend takes its plugins when it starts and offers no way to add one
   * after, so a set that moved is one this chat can only be handed by starting
   * it again. Read before a turn, which is the only moment a restart is safe.
   */
  pluginsMoved(uri: string, chatUri: string): boolean;
  /** The MCP servers this session is offered, read now rather than held. */
  mcpFor(uri: string): Record<string, McpServer>;
  /**
   * The servers of this session's client plugins that a client switched off.
   *
   * By name, for a backend that can be told not to run one however else it
   * might hear of it.
   */
  deniedMcpServers(uri: string): string[];
  /** The endpoints opened for a session, by the session that opened them. */
  served: Map<string, ToolsEndpoint[]>;
  /** Take back every endpoint a session opened. */
  toolsServersGone(uri: string): void;
  /**
   * The tools as one session runs them, with the host's own view bound in.
   * `provider` is the agent they are bound for, which each call carries.
   */
  boundTools(uri: string, chatUri: string, provider?: string): BoundTool[];
  /** What the host's tools want the model told, in the order the tools are offered. */
  instructions(uri: string): string[];
}

export function createTooling(ctx: HostContext): Tooling {
  const {
    options, sessions, byChat, first, kept, terminals, learned, rootConfig, sentBy, about,
    activeClientsOf, leadOf, heldAs, ownerOf, allRows, setArtifacts, forWhom,
    chatSummary, keepTitle, summaryMoved, operationsMoved, dispatch, log, fire,
    isolated, settle, openSession, backendsOwn, removeSession, spawn,
  } = ctx;

  /**
   * The tools a session is offered, with the permission applied once.
   *
   * A tool that says it needs advanced permission is left out unless the host
   * permits it, so it is neither reported in `serverTools` nor bound for a
   * call - decision `a-tool-says-when-it-needs-advanced-permission`. Applied
   * where the set is built, so `setTools` cannot put one back.
   */
  const permitted = (tools: readonly HostTool[]): HostTool[] =>
    tools.filter((one) => ctx.advancedTools === true || one.advancedPermission !== true);
  /**
   * Whether the advanced tools are offered, held here rather than read off
   * `options` because the daemon's `advancedTools` key is this host's option as
   * much as the daemon's, and a write of it takes hold while the daemon runs -
   * decision `a-configuration-change-applies-live-or-on-ahpd-restart`.
   */
  ctx.advancedTools = options.advancedTools === true;
  /**
   * The tools this host contributes, which `setTools` replaces.
   *
   * The protocol's `serverTools`: reported on every session's state, offered
   * to every backend that can take tools, and replaced whole - which is what
   * `session/serverToolsChanged` means.
   */
  ctx.contributed = options.tools ?? [];
  ctx.contributing = permitted(ctx.contributed);
  /**
   * The title strategy every session runs under, which is the deferred one.
   *
   * No root config key selects another strategy, as in VS Code's agent host.
   * A session this host is only browsing answers the same, where VS Code
   * answers `utility` for a session with no persisted strategy.
   */
  const strategyOf = (_uri: string): TitleStrategy => 'deferred';
  /**
   * One tool's definition for a session, after the strategy's shaping, or
   * nothing where the strategy withholds the tool.
   */
  const shapedDefinition = (one: HostTool, uri: string): ToolDefinition | undefined => {
    const asked = one.forSession?.({ titleStrategy: strategyOf(uri) });
    if (asked?.offered === false) return undefined;
    return asked?.definition === undefined ? one.definition : { ...one.definition, ...asked.definition };
  };
  /** The definitions alone for one session, which is the half that goes on the wire. */
  const toolDefinitions = (uri: string): ToolDefinition[] => ctx.contributing.flatMap((one) => {
    const shaped = shapedDefinition(one, uri);
    return shaped === undefined ? [] : [shaped];
  });
  /**
   * The tools the clients in a session provide, as tools to offer the model.
   *
   * `SessionActiveClient.tools` is what a client announces it can run, and the
   * protocol makes that client responsible for executing the call and saying
   * what it did. So these carry an owner and no implementation: the backend
   * offers them, reports the call against the client that provides it, and
   * waits.
   *
   * Named `<clientId>__<name>`, because two clients in one session may both
   * provide `openFile` and the model is offered one list. Anything without a
   * usable name or schema is dropped rather than offered as a tool the model
   * will fail to call.
   */
  const clientTools = (uri: string): BoundTool[] => activeClientsOf(uri).flatMap((client) => {
    const clientId = String(client.clientId ?? '');
    if (clientId === '') return [];
    return (Array.isArray(client.tools) ? client.tools : []).flatMap((entry) => {
      const definition = (typeof entry === 'object' && entry !== null ? entry : {}) as Bag;
      const name = typeof definition.name === 'string' ? definition.name : '';
      if (!/^[A-Za-z0-9_-]+$/.test(name)) return [];
      return [{
        definition: frozenCopy({
          ...definition as unknown as BoundTool['definition'],
          name: `${clientId}__${name}`,
        }),
        owner: clientId,
      }];
    });
  });

  /**
   * The plugins a session's clients handed it, by the client that handed them.
   *
   * Per session and per client id, because a plugin is one client's: two
   * clients may announce the same URI and each gets its own copy, and a
   * client's plugins leave with the client.
   */
  const plugins = new Map<string, Map<string, HeldPlugin[]>>();
  /** The session being reconciled, one at a time: a second announcement waits for the first copy. */
  const copying = new Map<string, Promise<void>>();

  /** Whether two announcements are the same plugin at the same revision. */
  const samePlugin = (a: Bag, b: Bag): boolean =>
    (str(a.uri) ?? '') === (str(b.uri) ?? '') && (str(a.nonce) ?? '') === (str(b.nonce) ?? '');

  /** The plugin customizations a client announced, dropping anything that could not be one. */
  const announcedBy = (client: Bag): Bag[] => (Array.isArray(client.customizations) ? client.customizations : [])
    .map((one) => bag(one))
    // A plugin this host cannot name is one it cannot copy or report, and the
    // protocol's own field is the plugin's URI.
    .filter((one) => one.type === 'plugin' && typeof one.uri === 'string' && one.uri !== '');

  /**
   * The enablement decisions a client published, in the shape the protocol
   * declares and no other: a client's junk is dropped rather than published
   * back as a customization no client can read.
   */
  const enablementOf = (value: unknown): Bag[] => (Array.isArray(value) ? value : [])
    .map((one) => bag(one))
    .filter((one) => typeof one.enabled === 'boolean'
      && (one.kind === 'global' || one.kind === 'session' || (one.kind === 'workspace' && typeof one.uri === 'string')));

  /**
   * What a plugin carries as its decisions, most specific first.
   *
   * The session's own decision comes first because a toggle is about this
   * session, and the client's published ones after it in the order it gave
   * them - which is the order the protocol asks for, Session before Global.
   */
  const decisionsOf = (one: HeldPlugin): Bag[] => [...(one.decision ?? []), ...enablementOf(one.announced.enablement)];

  /** Whether a plugin is on: the most specific decision wins, and no decision at all is on. */
  const enabledOf = (one: HeldPlugin): boolean => decisionsOf(one)[0]?.enabled !== false;

  /** Whether a part is switched off: the most specific decision wins, and no decision at all is on. */
  const off = (part: Bag): boolean =>
    (Array.isArray(part.enablement) ? part.enablement as Bag[] : [])[0]?.enabled === false;

  /** The id a plugin is published under: the client's own, or one this host makes from what names it. */
  const idOfPlugin = (clientId: string, one: HeldPlugin): string => {
    const minted = str(one.announced.id);
    return minted === undefined || minted === '' ? `${clientId}|${str(one.announced.uri) ?? ''}` : minted;
  };

  /** How specific a decision's scope is, most specific first: Session, then Workspace, then Global. */
  const specificityOf = (one: Bag): number => {
    const kind = str(one.kind);
    return kind === 'session' ? 0 : kind === 'workspace' ? 1 : 2;
  };

  /**
   * The parts of a copy that has just landed, with a client's decisions on them.
   *
   * Read once, when the copy settles, rather than on every read of a session's
   * customizations: the directory is on this host's disk and does not move, and
   * a client reads the list far more often than a plugin is copied.
   *
   * `childEnablement` is a client's decisions, keyed by a part's name, and the
   * protocol lets one hang on an MCP server alone: a skill, an agent, a rule
   * and a hook load with the plugin they arrived in. So a server the client
   * named carries what it decided, most specific first, and one it did not is
   * left with none - which every reader of the field takes as on.
   *
   * Nothing at all for a copy whose format this host does not read, which is
   * *not* the same answer as no parts: the protocol reads `children` absent as
   * a container nobody has parsed, and an empty list as one that was parsed and
   * contributes nothing.
   */
  const partsWith = (one: HeldPlugin, path: string): Bag[] | undefined => {
    const parts = partsOf(path, uriOf(path));
    if (parts === undefined) return undefined;
    const named = bag(one.announced.childEnablement);
    return parts.map((part) => {
      const name = str(part.name) ?? '';
      if (part.type !== 'mcpServer' || !Object.hasOwn(named, name)) return part;
      const decisions = enablementOf(named[name]).sort((a, b) => specificityOf(a) - specificityOf(b));
      return decisions.length === 0 ? part : { ...part, enablement: decisions };
    });
  };

  /**
   * One client plugin as a session's customization.
   *
   * Everything the client said about the plugin with this host's answer on it,
   * and without the two fields that are the client's own side of the bargain:
   * `nonce` is the revision it published rather than anything a session has,
   * and `childEnablement` is a decision this host applies to what the plugin
   * contributes rather than a customization of its own.
   */
  const entryOf = (clientId: string, one: HeldPlugin): Bag => {
    const uri = str(one.announced.uri) ?? '';
    const decisions = decisionsOf(one);
    const version = str(one.announced.version);
    return {
      type: 'plugin',
      id: idOfPlugin(clientId, one),
      uri,
      name: str(one.announced.name) ?? uri,
      clientId,
      load: one.load,
      // The parts a client reads under the plugin, absent while the copy is
      // still coming and after one nobody could read.
      ...(one.parts === undefined ? {} : { children: one.parts }),
      ...(decisions.length === 0 ? {} : { enablement: decisions }),
      ...(version === undefined ? {} : { version }),
    };
  };

  /** A session's client plugins, as customizations for a client to read. */
  const clientPluginsOf = (uri: string): Bag[] => {
    const held = plugins.get(idOf(uri));
    if (held === undefined) return [];
    // Frozen copies, for the same reason a tool definition is one: these leave
    // the host, and a reader that wrote to one would be writing the session's
    // own answer.
    return [...held].flatMap(([clientId, list]) => list.map((one) => frozenCopy(entryOf(clientId, one))));
  };

  /**
   * Turn a client plugin, or one of its servers, on or off, if the id names one.
   *
   * The plugin stays on the list with the decision on it rather than leaving:
   * what a toggle changes is whether it is part of what the session runs, and
   * a client that switched one off has to be able to switch it back. The
   * backend is never asked about a plugin itself - it has never heard of this
   * customization - while a server of one is also the agent's, which is what
   * the answer says.
   *
   * A server is the only part a decision reaches: a skill, an agent, a rule
   * and a hook load with the plugin they arrived in, and the protocol lets no
   * enablement hang on one. An id naming one of those is left to the backend,
   * which refuses it out loud.
   */
  const toggleClientPlugin = (uri: string, id: string, enablement: Bag[]): Toggled | undefined => {
    const held = plugins.get(idOf(uri));
    if (held === undefined || id === '') return undefined;
    const decisions = enablementOf(enablement);
    const wanted = decisions.find((entry) => entry.kind === 'session') ?? decisions[0];
    const on = wanted?.enabled !== false;
    for (const [clientId, list] of held) {
      for (const one of list) {
        // By whatever names it: the id it is published under, the id the
        // client minted, or the URI it was announced at.
        const named = id === idOfPlugin(clientId, one) || id === str(one.announced.id) || id === str(one.announced.uri);
        if (named) {
          one.decision = [{ kind: 'session', enabled: on }];
          dispatch(uri, { type: 'session/customizationUpdated', customization: entryOf(clientId, one) });
          return {};
        }
        const parts = one.parts ?? [];
        const at = parts.findIndex((part) => part.type === 'mcpServer' && str(part.id) === id);
        if (at === -1) continue;
        const part = bag(parts[at]);
        /*
         * A new part in a new list: what a client was already sent is the
         * list as it was, and the decision is the change it is being told
         * about rather than a rewrite of an older message.
         */
        const was = (Array.isArray(part.enablement) ? part.enablement as Bag[] : [])
          .filter((entry) => entry.kind !== 'session');
        one.parts = parts.map((other, position) => (position === at
          ? { ...other, enablement: [{ kind: 'session', enabled: on }, ...was] }
          : other));
        dispatch(uri, { type: 'session/customizationUpdated', customization: entryOf(clientId, one) });
        return { server: str(part.name) ?? '' };
      }
    }
    return undefined;
  };

  /**
   * What a session's backend reports as its customizations.
   *
   * The half a client plugin list is laid over. Read from the lead chat, or
   * from what the backend said it offers when nothing is running - the same
   * answer its snapshot gives, so a `customizationsChanged` and a snapshot of
   * the same session say the same thing.
   */
  const reportedBy = (uri: string): Bag[] => {
    const held = sessions.get(uri);
    const lead = held === undefined ? undefined : leadOf(held);
    return lead === undefined ? about(schemeOf(heldAs(uri))).seeds as Bag[] : lead.customizations();
  };

  /** Copy one client's plugins, answering one state per plugin and never throwing. */
  const copyOf = async (port: ClientPlugins, clientId: string, list: HeldPlugin[]): Promise<SyncedPlugin[]> => {
    const asked = list.map((one) => {
      const nonce = str(one.announced.nonce);
      return { uri: str(one.announced.uri) ?? '', ...(nonce === undefined ? {} : { nonce }) };
    });
    // A port that threw has still answered for every plugin it was asked
    // about: none of them was copied, and the reason is the same for each.
    try { return await port.sync(clientId, asked); }
    catch (error) { return asked.map((one) => ({ ...one, error: reason(error) })); }
  };

  /**
   * What a session's clients contribute, as one string.
   *
   * The comparison that says nothing moved: a client that announces itself
   * again with the same plugins is not a change, and reporting one would be
   * the echo that prompted the next announcement.
   */
  const signatureOf = (rows: Map<string, HeldPlugin[]>): string => [...rows]
    .map(([clientId, list]) => `${clientId}:${list.map((one) => `${str(one.announced.uri) ?? ''}#${str(one.announced.nonce) ?? ''}`).join(',')}`)
    .join('|');

  /**
   * Copy what a session's clients announced, and say what happened.
   *
   * The entries go out before the copies are made: a copy is a client's whole
   * plugin tree read over its connection, and a session whose list waited for
   * it would show nothing at all for as long as that took - while `loading` is
   * exactly what the field is for.
   */
  const reconcile = async (uri: string): Promise<void> => {
    const at = idOf(uri);
    const before = plugins.get(at) ?? new Map<string, HeldPlugin[]>();
    const asked = new Map<string, Bag[]>();
    for (const client of activeClientsOf(uri)) {
      const clientId = str(client.clientId) ?? '';
      if (clientId !== '') asked.set(clientId, announcedBy(client));
    }
    const fresh = new Map<string, HeldPlugin[]>();
    const added = new Map<string, HeldPlugin[]>();
    for (const [clientId, list] of asked) {
      const was = before.get(clientId) ?? [];
      // Matched by URI and nonce, so a plugin announced again unchanged is the
      // copy this host already has rather than a second one beside it.
      const now = list.map((one) => was.find((old) => samePlugin(old.announced, one)) ?? { announced: one, load: { kind: 'loading' } });
      const made = now.filter((one) => !was.includes(one));
      if (made.length > 0) added.set(clientId, made);
      fresh.set(clientId, now);
    }
    // Nothing moved. Said again is not changed, and this host holds the list a
    // client already has.
    if (signatureOf(fresh) === signatureOf(before)) return;
    if (fresh.size === 0) plugins.delete(at);
    else plugins.set(at, fresh);

    const settled: { clientId: string; one: HeldPlugin }[] = [];
    const port = options.clientPlugins;
    if (port === undefined) {
      // A host with nowhere to put a copy is a host that keeps none, and each
      // plugin is owed the reason rather than a promise that never settles.
      for (const [clientId, list] of added) {
        for (const one of list) {
          one.load = { kind: 'error', message: KEEPS_NONE };
          settled.push({ clientId, one });
        }
      }
    } else {
      for (const [clientId, list] of added) {
        for (const one of list) dispatch(uri, { type: 'session/customizationUpdated', customization: entryOf(clientId, one) });
      }
      for (const [clientId, list] of added) {
        const answers = await copyOf(port, clientId, list);
        list.forEach((one, position) => {
          const answer = answers[position];
          if (answer !== undefined && 'path' in answer) {
            one.path = answer.path;
            one.parts = partsWith(one, answer.path);
            one.load = { kind: 'loaded' };
          } else {
            one.load = { kind: 'error', message: answer !== undefined && 'error' in answer ? answer.error : `${String(one.announced.uri ?? '')} was not copied` };
          }
          settled.push({ clientId, one });
        });
      }
    }
    for (const { clientId, one } of settled) dispatch(uri, { type: 'session/customizationUpdated', customization: entryOf(clientId, one) });
    // One list for the whole batch, after every copy it contains has settled:
    // the actions above carry the one plugin that changed, and this carries the
    // session's customizations as they now are.
    dispatch(uri, { type: 'session/customizationsChanged', customizations: reportedBy(uri) });
  };

  /**
   * The copies a session's enabled client plugins live in, in the order it lists them.
   *
   * A plugin that is switched off leaves this set, and so does one still being
   * copied or one whose copy failed: what an agent can be handed is a
   * directory that is here.
   */
  const heldCopies = (uri: string): HeldPlugin[] => [...(plugins.get(idOf(uri))?.values() ?? [])]
    .flat()
    .filter((one) => one.path !== undefined && one.load.kind === 'loaded' && enabledOf(one));

  /** The directories those copies are in. */
  const pluginCopies = (uri: string): string[] => heldCopies(uri).map((one) => one.path as string);

  /**
   * The servers of those copies that a client switched off, by name.
   *
   * Read off what each copy holds rather than out of the files: a decision
   * about a server is a customization's, and a plugin this host did not read
   * holds nothing to decide about. A plugin switched off takes every one of
   * its servers with it and needs none of them named, because it is not handed
   * over at all.
   *
   * What the names are for is the agent: this host leaves such a server out of
   * what it declares, and names it where the backend is started so the CLI is
   * told not to run it however else it might hear of one.
   */
  const deniedMcpServers = (uri: string): string[] => heldCopies(uri).flatMap((one) =>
    (one.parts ?? []).filter((part) => part.type === 'mcpServer' && off(part)).map((part) => str(part.name) ?? ''));

  /**
   * What each chat's agent was started with, by the chat's URI.
   *
   * A backend takes its plugins when its CLI starts and offers no way to add
   * one after, so a set that moved reaches a chat by starting it again - and
   * the only thing that can say whether it moved is what it began with.
   */
  const startedWith = new Map<string, string>();

  /**
   * The one string that is what a chat was started with: the directories it
   * was handed, and the servers held back from them.
   *
   * Empty for a chat that was handed neither, which is what `startedWith`
   * holds nothing for. A server switched off moves the set even though no
   * directory did, because the plugin it belongs to is the same one and what
   * the agent may run is not.
   */
  const setOf = (paths: string[], denied: string[]): string =>
    (paths.length === 0 && denied.length === 0 ? '' : `${paths.join('\u0000')}\u0001${denied.join('\u0000')}`);

  const pluginsFor = (uri: string, chatUri: string): { path: string }[] => {
    const paths = pluginCopies(uri);
    const denied = deniedMcpServers(uri);
    if (paths.length === 0 && denied.length === 0) startedWith.delete(chatUri);
    else startedWith.set(chatUri, setOf(paths, denied));
    return paths.map((path) => ({ path }));
  };

  const pluginsMoved = (uri: string, chatUri: string): boolean =>
    (startedWith.get(chatUri) ?? '') !== setOf(pluginCopies(uri), deniedMcpServers(uri));

  /**
   * Work out what a session's clients contribute now, after they moved.
   *
   * One reconcile per session at a time. A client that announces again while a
   * copy is running is announcing over the answer to the last one, and two
   * copies writing the same directory would be two answers to one question.
   */
  const reconcilePlugins = (uri: string): void => {
    const earlier = copying.get(uri) ?? Promise.resolve();
    const done = earlier.then(() => reconcile(uri)).catch(() => {});
    copying.set(uri, done);
    void done.then(() => { if (copying.get(uri) === done) copying.delete(uri); });
  };

  /**
   * Tell a session's chats what they may offer, after the clients moved.
   *
   * Every chat, because the clients are the session's rather than one chat's -
   * somebody with two conversations open in one session contributes the same
   * tools to both. A backend that cannot take tools at all answers false and
   * is left alone; there is nothing to report to a client either way, because
   * what it announced is already on the session state.
   *
   * The plugins go through here as well, which is why the reconcile comes
   * first and before the guard: a session this host is only browsing has no
   * chat to retool and still has clients handing it plugins.
   */
  const retool = (uri: string): void => {
    reconcilePlugins(uri);
    const held = sessions.get(uri);
    if (!held) return;
    for (const [chatUri, chat] of held.chats) {
      void chat.setTools?.(boundTools(uri, chatUri)).catch(() => {});
    }
  };

  /**
   * Wait for the copy this session's plugins are still making.
   *
   * The one that was already going when this was asked for, and not one a
   * later announcement starts - `retool` and this are called together, and
   * what is being waited for is the copy the first of them began.
   */
  const pluginsSettled = async (uri: string): Promise<void> => {
    const held = copying.get(uri);
    if (held !== undefined) await held;
  };

  /** The chat a tool means in a session: the one with that id, or the default. */
  const chatMeant = (held: Held, chatId: string | undefined): { uri: string; chat: Session } | undefined => {
    if (chatId === undefined) {
      const lead = leadOf(held);
      return lead === undefined ? undefined : { uri: held.defaultChat, chat: lead };
    }
    for (const [at, chat] of held.chats) {
      if (idOf(at) === chatId) return { uri: at, chat };
    }
    return undefined;
  };

  /**
   * A move a session's agent asked for, waiting for its turn to end.
   *
   * `set_workspace` is the one tool that cannot act when it is called: the
   * agent is restarted in the new directory, and a restart mid-turn is a turn
   * that never finishes. So the request is held here and acted on from the
   * `emit` hook the moment the chat says its turn is over.
   */
  const moving = new Map<string, { chat: string; directory: string; isolation: boolean }>();

  /**
   * Give a chat a title, and say so.
   *
   * The session's title is its default chat's and goes out as
   * `session/titleChanged`; a peer chat's is its own and goes out as
   * `session/chatUpdated`. A client renaming a row and an agent calling
   * `rename_chat` come to the same place.
   */
  const renameChat = (uri: string, chatUri: string, title: string): void => {
    const held = sessions.get(uri);
    const found = held?.chats.get(chatUri);
    if (held === undefined || found === undefined) throw new Error(`${chatUri} is not a chat this host is running`);
    found.setTitle?.(title);
    // Written down here rather than at either caller, because a client's
    // `session/titleChanged` and the `rename_chat` tool both come through.
    keepTitle(uri, chatUri, title);
    if (chatUri === held.defaultChat) dispatch(uri, { type: 'session/titleChanged', title });
    else dispatch(uri, { type: 'session/chatUpdated', chat: chatUri, changes: { title } });
    summaryMoved(uri);
    // The session's title is the subject a commit would use, so the question
    // the changeset's commit asks names a different line now.
    operationsMoved(uri);
  };

  /**
   * What a host tool sees of this host, from inside one chat.
   *
   * Every operation here is one a client already has - a command, or an
   * action a client may dispatch - reached from a turn rather than a socket.
   * The catalogue is `allRows()`, which is what `listSessions` answers; a
   * message is `begin` or `queue` on the chat, which is what `chat/turnStarted`
   * and `chat/pendingMessageSet` come to; a session is `openSession`, which is
   * what `createSession` comes to. Nothing is reachable from here that is not
   * reachable from a client, and the reverse is nearly true.
   */
  /**
   * The agent a session runs, as `ToolCall.provider`: the one its tools were
   * bound for, else the held session's.
   */
  const providerOf = (uri: string, bound?: string): { provider?: string } => {
    const provider = bound ?? sessions.get(heldAs(uri))?.agent.provider;
    return provider === undefined ? {} : { provider };
  };

  /**
   * The turn running in one chat, or nothing where it is between turns.
   *
   * Read off the chat rather than remembered, because a turn begins and ends
   * without this host being consulted: the backend is what holds the state.
   */
  const activeTurnOf = (chatUri: string): string | undefined => {
    const chat = byChat.get(chatUri)?.chat;
    const active = chat === undefined ? undefined : (chat.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
    return typeof active?.id === 'string' ? active.id : undefined;
  };

  const toolContext = (uri: string, chatUri: string, provider?: string): ToolCall => ({
    session: uri,
    chat: chatUri,
    ...providerOf(uri, provider),
    turn: () => activeTurnOf(chatUri),
    sessions: () => allRows(),
    chats: (session) => {
      const held = sessions.get(heldAs(session));
      if (!held) return [];
      const rows = [...held.chats].map(([at, chat]) => ({ resource: at, title: chat.title() }));
      // The default first, since that is the one a link without a chat opens.
      rows.sort((a_, b_) => Number(b_.resource === held.defaultChat) - Number(a_.resource === held.defaultChat));
      return rows;
    },
    models: () => [...learned].flatMap(([provider, known]) => known.models.map((model) => ({
      id: model.id, name: model.name, provider,
    }))),
    context: async (session, chatId) => {
      const held = sessions.get(heldAs(session));
      const found = held === undefined ? undefined : chatMeant(held, chatId);
      if (found === undefined) return undefined;
      const state = found.chat.chatState() as { turns?: unknown; activeTurn?: unknown; turnsNextCursor?: unknown };
      /*
       * Frozen copies of the turns, for the same reason a tool definition is
       * one: this leaves the host with whichever host tool asked, and a tool
       * that rewrote a turn would be rewriting the conversation - decision
       * `a-plugin-gets-frozen-copies-of-host-values`.
       */
      return frozenCopy({
        turns: Array.isArray(state.turns) ? state.turns as Bag[] : [],
        ...(typeof state.activeTurn === 'object' && state.activeTurn !== null ? { activeTurn: state.activeTurn as Bag } : {}),
        hasMoreHistory: state.turnsNextCursor !== undefined,
      });
    },
    send: async (session, chatId, text, from) => {
      const held = sessions.get(heldAs(session));
      const found = held === undefined ? undefined : chatMeant(held, chatId);
      if (found === undefined) throw new Error(`${session} is not a session this host is running`);
      const state = found.chat.chatState() as { activeTurn?: unknown; queuedMessages?: unknown; steeringMessage?: unknown };
      const busy = state.activeTurn !== undefined || state.steeringMessage !== undefined
        || (Array.isArray(state.queuedMessages) && state.queuedMessages.length > 0);
      if (busy) {
        found.chat.queue(crypto.randomUUID(), text, undefined, from);
        return 'queued';
      }
      found.chat.begin(crypto.randomUUID(), text, undefined, from);
      return 'sent';
    },
    create: async (asked) => {
      const provider = asked.provider ?? sessions.get(uri)?.agent.provider ?? first.provider;
      // Held under its provider's name, as a client's `createSession` is.
      const made = `${provider}:/${crypto.randomUUID()}`;
      const config: Record<string, unknown> = {
        ...(asked.isolation !== undefined ? { isolation: asked.isolation } : {}),
        ...(asked.model !== undefined ? { model: asked.model } : {}),
      };
      // The same steps `createSession` takes for a client, in the same order:
      // the tree before anything runs in it, the host's keys kept apart from
      // the backend's.
      const where = await isolated(made, config, asked.workingDirectory);
      await settle(made, asked.workingDirectory, config);
      // The owner of the session this one was made inside, which is what a
      // tool acting for somebody means: the work is theirs whichever session
      // it ends up running in.
      openSession(made, provider, backendsOwn(config), where, undefined, undefined, undefined, asked.title,
        forWhom(kept.owner(idOf(uri))));
      /*
       * The session this one was made inside, kept with its record.
       *
       * In the store rather than in memory, because what the link is for is
       * telling this session when its child ends, and a child can end after a
       * restart. The id is what is kept, so the session is found again under
       * whichever scheme this host is publishing it by then.
       */
      kept.setParent?.(idOf(made), idOf(uri));
      const lead = byChat.get(chatUriFor(made));
      if (lead === undefined) throw new Error(`${made} did not start`);
      lead.chat.begin(crypto.randomUUID(), asked.prompt, asked.model === undefined ? undefined : { id: asked.model }, asked.from);
      return { session: made, chat: chatUriFor(made) };
    },
    createChat: async (session, asked) => {
      const at = heldAs(session);
      const held = sessions.get(at);
      if (!held) throw new Error(`${session} is not a session this host is running`);
      const chatUri = `ahp-chat:/${crypto.randomUUID()}`;
      const chat = spawn(held.agent, at, chatUri, chatIdFor(at, chatUri), backendsOwn(held.config), undefined, held.workingDirectory, undefined, held.additional);
      log(`opened ${chatUri} in ${at}`);
      if (asked.title !== undefined) { chat.setTitle?.(asked.title); keepTitle(at, chatUri, asked.title); }
      dispatch(at, { type: 'session/chatAdded', summary: chatSummary(at, chatUri, chat) });
      chat.begin(crypto.randomUUID(), asked.prompt, asked.model === undefined ? undefined : { id: asked.model }, asked.from);
      return { chat: chatUri };
    },
    rename: (session, chat, title) => { renameChat(heldAs(session), chat, title); },
    /*
     * A session deleted from inside another one, by whoever owns this session.
     *
     * The tool acts for the session it is running in, so that session's owner
     * is the person asking - not the model, and not the connection that started
     * whichever session the name names. A session with no owner on this host
     * has no person behind it either, which is the same "nobody to name" the
     * owner's own reference has and the same answer: nobody is refused. An
     * owner whose principal this process has not met yet goes as the owner.
     */
    remove: async (session) => {
      const by = forWhom(kept.owner(idOf(uri)));
      await removeSession(heldAs(session), by?.principal ?? by?.owner);
    },
    setWorkspace: (directory, isolation) => {
      /*
       * The connection that asked, kept beside the move.
       *
       * The move is made after this turn ends, when the turn's own record of
       * who sent it is gone - so the window is written down here, where the
       * turn is still running, and it is that window the host asks about the
       * folder when the move is made.
       */
      const turn = activeTurnOf(chatUri);
      const sender = turn === undefined ? undefined : sentBy.get(turn);
      moving.set(uri, {
        chat: chatUri,
        directory: localPath(directory),
        isolation,
        ...(sender === undefined ? {} : { sender }),
      });
    },
    artifacts: () => [...(kept.artifacts(idOf(uri)) ?? [])],
    setArtifacts: (list) => { setArtifacts(uri, list); },
    terminals: () => [...terminals.values()].map((held) => ({
      uri: held.uri,
      title: held.title(),
      cwd: String((held.state() as Record<string, unknown>).cwd ?? ''),
      running: held.exitCode() === undefined,
    })),
    read: async (asked) => {
      // The client that published it, if one did - that is the only thing
      // that can read it - and this host's own store otherwise.
      const owner = ownerOf(asked);
      const answer = owner === undefined
        ? await need(options.resources, 'resourceRead').read(asked)
        : await owner.peer.request('resourceRead', { channel: ROOT, uri: asked });
      const held = (typeof answer === 'object' && answer !== null ? answer : {}) as {
        data?: unknown; encoding?: unknown;
      };
      const data = String(held.data ?? '');
      return bodyText({ data, encoding: held.encoding === 'base64' ? 'base64' : 'utf-8' });
    },
  });

  /**
   * The MCP servers one plugin copy declares, by name.
   *
   * A plugin's own `.mcp.json`, brought over with the rest of it. Only the two
   * shapes this host has a name for are read - a command to run and a URL to
   * reach - and an entry of any other shape is left to the backend, which
   * reads the same file itself. A command that is not absolute is resolved
   * against the copy, because it is written relative to the plugin it came in
   * and not to the directory this process happens to be in.
   *
   * A file that is missing, unreadable or not an object contributes nothing,
   * the way the CLI's own settings files do: a plugin nobody declared servers
   * in is the ordinary case, and one this cannot read is a backend's to read.
   */
  const serversOf = (path: string): Record<string, McpServer> => {
    const outcome = readJsonObject(join(path, '.mcp.json'));
    if (!outcome.ok) return {};
    const servers: Record<string, McpServer> = {};
    for (const [name, held] of Object.entries(bag(outcome.value.mcpServers))) {
      const config = bag(held);
      const command = str(config.command);
      const url = str(config.url);
      if (command !== undefined) {
        const env = bag(config.env);
        const cwd = str(config.cwd);
        servers[name] = {
          type: 'stdio',
          command: isAbsolute(command) ? command : join(path, command),
          ...(Array.isArray(config.args) ? { args: config.args.map(String) } : {}),
          ...(Object.keys(env).length === 0 ? {} : { env: env as Record<string, string> }),
          ...(cwd === undefined ? {} : { cwd }),
        };
      }
      else if (url !== undefined && (config.type === undefined || config.type === 'http')) {
        const headers = bag(config.headers);
        servers[name] = {
          type: 'http',
          url,
          ...(Object.keys(headers).length === 0 ? {} : { headers: headers as Record<string, string> }),
        };
      }
    }
    return servers;
  };

  /**
   * The MCP servers this session is offered, read now rather than held.
   *
   * The host's own map with the session's enabled client plugins' over it, a
   * client plugin winning a name clash - the merge VS Code makes - because the
   * client that asked for a server is closer to the work than the host is.
   *
   * Read at each spawn rather than held, so a plugin that was switched off
   * between two sends is gone from the set the next one is handed, and one
   * whose copy has not landed yet contributes nothing rather than a directory
   * that is not there.
   *
   * A server of a plugin that a client switched off is left out here, which is
   * what keeps it from being declared to the agent at all. A copy this host
   * did not read contributes every server in its `.mcp.json`: nothing was
   * decided about a plugin whose parts nobody parsed.
   */
  const mcpFor = (uri: string): Record<string, McpServer> => frozenCopy(heldCopies(uri)
    .reduce<Record<string, McpServer>>((all, one) => {
      const held = new Set((one.parts ?? [])
        .filter((part) => part.type === 'mcpServer' && off(part))
        .map((part) => str(part.name) ?? ''));
      for (const [name, server] of Object.entries(serversOf(one.path as string))) {
        if (!held.has(name)) all[name] = server;
      }
      return all;
    }, { ...options.mcpServers }));

  /**
   * The endpoints opened for a session, by the session that opened them.
   *
   * Closed when the session goes, so a path nobody holds a token for is a path
   * that stopped answering rather than one that outlived the tools behind it.
   */
  const served = new Map<string, ToolsEndpoint[]>();
  /** Take back every endpoint a session opened. */
  const toolsServersGone = (uri: string): void => {
    for (const opened of served.get(uri) ?? []) opened.close();
    served.delete(uri);
  };

  /**
   * The tools as one session runs them, with the host's own view bound in.
   *
   * A backend is handed something it can call and nothing else: which session
   * asked, and what this host knows about the sessions and terminals beside
   * it, are answered here because they are the host's to answer.
   *
   * None at all for a session opened for its words alone. A model writing a
   * commit message has no business reading the tree it is being asked about,
   * and a client handing tools to such a session later reaches this through
   * `retool` - so the answer is empty here rather than only at the start.
   */
  const boundTools = (uri: string, chatUri: string, provider?: string): BoundTool[] =>
    ctx.bareSessions.has(uri) ? [] : offeredTools(uri, chatUri, provider);

  /** The tools a session with something to call is handed, in the order it is offered them. */
  const offeredTools = (uri: string, chatUri: string, provider?: string): BoundTool[] => [
    ...clientTools(uri),
    ...ctx.contributing.flatMap((one): BoundTool[] => {
      const definition = shapedDefinition(one, uri);
      return definition === undefined ? [] : [{
        /*
         * A frozen copy: this one leaves the host with the backend, and a
         * backend that changed the wording would be changing what the host
         * offers the next session - decision
         * `a-plugin-gets-frozen-copies-of-host-values`.
         */
        definition: frozenCopy(definition),
        // The call and its outcome are one event, raised after the tool is
        // done, so a handler knows whether it answered and not only that it
        // ran. Raising it before would report an attempt as a result.
        run: async (input: Record<string, unknown>): Promise<string> => {
          try {
            const answer = await one.run(input, toolContext(uri, chatUri, provider));
            void fire({ type: 'tool_call', session: uri, chat: chatUri, tool: definition.name, ok: true });
            return answer;
          }
          catch (error) {
            void fire({
              type: 'tool_call',
              session: uri,
              chat: chatUri,
              tool: definition.name,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        ...(one.effects !== undefined ? { effects: frozenCopy(one.effects) } : {}),
        ...(one.deferLoading !== undefined ? { deferLoading: one.deferLoading } : {}),
      }];
    }),
  ];
  /** What the host's tools want the model told, in the order the tools are offered. */
  const instructions = (uri: string): string[] => ctx.contributing.flatMap((one) => {
    if (one.forSession?.({ titleStrategy: strategyOf(uri) })?.offered === false) return [];
    return one.instruction === undefined ? [] : [one.instruction];
  });

  return {
    permitted, strategyOf, shapedDefinition, toolDefinitions,
    clientTools, clientPluginsOf, toggleClientPlugin, retool, pluginsSettled, chatMeant, renameChat, toolContext,
    pluginsFor, pluginsMoved, mcpFor, deniedMcpServers,
    toolsServersGone, boundTools, instructions,
    moving, served,
  };
}