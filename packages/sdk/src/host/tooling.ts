import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { idOf, uriFor } from '../sessions/catalog.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { frozenCopy } from '../utils/frozen.js';
import { accepts } from '../utils/configvalues.js';
import { readJsonObject } from '../utils/jsonfile.js';
import { partsOf, rulesOf } from '../plugins/pluginparts.js';
import { bodyText } from '../resources/records.js';
import { BINDINGS_KEY } from '../connectors/bindings.js';
import { actionTools } from '../connectors/actions.js';
import { CREATED_BY_META, SEND_REMOTE_MESSAGE } from '../sessions/remotesession.js';
import { SESSION_TOOL_NAMES } from '../tools/session.js';
import { bag, ownerOfPrincipal, reason, str } from '../utils/values.js';
import { groupOf } from '../access/users.js';
import { enablementKeyOf } from '../plugins/enablement.js';
import { chatIdFor, chatUriFor, schemeOf } from './channels.js';
import { AGENT_CLIENT_SCHEME } from './clienturi.js';
import { need, noProvider } from './common.js';
import { asksForTool } from './spawn.js';
import { preambleOf } from './preamble.js';
import { readAggregate, startsRead } from './chatactions.js';
import { refusalReason } from './gate.js';
import type { Bag } from '../types/common.js';
import type { Grant, Principal } from '../types/users.js';
import type { Owner } from '../types/usage.js';
import type { ClientPlugins, SyncedPlugin } from '../types/clientplugins.js';
import type { HostTool, SessionlessToolCall, ToolCall, ToolCaller, TitleStrategy, ToolSession } from '../types/host.js';
import type { Agent, BoundTool, McpServer } from '../types/agent.js';
import type { Session, TurnOptions } from '../types/session.js';
import type { ChatSummary, ToolDefinition } from '@microsoft/agent-host-protocol';
import type { ToolsEndpoint } from '../tools/server.js';
import type { Held } from './state.js';
import type { Move } from './lifecycle.js';
import type { HostContext } from './context.js';

/**
 * How deep a chain of sessions made from inside sessions may go.
 *
 * VS Code's `maxSessionSpawnDepth`, from `serverSessionTools.ts`: a session a
 * person started is depth 0, one the `create` tool made inside a depth-N
 * session is N+1, and a session at this depth may not make another. What is
 * bounded is the chain - A makes B makes C - and how many are made across it
 * is the count below.
 */
const MAX_SPAWN_DEPTH = 3;

/** VS Code's `maxCreatedSessions`: how many sessions one tree may make. */
const MAX_CREATED_SESSIONS = 50;

/** VS Code's `maxCreatedChats`: how many chats one tree may make, by either tool. */
const MAX_CREATED_CHATS = 50;

/** VS Code's `maxSentMessages`: how many messages one tree may send. */
const MAX_SENT_MESSAGES = 100;

/**
 * The most of one client rule's body this host puts in a system prompt, in characters.
 *
 * A rule is standing words: every turn of every chat in the session carries
 * them, so a rule of this length is about a thousand tokens on each of them. A
 * rule over it is dropped rather than shortened, because half of an instruction
 * is words nobody wrote - and it is dropped with its name in the log, so a
 * client can see that it was.
 */
const RULE_MOST = 4096;

/**
 * VS Code's `orchestrationLimitWindowMs`: the sliding window each count is
 * taken over, so room frees up as older actions leave it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L43-L44
 */
const LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * What one session tree may make in the window, and the action its refusal
 * names.
 *
 * VS Code's three limiters and its refusal, from `sessionServerTools.ts`, each
 * counted over the window. VS Code counts per session; here it is one session
 * tree, the plan's own answer to what the counts are kept per, so the
 * sentence says the tree, which is what is true of it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L86-L94
 */
const TREE_LIMITS = {
  sessions: { max: MAX_CREATED_SESSIONS, action: 'create more sessions' },
  chats: { max: MAX_CREATED_CHATS, action: 'create more chats' },
  messages: { max: MAX_SENT_MESSAGES, action: 'send more messages' },
} as const;

/** Which of the three a tree is being asked about. */
type Made = keyof typeof TREE_LIMITS;

/**
 * What a host says about a client's plugin when it has nowhere to keep one.
 */
const KEEPS_NONE = 'this host keeps no client plugins';

/**
 * What an agent working a session another window delegated here is told.
 *
 * The window's own text, word for word, from its `remoteSessionOrigin`
 * contribution: every delegated task's result, blocker or question goes back
 * to the chat the work came from, through the tool that same contribution
 * names. The tool's name is the one spelling this file changes, so the text
 * and the rule below cannot come apart.
 */
const REMOTE_SESSION_ORIGIN_INSTRUCTION = `<remote_session_origin>
For each delegated task from the origin, including follow-ups, send results, blockers, or questions to the exact originating chat using ${SEND_REMOTE_MESSAGE} with session "origin" before ending your turn, unless explicitly told not to report back. Final answers are not forwarded.
Load ${SEND_REMOTE_MESSAGE} with tool search if needed.
Only claim delivery after "sent" or "queued"; report failures here. Do not retry uncertain delivery.
Do not acknowledge messages with no new task or question. Continue independent work or end your turn; do not sleep or poll for replies.
</remote_session_origin>`;

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
 * What a session carries under the id a toggle names.
 *
 * `key` is where the customization's global and folder decisions are kept.
 * `of` picks the half the id named, which is what says whether the backend is
 * asked as well: `plugin` is a directory this host copied for a client, and no
 * backend has heard of it; `server` is a server of one, and the agent names it
 * the same way; `backend` is a customization the backend reported itself.
 *
 * `own` is the decision this session made for itself, which is the most
 * specific one there is and the one a decision about a folder or about every
 * session cannot move. For a customization the backend reported it is the
 * decision the backend took, which this host keeps by id: the backend answered
 * a switch and then goes on reporting what it reports, so a decision read only
 * off that report is one that moves back on the next one.
 */
export interface Carried {
  readonly key: string;
  readonly of: 'plugin' | 'server' | 'backend';
  readonly own?: boolean;
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
  /**
   * The session's own decision about this plugin, and nothing else.
   *
   * A decision about a folder or about every session is not this session's,
   * and is not kept here: it is in the store, which is the one place it
   * outlives the session in and the only place a later toggle can move it.
   * What stands here is the one decision the session holds for itself, and it
   * is written only when it differs from what the session would inherit.
   */
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
  /** The connectors a session may use, by alias, read live. */
  sessionBindings(uri: string): Record<string, string>;
  /** One tool's definition for a session, after the strategy's shaping. */
  shapedDefinition(one: HostTool, uri: string): ToolDefinition | undefined;
  /** The definitions alone for one session, which is the half that goes on the wire. */
  toolDefinitions(uri: string): ToolDefinition[];
  /** Say a session's server tools where its list moved. */
  serverToolsMoved(uri: string): void;
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
   * The decisions given are the whole of what this host then holds for the
   * session: a scope the array leaves out is cleared, so a caller that means to
   * keep a decision has to send it. What a client published stays where it is,
   * under the host's own answer.
   *
   * Answers nothing when the id named neither, which is what tells the caller
   * the switch is the backend's to throw rather than this host's.
   */
  toggleClientPlugin(uri: string, id: string, enablement: Bag[]): Toggled | undefined;
  /**
   * What a session carries under the id a toggle names.
   *
   * Answered for a plugin this host holds for the session and for one of its
   * servers, and for anything the backend reported - which is where most ids
   * come from in the first place. Nothing where the session carries no such id,
   * and nothing for a customization VS Code's host keeps no decision for: a
   * skill, a command, an agent and a rule are told by the plugin or the
   * directory they arrived in.
   */
  customizationUnder(uri: string, id: string): Carried | undefined;
  /**
   * The folder a session's decisions for a customization are kept under.
   *
   * Its first working directory as a `file://` URI, which is what a scope
   * outside the session names: the same folder in two sessions is one decision,
   * and a window that keeps a folder open reads it back under the same spelling.
   * Nothing for a session that works nowhere, which has no folder scope at all.
   */
  folderOf(uri: string): string | undefined;
  /**
   * One customization as a session reads it, with its decisions on it.
   *
   * A customization the backend reported comes with the entries this host's
   * store holds for the session's folder and for every session, which is the
   * half that outlives the session: what a backend loaded and what a client
   * decided are the backend's and the client's to say, and the scopes outside
   * one session are this host's.
   */
  withEntries(uri: string, one: Bag): Bag;
  /**
   * Tell a session's backend which of the customizations it reports are off.
   *
   * Said once for each time a chat starts, so a backend that found a
   * customization for itself stops running it: what this host keeps out of the
   * set a backend starts with, it cannot keep out of what the backend found on
   * its own. Called where a backend says what it has, which is the first
   * moment either of them knows.
   */
  tellOff(uri: string, reported: Bag[]): void;
  /** Forget what a session's backends were told, called where a chat starts. */
  forgetTold(uri: string): void;
  /**
   * Keep what a session decided for itself about one of its backend's
   * customizations: the session entry a client's switch carried, or none,
   * which clears it.
   *
   * The backend goes on reporting what it reports, so this is what a session's
   * list reads its own decision from until the next report says otherwise.
   */
  keepDecision(uri: string, id: string, enabled: boolean | undefined): void;
  /**
   * Say a session's customizations again where resolving them moved them, as
   * VS Code republishes them after an enablement changes.
   */
  publishSessionCustomizations(uri: string): void;
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
  /** Give a chat a title, its held state and its row together, and say so. */
  renameChat(uri: string, chatUri: string, title: string): void;
  /**
   * Give a session a title from its own channel, and its sole chat with it, and
   * say so, unless a client's rename on that channel was `said` already.
   */
  renameSession(uri: string, title: string, said?: boolean): void;
  /**
   * Keep the session's title as its default chat's own where the chat holds
   * none, as the session gains another chat.
   */
  snapshotDefaultChatTitle(uri: string): void;
  /** What a host tool sees of this host, from inside one chat. */
  toolContext(uri: string, chatUri: string, provider?: string): ToolCall;
  /**
   * What a host tool sees of this host with no session behind the call.
   *
   * The same host, with the two facts about where the call ran left absent and
   * the caller as the person it acts for. A tool that needs a session throws.
   */
  sessionlessContext(caller: ToolCaller): SessionlessToolCall;
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
  /**
   * The tools a person may call with no session behind the call, bound for them.
   *
   * The sessionless half of `boundTools`: the tools that say `sessionless: true`
   * and whose grant the caller holds, in the order this host contributes them,
   * with the caller as the person each one acts for.
   */
  sessionlessTools(caller: ToolCaller): BoundTool[];
  /**
   * What the model is told when a chat of this session begins.
   *
   * The host's tools' own wording, in the order the tools are offered, and
   * then the bodies of the session's client rules that always apply.
   */
  instructions(uri: string): string[];
  /**
   * What one turn of a session is given, for the backend to read when it begins.
   *
   * Empty for every session this host began itself, and for one another window
   * sent here whose clients offer nothing to report back with.
   */
  turnInstructions(uri: string): TurnOptions;
  /**
   * A second chat in a running session, on the backend it is asked for.
   *
   * The one road `ToolCall.createChat` and a plugin's `startChat` both take.
   * `provider` names the backend that serves the chat, or the session's own
   * where absent; `config` is checked against that backend's schema, and the
   * session's keys no backend owns are added from the session. `calling` is
   * the turn a tool call is made from, where there is one: the chat is counted
   * against that session's tree, as a tool's chat always has been.
   */
  openChat(session: string, asked: ChatStart, calling?: { uri: string; chatUri: string }): Promise<{ chat: string }>;
}

/**
 * What one second chat is asked for, whichever seam asks for it.
 *
 * `ToolCall.createChat` and a plugin's `startChat` reach the same road, and
 * what they differ in is only whether a turn is behind the call: a tool sends
 * the calling turn's `from`, and a plugin has none.
 */
interface ChatStart {
  title?: string;
  model?: string;
  provider?: string;
  config?: Record<string, unknown>;
  prompt?: string;
  from?: Bag;
}

export function createTooling(ctx: HostContext): Tooling {
  const {
    options, sessions, byChat, kept, terminals, learned, rootConfig, sentBy, about,
    activeClientsOf, leadOf, clientResources, allRows, setArtifacts, forWhom,
    principalFor, senderOf, senders,
    chatSummary, persistChatTitle, markSummaryDirty, operationsMoved, dispatch, log, fire,
    resolveCreatedSessionConfig, openSession, backendsOwn, removeSession, spawn,
  } = ctx;
  /**
   * Where a decision that outlives one session is kept, or nothing for a host
   * that keeps none: one embedded in a single session has nowhere to put a
   * decision about every session, and is left with the session's own.
   */
  const store = options.enablement;

  /**
   * What one session decided about one customization of its backend, by id.
   *
   * The store is where a decision about a folder or about every session goes,
   * and this is where a session's own goes - the one scope the store cannot
   * hold, because it is about the session it was made in. Keyed by the session
   * and not by its chats, because that is what the decision is about: `heldAs`
   * is what turns a chat channel into the session it is one of.
   *
   * The switch is taken off the backend's answer and kept here because the
   * backend's next report does not carry it: a customization a backend
   * switched is one it goes on reporting as it found it, and a session that
   * read the decision off that report would draw the switch back on.
   */
  const decided = new Map<string, Map<string, boolean>>();

  /**
   * The tools a session is offered, with the permission applied once.
   *
   * A tool that says it needs advanced permission is left out unless the host
   * permits it, so it is neither reported in `serverTools` nor bound for a
   * call. Applied
   * where the set is built, so `setTools` cannot put one back.
   */
  const permitted = (tools: readonly HostTool[]): HostTool[] =>
    tools.filter((one) => ctx.advancedTools === true || one.advancedPermission !== true);
  /**
   * Whether the advanced tools are offered, held here rather than read off
   * `options` because the daemon's `advancedTools` key is this host's option as
   * much as the daemon's, and a write of it takes hold while the daemon runs.
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
   * Whether the session tools are offered at all, and to whom, held here for
   * the same reason as `advancedTools`: the daemon's two keys are this host's
   * options as much as the daemon's, and a write of either takes hold while the
   * daemon runs.
   */
  ctx.sessionTools = options.sessionTools ?? true;
  ctx.sessionToolsProviders = options.sessionToolsProviders ?? [];
  /**
   * Whether the session tools are offered to one session.
   *
   * `sessionTools` false offers them to no session. `sessionToolsProviders`
   * empty offers them to every session, and a list to the sessions of the
   * providers it names alone - so it narrows the switch rather than replacing
   * it, and a session whose provider is not known here, a row this host is only
   * browsing, is one a list does not name: what the list names is a provider,
   * and there is none to match.
   */
  const sessionToolsFor = (uri: string, provider?: string): boolean => {
    if (ctx.sessionTools !== true) return false;
    if (ctx.sessionToolsProviders.length === 0) return true;
    const named = providerOf(uri, provider).provider;
    return named !== undefined && ctx.sessionToolsProviders.includes(named);
  };
  /**
   * The opt-in tool names one session's request asked for.
   *
   * Kept with the session rather than read off the request again, so a restart
   * offers the same tools: a session opened again is opened from what was
   * written down, and what was written down is this.
   */
  const namedBy = (uri: string): string[] => kept.tools?.(idOf(uri)) ?? [];
  /**
   * The host's tools for one session, less those it did not ask for.
   *
   * Where `permitted` decides once and for every session, `optIn` is asked of
   * each session by name: the tools offered are the contributing ones less
   * every opt-in tool this session's request did not name. It is applied both
   * to the definitions that go on the wire and to the tools a backend binds,
   * so a session offered none is neither told of them nor handed them, and its
   * instructions - read off the same list - say nothing about them either.
   *
   * Less the session tools, too, where its provider is not offered them.
   */
  const contributingTo = (uri: string, provider?: string): HostTool[] => {
    const named = namedBy(uri);
    return ctx.contributing.filter((one) =>
      (one.optIn !== true || named.includes(one.definition.name))
      && (sessionToolsFor(uri, provider) || !SESSION_TOOL_NAMES.includes(one.definition.name)));
  };
  /**
   * The title strategy every session runs under, which is the deferred one: a
   * chat is named from its first message, and the rename tool is offered for
   * an explicit rename. A session this host is only browsing answers the same.
   */
  const strategyOf = (_uri: string): TitleStrategy => 'deferred';
  /**
   * The connectors this session may use, by alias.
   *
   * Each plugin's reader first, in fold order, and the session's own
   * `connectors` key over them: a key the session was started with is the most
   * specific thing said about it, so it wins a shared alias. Read live rather
   * than kept, which is what makes a bot's edit reach a session it already
   * started.
   */
  const sessionBindings = (uri: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const served of options.bindings ?? []) {
      const read = served.read(uri);
      if (read === undefined) continue;
      for (const [alias, value] of Object.entries(read)) {
        if (!(alias in out)) out[alias] = value;
      }
    }
    /*
     * The decided config is the fallback because a session that has not
     * spawned yet is not in the store: `createSession` settles its config
     * here first and the store is written only once the backend took it, so
     * at the first tool list - the one the backend is started with - the
     * bindings are only in the map. Same reading as `linkedOf` makes of the
     * folders a session links.
     */
    const held = kept.config(idOf(uri))?.[BINDINGS_KEY] ?? ctx.decided.get(uri)?.[BINDINGS_KEY];
    if (typeof held === 'object' && held !== null && !Array.isArray(held)) {
      for (const [alias, value] of Object.entries(held)) {
        if (typeof value === 'string') out[alias] = value;
      }
    }
    return out;
  };
  /*
   * The action tools: one for each `action` capability of an adapter that can
   * run one, built once because the adapters do not change while the host
   * runs. Beside `contributed` rather than inside it, so `setTools` keeps them
   * whatever a client sets.
   *
   * A host with no `connectors` port has nothing to run an action on, so it
   * offers none - and a session that binds one sees no tool for it.
   */
  ctx.actionTools = options.connectors === undefined
    ? []
    : actionTools(options.adapters ?? {}, options.connectors.run, {
      bindings: sessionBindings,
      // The store owns a session's folder, and the folder is what an action
      // reads a file from and writes one to.
      attachmentsDir: (uri) => kept.attachmentsDir?.(idOf(uri)),
      principalOf: (uri) => {
        const owner = kept.owner(idOf(uri));
        const person = principalFor(owner);
        // A person not met since the start has no grants to read, and a call
        // that ran as the daemon would pass every connector's check.
        return person === undefined && owner?.startsWith('user:') === true ? 'nobody' : person;
      },
      onProblem: (message) => log(message),
    });
  ctx.contributing = permitted([...ctx.contributed, ...ctx.actionTools]);
  /** What one session brings to a tool asking about it. */
  const toolSession = (uri: string): ToolSession => ({
    titleStrategy: strategyOf(uri),
    config: kept.config(idOf(uri)),
    bindings: sessionBindings(uri),
  });
  /**
   * One tool's definition for a session, shaped for it, or nothing where the
   * session does not support the tool: VS Code's host offers a tool to a
   * session its `isEnabledForSession` allows, and tailors it with
   * `getDefinitionForSession`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/agentServerToolHost.ts#L213-L216
   */
  const shapedDefinition = (one: HostTool, uri: string): ToolDefinition | undefined => {
    const session = toolSession(uri);
    if (one.isEnabledForSession?.(session) === false) return undefined;
    const asked = one.forSession?.(session);
    return asked?.definition === undefined ? one.definition : { ...one.definition, ...asked.definition };
  };
  /**
   * The definitions alone for one session, which is the half that goes on the
   * wire - the session tools among them only where this session is offered
   * them, so what a client reports and what a backend binds say the same thing.
   */
  const toolDefinitions = (uri: string): ToolDefinition[] => contributingTo(uri).flatMap((one) => {
    const shaped = shapedDefinition(one, uri);
    return shaped === undefined ? [] : [shaped];
  });
  /*
   * A session's server tools, said whole and only where the list moved, as
   * VS Code's host compares a session's tools with the ones its state holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/agentServerToolHost.ts#L232-L247
   */
  const serverToolsMoved = (uri: string): void => {
    const tools = toolDefinitions(uri);
    if (isDeepStrictEqual(tools, ctx.stateOf(uri)?.serverTools ?? [])) return;
    dispatch(uri, { type: 'session/serverToolsChanged', tools });
  };
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
   * The key one held customization's global and folder decisions are kept under.
   *
   * A plugin is keyed by the URI it was announced at and a server of one by
   * that plugin with the server's name after it, which is the key VS Code's
   * host derives - so a decision made there and one made here name the same
   * customization. Nothing for anything else, which is what leaves a skill, an
   * agent and a rule without a switch of their own.
   */
  const keyOf = (one: HeldPlugin, at: number): string | undefined => {
    const source = str(one.announced.uri) ?? '';
    if (at === -1) return enablementKeyOf({ type: 'plugin', uri: source });
    return enablementKeyOf({ type: 'mcpServer', name: str(bag((one.parts ?? [])[at]).name) ?? '' }, source);
  };

  /**
   * The first folder a session works in, which is the folder its decisions are
   * kept under.
   *
   * Reached through `heldAs`, because a session's customizations are read under
   * its chats as well as under the session itself and a chat channel names no
   * folder of its own.
   *
   * The lead chat's answer first, because a chat knows its own folders, and the
   * session's own when there is no lead chat to ask - which is the whole of a
   * restart: a chat is torn down and built again, and the plugins a session's
   * clients hold are read in exactly that moment, when the backend is handed
   * the set it starts with.
   */
  const folderOf = (uri: string): string | undefined => {
    const held = sessions.get(uri);
    if (held === undefined) return undefined;
    const lead = leadOf(held)?.workingDirectories()[0];
    if (lead !== undefined) return lead;
    return held.workingDirectory === undefined ? undefined : uriOf(held.workingDirectory);
  };

  /**
   * The decisions one customization carries in one session, most specific first.
   *
   * The session's own decision comes first because it is about this session,
   * then what the store holds for the session's folder, and the one for every
   * session last - which is the order the protocol asks for, Session before
   * Workspace before Global, and the first entry is the one that decides.
   *
   * The store's answer replaces the entries carried for the scope it decides,
   * because the store is the half that outlives a session; a scope it holds
   * nothing for stays as it arrived. That is what leaves a client's global
   * entry standing where the store has none, which is how a client-bundled
   * plugin carries the default it came with.
   */
  const entriesFor = (uri: string, key: string | undefined, carried: Bag[], own: boolean | undefined): Bag[] => {
    const out: Bag[] = own === undefined ? [] : [{ kind: 'session', enabled: own }];
    const rest = carried.filter((entry) => str(entry.kind) !== 'session');
    if (store === undefined || key === undefined) {
      out.push(...rest);
      return out;
    }
    const dir = folderOf(uri);
    const inFolder = dir === undefined ? undefined : store.folder(dir, key);
    if (dir !== undefined && inFolder !== undefined) out.push({ kind: 'workspace', uri: dir, enabled: inFolder });
    else out.push(...rest.filter((entry) => str(entry.kind) === 'workspace'));
    const everywhere = store.global(key);
    if (everywhere !== undefined) out.push({ kind: 'global', enabled: everywhere });
    else out.push(...rest.filter((entry) => str(entry.kind) === 'global'));
    return out;
  };

  /**
   * One customization as a client reads it, with this host's entries on it.
   *
   * A backend reports what it loaded and this host is what decides the scopes
   * outside a session, so the folder and global entries a client reads are the
   * store's. Recursive, because a customization's children are keyed under the
   * one that declared them and a child carries decisions of its own.
   *
   * A customization this host keeps no decision for - a skill, a command, an
   * agent and a rule - is answered as it arrived, which is the same shape a
   * host with no store gives everything.
   */
  const withEntries = (uri: string, one: Bag, owner?: string): Bag => {
    const carried = enablementOf(one.enablement);
    const key = enablementKeyOf(one, owner);
    const own = ownIn(carried) ?? decisionOf(uri, str(one.id) ?? '');
    const entries = key === undefined ? undefined : entriesFor(uri, key, carried, own);
    const children = Array.isArray(one.children)
      ? one.children.map((child) => withEntries(uri, bag(child), str(one.uri)))
      : undefined;
    return {
      ...one,
      ...(entries === undefined || entries.length === 0 ? {} : { enablement: entries }),
      ...(children === undefined ? {} : { children }),
    };
  };

  /**
   * The customizations one chat's backend has already been told about.
   *
   * A backend is told a switch once for each time it starts: the same answer
   * said again on every report is a round-trip that changes nothing, and a
   * backend that answers a switch by reporting its customizations again would
   * be told, and report, without end. `forgetTold` is called where a chat is
   * started, so the backend that takes its place is told afresh.
   */
  const told = new Map<string, Set<string>>();

  /**
   * Tell a chat's backend which of the customizations it reports are off.
   *
   * A backend that found a customization for itself - one of the CLI's own
   * plugins, a server from its own configuration - is running it, and this
   * host has nowhere to keep it out of the set the backend starts with. The
   * switch is how it is told, and it is told once per start: what the store
   * says now, on the report that says what the backend has.
   *
   * Only the store's own decision counts here. A customization a client
   * switched off is the session's own, which the backend published and keeps;
   * saying it back would be this host answering itself.
   */
  const tellOff = (uri: string, reported: Bag[]): void => {
    if (store === undefined) return;
    const held = sessions.get(uri);
    const lead = held === undefined ? undefined : leadOf(held);
    if (lead === undefined) return;
    const said = told.get(uri) ?? new Set<string>();
    told.set(uri, said);
    /** Say every customization in a reported list, and in what each of them holds. */
    const walk = (list: Bag[], owner?: string): void => {
      for (const one of list.map(bag)) {
        const id = str(one.id) ?? '';
        const key = enablementKeyOf(one, owner);
        const off = key !== undefined && entriesFor(uri, key, [], undefined)[0]?.enabled === false;
        if (id !== '' && off && !said.has(id)) {
          said.add(id);
          void lead.setCustomizationEnabled(id, false).catch(() => {});
        }
        // The owner of a child is the customization that declared it, written
        // the same way here as where a toggle looks an id up.
        walk(Array.isArray(one.children) ? one.children.map(bag) : [], str(one.uri));
      }
    };
    walk(reported);
  };

  /** Forget what a session's backends were told, called where a chat starts. */
  const forgetTold = (uri: string): void => { told.delete(uri); };

  /** What a plugin carries as its decisions for a session, most specific first. */
  const decisionsOf = (uri: string, one: HeldPlugin): Bag[] =>
    entriesFor(uri, keyOf(one, -1), enablementOf(one.announced.enablement), ownIn(one.decision));

  /** The same for one of a plugin's servers, which a client may also have decided about. */
  const partDecisions = (uri: string, one: HeldPlugin, at: number): Bag[] => {
    const carried = enablementOf(bag((one.parts ?? [])[at]).enablement);
    return entriesFor(uri, keyOf(one, at), carried, ownIn(carried));
  };

  /** Whether a plugin is on: the most specific decision wins, and no decision at all is on. */
  const enabledOf = (uri: string, one: HeldPlugin): boolean => decisionsOf(uri, one)[0]?.enabled !== false;

  /** Whether a server of one is switched off: the most specific decision wins, and none is on. */
  const partOff = (uri: string, one: HeldPlugin, at: number): boolean =>
    partDecisions(uri, one, at)[0]?.enabled === false;

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

  /** The decision a session made for itself, which is the one entry at its own scope. */
  const ownIn = (decisions: Bag[] | undefined): boolean | undefined => {
    const one = (decisions ?? []).map(bag).find((entry) => str(entry.kind) === 'session');
    return one === undefined ? undefined : one.enabled !== false;
  };

  /** Most specific first, which is the order every reader of a decision list takes. */
  const byScope = (decisions: Bag[]): Bag[] => [...decisions].sort((a, b) => specificityOf(a) - specificityOf(b));

  /** What a session decided about one customization for itself, if it decided. */
  const decisionOf = (uri: string, id: string): boolean | undefined => decided.get(uri)?.get(id);

  /**
   * Keep a session's own decision about one customization, or clear it.
   *
   * The backend has no entry to read a session's decision off, and what it
   * keeps is its own to report.
   */
  const keepDecision = (uri: string, id: string, enabled: boolean | undefined): void => {
    const held = decided.get(uri) ?? new Map<string, boolean>();
    decided.set(uri, held);
    if (enabled === undefined) held.delete(id);
    else held.set(id, enabled);
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
   *
   * The decisions come from the session the entry is for, because where a
   * customization is switched off is a question about one session: the same
   * plugin in two folders is off in one of them.
   */
  const entryOf = (session: string, clientId: string, one: HeldPlugin): Bag => {
    const uri = str(one.announced.uri) ?? '';
    const decisions = decisionsOf(session, one);
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
    return [...held].flatMap(([clientId, list]) => list.map((one) => frozenCopy(entryOf(uri, clientId, one))));
  };

  /**
   * What a session's clients hold under one id: the plugin, or one of its servers.
   *
   * By whatever names it - the id it is published under, the id the client
   * minted, or the URI it was announced at - and `at` is the index of the part
   * the id named, or `-1` for the plugin itself.
   */
  const heldBy = (uri: string, id: string): { clientId: string; one: HeldPlugin; at: number } | undefined => {
    if (id === '') return undefined;
    for (const [clientId, list] of plugins.get(idOf(uri)) ?? []) {
      for (const one of list) {
        if (id === idOfPlugin(clientId, one) || id === str(one.announced.id) || id === str(one.announced.uri)) {
          return { clientId, one, at: -1 };
        }
        const at = (one.parts ?? []).findIndex((part) => part.type === 'mcpServer' && str(part.id) === id);
        if (at !== -1) return { clientId, one, at };
      }
    }
    return undefined;
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
   *
   * What the caller gives replaces what this host held, so a decision about a
   * folder or about every session is written at the scope it was made at and
   * never as this session's own - which is what keeps it a decision the next
   * change to the store can still move.
   */
  const toggleClientPlugin = (uri: string, id: string, enablement: Bag[]): Toggled | undefined => {
    const found = heldBy(uri, id);
    if (found === undefined) return undefined;
    const { one, at } = found;
    const decisions = byScope(enablementOf(enablement));
    /*
     * The session's own decision is the caller's session entry as it was sent,
     * as the reference host records a client's enablement whole. A host with
     * no store has nowhere to keep a decision about a folder or about every
     * session, so there the most specific entry stands for the session.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2120-L2125
     */
    const own = ownIn(decisions) ?? (store === undefined ? decisions[0]?.enabled !== false : undefined);
    const asked: Bag[] = own === undefined ? [] : [{ kind: 'session', enabled: own }];
    let part: Bag | undefined;
    if (at === -1) {
      one.decision = asked;
    }
    else {
      part = bag((one.parts ?? [])[at]);
      /*
       * The client's own decisions for this server, read again from what it
       * announced rather than from the list as it stands: what this host wrote
       * here on an earlier switch is not the client's to carry forward.
       */
      const fromClient = enablementOf(bag(one.announced.childEnablement)[str(part.name) ?? ''])
        .filter((entry) => str(entry.kind) !== 'session');
      one.parts = (one.parts ?? []).map((other, position) => (position === at
        ? { ...other, enablement: byScope([...asked, ...fromClient]) }
        : other));
    }
    return part === undefined ? {} : { server: str(part.name) ?? '' };
  };

  /*
   * A session's customizations said again where resolving them moved them, as
   * the reference host republishes a session's after an enablement changes:
   * only a session whose state holds a list, and nothing when the list
   * resolved is the one its state holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L376-L385
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L609-L647
   */
  const publishSessionCustomizations = (uri: string): void => {
    const current = ctx.stateOf(uri)?.customizations;
    if (current === undefined) return;
    const reported = reportedBy(uri);
    const resolved = [...reported.map((one) => withEntries(uri, bag(one))), ...clientPluginsOf(uri)];
    if (isDeepStrictEqual(current, resolved)) return;
    dispatch(uri, { type: 'session/customizationsChanged', customizations: reported });
  };

  /**
   * What a session carries under one id, as a toggle names it.
   *
   * The host's half first, because a plugin a client handed the session is
   * where a toggle usually lands, and the backend's after it - which is where
   * the ids of everything a backend reports come from. A child of a reported
   * customization is looked for under the one it was declared in, so a server
   * of a plugin the backend knows is keyed by that plugin.
   */
  const customizationUnder = (uri: string, id: string): Carried | undefined => {
    const found = heldBy(uri, id);
    if (found !== undefined) {
      const { one, at } = found;
      const key = keyOf(one, at);
      if (key === undefined) return undefined;
      const own = at === -1 ? ownIn(one.decision) : ownIn(bag((one.parts ?? [])[at]).enablement as Bag[] | undefined);
      return { key, of: at === -1 ? 'plugin' : 'server', ...(own === undefined ? {} : { own }) };
    }
    /** The reported customization with this id, looked for under the one that declared it. */
    const reported = (list: Bag[], owner?: string): Carried | undefined => {
      for (const one of list.map(bag)) {
        if (str(one.id) === id) {
          const key = enablementKeyOf(one, owner);
          if (key === undefined) return undefined;
          const own = decisionOf(uri, id);
          return { key, of: 'backend', ...(own === undefined ? {} : { own }) };
        }
        const children = Array.isArray(one.children) ? one.children.map(bag) : [];
        const below = reported(children, str(one.uri));
        if (below !== undefined) return below;
      }
      return undefined;
    };
    return reported(reportedBy(uri));
  };

  /**
   * What a session's backend reports as its customizations.
   *
   * The half a client plugin list is laid over. Read from the lead chat, or
   * from what the backend said it offers when nothing is running - the same
   * answer its snapshot gives, so a `customizationsChanged` and a snapshot of
   * the same session say the same thing.
   */
  const reportedBy = (name: string): Bag[] => {
    const held = sessions.get(name);
    const lead = held === undefined ? undefined : leadOf(held);
    if (lead !== undefined) return lead.customizations();
    // Nothing runs, so the answer is what the backend said it offers. The
    // provider is the one the session's row kept, never the scheme of its URI:
    // a new session is `ahp-session:/<id>` and its scheme says nothing about
    // whose it is. A session no row claims belongs to no backend here, and
    // reports nothing.
    const provider = kept.provider(idOf(name)) ?? held?.agent.provider;
    return provider === undefined ? [] : about(provider).seeds as Bag[];
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
   * As the reference host's plugin controller says a client's plugins: the
   * session's list whole first, each new plugin in it `loading`, and then each
   * plugin on its own as its copy settles. The list goes out before the copies
   * are made: a copy is a client's whole plugin tree read over its
   * connection, and a session whose list waited for it would show nothing at
   * all for as long as that took - while `loading` is exactly what the field
   * is for.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L11243-L11330
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
    dispatch(uri, { type: 'session/customizationsChanged', customizations: reportedBy(uri) });

    /** One plugin whose copy settled, said on its own. */
    const settle = (clientId: string, one: HeldPlugin): void => {
      dispatch(uri, { type: 'session/customizationUpdated', customization: entryOf(uri, clientId, one) });
    };
    const port = options.clientPlugins;
    for (const [clientId, list] of added) {
      if (port === undefined) {
        // A host with nowhere to put a copy is a host that keeps none, and each
        // plugin is owed the reason rather than a promise that never settles.
        for (const one of list) {
          one.load = { kind: 'error', message: KEEPS_NONE };
          settle(clientId, one);
        }
        continue;
      }
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
        settle(clientId, one);
      });
    }
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
    .filter((one) => one.path !== undefined && one.load.kind === 'loaded' && enabledOf(uri, one));

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
    (one.parts ?? []).flatMap((part, at) => (part.type === 'mcpServer' && partOff(uri, one, at)
      ? [str(part.name) ?? '']
      : [])));

  /**
   * When each session tree made each of the three, inside the window, by the
   * id of the session at its top.
   *
   * Kept per tree: one tree is a session somebody started and everything the
   * `create` tool grew from it, so a runaway agent exhausts its own budget and
   * not the host's, and a second tree is made from nothing. A time older than
   * the window is dropped as the tree is next asked about, so a tree that hit
   * a limit recovers, as VS Code's limiter frees room. In memory, as VS Code's
   * are.
   */
  const counted = new Map<string, Record<Made, number[]>>();

  /**
   * The session at the top of one session's tree, which is the id its counts
   * are kept under.
   *
   * A store that keeps no parent links holds no tree, and every session in it
   * is a root of its own - which is what the store that does keep them answers
   * for a session nothing started.
   */
  const treeOf = (id: string): string => kept.rootOf?.(id) ?? id;

  /** A tree's times for one of the three that are still inside the window. */
  const recentIn = (tree: string, what: Made): number[] => {
    const cutoff = Date.now() - LIMIT_WINDOW_MS;
    return (counted.get(tree)?.[what] ?? []).filter((time) => time > cutoff);
  };

  /**
   * Whether the limits are enforced: VS Code's `agentOrchestrationLimits`, the
   * root key this host declares, `on` unless a client turned it `off`. It
   * covers the spawn depth as well as the three counts.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2306
   */
  const enforced = (): boolean => ctx.rootConfig.agentOrchestrationLimits !== 'off';

  /**
   * Refuse one more of something a tree has no room for, in VS Code's words
   * with the tree where VS Code names the session.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L86-L94
   */
  const room = (tree: string, what: Made): void => {
    if (!enforced()) return;
    const limit = TREE_LIMITS[what];
    const recent = recentIn(tree, what);
    if (recent.length < limit.max) return;
    const retryAfterSeconds = Math.max(1, Math.ceil(((recent[0] ?? Date.now()) + LIMIT_WINDOW_MS - Date.now()) / 1000));
    throw new Error(`Refusing to ${limit.action}: this session tree already used ${recent.length} of ${limit.max}`
      + ` allowed in the last ${Math.round(LIMIT_WINDOW_MS / 60000)} minutes. The limit applies to each session tree`
      + ' separately and frees up as older actions leave that window.'
      + ` Retry after ${retryAfterSeconds} seconds, or turn off agent orchestration limits in settings.`);
  };

  /** One more, counted once the thing it counts has actually been made. */
  const countUp = (tree: string, what: Made): void => {
    const held = counted.get(tree) ?? { sessions: [], chats: [], messages: [] };
    counted.set(tree, { ...held, [what]: [...recentIn(tree, what), Date.now()] });
  };

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
   * tools to both. An answer of false, or a throw, is logged with the session's
   * URI: a chat that did not take the new set goes on offering the old one, and
   * nothing else says so - what the client announced is already on the session
   * state, and the agent is told nothing either way. A session whose backend
   * has no `setTools` at all answers nothing and is left alone.
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
      void Promise.resolve(chat.setTools?.(boundTools(uri, chatUri)))
        .then((took) => {
          if (took === false) console.warn(`@ahpd/sdk: ${uri} did not take its tools; a chat of it still offers what it did`);
        })
        .catch((error: unknown) => {
          console.warn(`@ahpd/sdk: ${uri} could not be retooled: ${(error as Error).message}`);
        });
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
   * A chat's held state given a title, and its row in the session said with
   * it, as the reference host's `updateChatTitle` does: no chat action carries
   * a title, so the held state is set here, and every row read off it after
   * says the same.
   * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2316-L2331
   */
  const updateChatTitle = (uri: string, chatUri: string, title: string): void => {
    const open = ctx.heldStates.get(chatUri);
    if (open !== undefined) open.state = { ...open.state, title };
    dispatch(uri, { type: 'session/chatUpdated', chat: chatUri, changes: { title } });
  };
  /**
   * Give a chat a title, and say so.
   *
   * The chat's held state and its row take the title together, as the
   * reference host renames a chat. The default chat's title is its session's
   * too, said as `session/titleChanged` after the row. A client renaming a chat
   * on its own channel and an agent calling `rename_chat` come to the same
   * place.
   * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L58-L71
   */
  const renameChat = (uri: string, chatUri: string, title: string): void => {
    const held = sessions.get(uri);
    const found = held?.chats.get(chatUri);
    if (held === undefined || found === undefined) throw new Error(`${chatUri} is not a chat this host is running`);
    found.setTitle?.(title);
    // Written down here rather than at either caller, because a client's
    // `session/titleChanged` and the `rename_chat` tool both come through.
    persistChatTitle(uri, chatUri, title);
    updateChatTitle(uri, chatUri, title);
    if (chatUri === held.defaultChat) {
      ctx.persistSessionTitle(uri, title);
      dispatch(uri, { type: 'session/titleChanged', title });
    }
    markSummaryDirty(uri);
    // The session's title is the subject a commit would use, so the question
    // the changeset's commit asks names a different line now.
    operationsMoved(uri);
  };
  /**
   * Give a session a title from its own channel, and say so.
   *
   * The session's backend is handed it through the default chat, the store
   * keeps it as the session's, and it goes out as `session/titleChanged` on
   * the session. A session that counts one chat or none in its
   * `readAggregate` has its default chat take it as its own after, in its
   * held state, its row and its record, as the reference host carries a
   * session's rename down onto a sole default chat; with peer chats, the
   * default chat keeps the title it has.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L74-L100
   *
   * `said` when a client's rename on the session's channel was said there
   * already, as its own action.
   */
  const renameSession = (uri: string, title: string, said = false): void => {
    const held = sessions.get(uri);
    const found = held?.chats.get(held.defaultChat);
    if (held === undefined || found === undefined) throw new Error(`${uri} is not a session this host is running`);
    found.setTitle?.(title);
    ctx.persistSessionTitle(uri, title);
    if (!said) dispatch(uri, { type: 'session/titleChanged', title });
    if (readAggregate(ctx, uri).length <= 1) {
      persistChatTitle(uri, held.defaultChat, title);
      updateChatTitle(uri, held.defaultChat, title);
    }
    markSummaryDirty(uri);
    operationsMoved(uri);
  };
  /**
   * The session's title kept as its default chat's own, where the chat holds
   * none, as the session gains another chat: from then on the two are
   * independent, and a rename of the session with peer chats leaves the chat
   * as it is. The reference host snapshots a default chat's title whenever a
   * chat is added to its session, and keeps the snapshot.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1855-L1862
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2161-L2171
   */
  const snapshotDefaultChatTitle = (uri: string): void => {
    const held = sessions.get(uri);
    const lead = held === undefined ? undefined : leadOf(held);
    if (held === undefined || lead === undefined || ctx.titleOf(uri, held.defaultChat) !== undefined) return;
    const title = String(ctx.stateOf(uri)?.title ?? lead.title());
    if (title === '') return;
    persistChatTitle(uri, held.defaultChat, title);
    // The session's own title kept beside it, an empty one where it has none:
    // a record holding one hands its backend that, and the chat's stays the
    // chat's.
    if (kept.customTitle?.(idOf(uri)) === undefined) kept.setCustomTitle?.(idOf(uri), '');
    if (ctx.stateOf(held.defaultChat)?.title !== title) updateChatTitle(uri, held.defaultChat, title);
  };

  /**
   * What a host tool sees of this host, from inside one chat.
   *
   * Every operation here is one a client already has - a command, or an
   * action a client may dispatch - reached from a turn rather than a socket.
   * The catalogue is `allRows()`, which is what `listSessions` answers; a
   * message is a turn this host starts, or a message it queues on the chat,
   * which is what `chat/turnStarted` and `chat/pendingMessageSet` come to; a
   * session is `openSession`, which is what `createSession` comes to. Nothing is reachable from here that is not
   * reachable from a client, and the reverse is nearly true.
   */
  /**
   * The agent a session runs, as `ToolCall.provider`: the one its tools were
   * bound for, else the held session's.
   */
  const providerOf = (uri: string, bound?: string): { provider?: string } => {
    const provider = bound ?? sessions.get(uri)?.agent.provider;
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

  /**
   * Whether a grant is one of the read half of whatever it names.
   *
   * `read` and `write` are the groups and never operations - so a
   * grant is read as its group when it names the group itself, and as the
   * group of the operation when it names one.
   */
  const reads = (grant: Grant): boolean => {
    const at = grant.indexOf(':');
    if (at < 0) return false;
    const operation = grant.slice(at + 1);
    return operation === 'read' || groupOf(grant.slice(0, at), operation) === 'read';
  };

  /**
   * Whose grants a call in one chat runs with: a person, nobody, or nobody to
   * ask.
   *
   * The person is the turn's rather than the session's, because two people can
   * be talking in one session and only the turn says which of them it was.
   *
   * `undefined` is "asked of nobody", and only two things answer that: a host
   * with no users directory, which has nobody to ask and answers as it answered
   * before there was anybody; and a turn this host's own root connection sent,
   * which is refused nothing here, as `admit` refuses the same connection
   * nothing on the wire.
   *
   * `'nobody'` is a call with no person behind it - one in a turn this host
   * began for itself, one a rule nobody owns started, one sent by somebody this
   * process has not met since it started, and one reached with no turn running
   * at all. That last is not a call no backend makes: a window outlives the
   * turn it sent and can still reach a tool after that turn has ended, and a
   * turn is the only thing that carries a person, so none is carried to it.
   * What such a call holds is decided by the caller: it reads, and it writes
   * nothing.
   */
  const personOf = (chatUri: string): Principal | 'nobody' | undefined => {
    if (options.users === undefined) return undefined;
    const turn = activeTurnOf(chatUri);
    if (turn === undefined) return 'nobody';
    const owner = senderOf(turn);
    if (owner === undefined) return 'nobody';
    // A wake a root turn set keeps the owner and not the connection, so the
    // name is what says the host asked for this.
    if (owner.startsWith('root:') || sentBy.get(turn)?.root === true) return undefined;
    return principalFor(owner) ?? 'nobody';
  };

  /**
   * Whether the call in one chat may do `grant` here.
   *
   * A call nobody is behind holds the read half and nothing else: an agent in a
   * turn a host began for itself, one a rule nobody owns started, and one
   * reached with no turn running at all still read the sessions and write none
   * of them. A person this process has not met is answered the same way,
   * because what they hold is not something this host can say - and a grant it
   * cannot answer for is not one it hands out.
   */
  const mayDo = (chatUri: string, grant: Grant): boolean => {
    const person = personOf(chatUri);
    if (person === undefined) return true;
    return person === 'nobody' ? reads(grant) : person.can(grant);
  };

  /**
   * How a call that may not do `grant` is refused.
   *
   * The host's own words - `refusalReason`, the same sentence a client is told
   * on the wire - said about the person the turn belongs to, and about the turn
   * itself where nobody is behind the call, since there is no id to name.
   */
  const refusalOf = (chatUri: string, grant: Grant): string => {
    const person = personOf(chatUri);
    return person === undefined || person === 'nobody'
      ? `this turn may not ${grant} here`
      : refusalReason(person.id, grant);
  };

  /**
   * Who a stamp names for a call in one chat.
   *
   * The turn's sender is the only thing that carries a person, so it answers
   * first, as the person this host knows behind that owner where it knows
   * them. A root turn is the host itself rather than somebody, and so is a
   * call with no turn running: the session's owner answers there, and `host`
   * where the session has no owner either. A name is always answered, because
   * a stamp that says nobody cannot be acted on.
   */
  const personOfCall = (uri: string, chatUri: string): string => {
    const turn = activeTurnOf(chatUri);
    const sender = turn === undefined ? undefined : senderOf(turn);
    if (sender !== undefined) {
      return sender.startsWith('root:') ? 'host' : principalFor(sender)?.id ?? sender;
    }
    const owner = kept.owner(idOf(uri));
    return owner === undefined || owner.startsWith('root:') ? 'host' : owner;
  };

  /**
   * The turn a tool is about to begin, written down as the calling turn's.
   *
   * A tool that begins a turn in another chat begins it for whoever sent the
   * turn it is running in: the person who asked for the work is the person it
   * is done for, and the turns of the session it makes ask that person's
   * grants. The connection rides along where there is one, because a window is
   * what can be asked something back and a person is not.
   *
   * Written before the turn begins and under the id it will carry, because the
   * backend is free to run the whole turn before the call that started it
   * returns - and a tool inside that turn would find nobody had sent it.
   */
  const remember = (chatUri: string, turnId: string): void => {
    const turn = activeTurnOf(chatUri);
    if (turn === undefined) return;
    const owner = senderOf(turn);
    if (owner !== undefined) senders.set(turnId, owner);
    const sender = sentBy.get(turn);
    if (sender !== undefined) sentBy.set(turnId, sender);
  };

  /**
   * The config one chat is started with.
   *
   * A chat of the session's own backend is handed what the session has, less
   * the keys no backend owns, with what it asked for over it - the same thing
   * every other chat of the session was spawned with. A chat of another backend
   * is handed only the session's keys that backend does not own: its `computer`,
   * which places the chat's machine, and the keys a plugin contributed, which
   * every session draws. The session's other settings are its own backend's,
   * and mean nothing to a harness that has never read them.
   */
  const chatConfigOf = (
    agent: Agent, held: Held, asked: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const given = backendsOwn(asked ?? {});
    if (agent === held.agent) return { ...backendsOwn(held.config), ...given };
    const contributed = options.sessionConfig ?? {};
    const shared = Object.fromEntries(Object.entries(held.config)
      .filter(([key]) => key === 'computer' || Object.prototype.hasOwnProperty.call(contributed, key)));
    return { ...shared, ...given };
  };

  /**
   * A value one backend's schema refuses, refused before anything starts.
   *
   * A key the schema does not declare is handed through, because a backend
   * takes some it does not declare - the same reading `storedConfig` gives a
   * key a property no longer names.
   */
  const checkedConfig = (
    agent: Agent, given: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (given === undefined) return undefined;
    const schema = ctx.sessionSchema(agent);
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    for (const [key, value] of Object.entries(given)) {
      if (properties[key] !== undefined && !accepts(properties[key], value)) {
        throw new Error(`${key} ${JSON.stringify(value)} is not a value ${agent.provider} takes`);
      }
    }
    return given;
  };

  /**
   * A second chat in a running session, on the backend it is asked for.
   *
   * The one road a tool call and a plugin's `startChat` take, so a chat a bot
   * opens from a wake is the chat a model opens from a turn: spawned on the
   * session's own backend or on the one named, announced on the session's
   * channel, recorded so a restart starts it there again, and begun with the
   * prompt where there is one.
   *
   * `calling` is the turn a tool call is made from and nothing for a plugin:
   * a tool is counted where it runs, and a plugin has no turn to be charged.
   */
  /**
   * What a chat or session a session tool makes takes from the chat the tool
   * runs in, as VS Code's `getCreationDefaults`: that chat's agent; its model,
   * the running turn's, else its draft's, else its last turn's; and the
   * settings its agent names as inherited from its config.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L2566-L2600
   */
  const creationDefaults = (calling: { uri: string; chatUri: string }): { agent?: Agent; model?: string; config?: Record<string, unknown> } => {
    const held = sessions.get(calling.uri);
    const agent = held?.backends.get(calling.chatUri)?.agent ?? held?.agent;
    const state = (ctx.stateOf(calling.chatUri) ?? {}) as Bag;
    const turns = Array.isArray(state.turns) ? state.turns as Bag[] : [];
    const message = (bag(state.activeTurn)?.message ?? state.draft ?? turns.at(-1)?.message) as Bag | undefined;
    const model = str(bag(message?.model)?.id);
    // The calling chat's own config in force, which its backend answers.
    const values = byChat.get(calling.chatUri)?.chat.settings() ?? {};
    const config = agent?.inheritedChatConfig?.(values);
    return {
      ...(agent === undefined ? {} : { agent }),
      ...(model === undefined ? {} : { model }),
      ...(config === undefined ? {} : { config }),
    };
  };

  const openChat = async (
    at: string, asked: ChatStart, calling?: { uri: string; chatUri: string },
  ): Promise<{ chat: string }> => {
    const held = sessions.get(at);
    if (!held) throw new Error(`${at} is not a session this host is running`);
    /*
     * The tree the call is made from, which is the one it is counted against.
     *
     * A chat has no tree of its own, and the session named need not be the
     * one this tool was called from. A tool is counted where it runs, so a
     * chat added to another session still spends the calling session's
     * budget - the same answer `send` gives, and for the same reason: the
     * session an agent is running in is the one whose spending is bounded.
     */
    const tree = calling === undefined ? undefined : treeOf(idOf(calling.uri));
    if (tree !== undefined) room(tree, 'chats');
    /*
     * Which backend serves it. A name this host does not hold is refused
     * rather than quietly started on the session's own: the plugin asked for
     * a harness, and one it did not get would be a chat it never asked for.
     */
    const agent = asked.provider === undefined ? held.agent : ctx.agents.get(asked.provider);
    if (agent === undefined) throw new Error(noProvider(asked.provider));
    const config = chatConfigOf(agent, held, checkedConfig(agent, asked.config));
    // Asked for no model, a tool's chat runs the calling chat's where the two
    // run one agent, as VS Code's create-chat takes it.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1375-L1378
    const defaults = calling === undefined ? undefined : creationDefaults(calling);
    const model = asked.model ?? (defaults?.agent === agent ? defaults.model : undefined);
    const chatUri = `ahp-chat:/${crypto.randomUUID()}`;
    // What the plugins give a chat a tool opens, ahead of the tool's prompt.
    const preambles = options.chatPreambles ?? [];
    const preamble = preambles.length === 0 ? undefined : await preambleOf(preambles, {
      session: at,
      chat: chatUri,
      chats: [...held.chats].map(([one, chat]) => chatSummary(at, one, chat) as unknown as ChatSummary),
    }, log);
    if (sessions.get(at) !== held) throw new Error(`${at} is not a session this host is running`);
    /*
     * Read until something is said in it, and named, both written before its
     * state opens: `spawn` hands the backend the name it finds kept.
     */
    startsRead(ctx, at, chatUri);
    if (asked.title !== undefined) kept.setChatTitle(idOf(at), chatUri, asked.title);
    const chat = spawn(agent, at, chatUri, chatIdFor(at, chatUri), config, preamble === undefined ? undefined : { context: preamble }, held.workingDirectory, undefined, held.additional);
    log(`opened ${chatUri} in ${at}`);
    if (asked.title !== undefined) persistChatTitle(at, chatUri, asked.title);
    // The default chat takes its own title from here, before the new chat is said.
    snapshotDefaultChatTitle(at);
    dispatch(at, { type: 'session/chatAdded', summary: chatSummary(at, chatUri, chat) });
    // And the row: a client listing sessions reads a session's chats there.
    markSummaryDirty(at);
    if (asked.prompt !== undefined) {
      const firstTurn = crypto.randomUUID();
      // Written down as the calling turn's, so it runs for whoever sent that
      // turn, as VS Code's host runs a delegated prompt with the calling
      // chat's credentials.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1373
      if (calling !== undefined) remember(calling.chatUri, firstTurn);
      void ctx.startTurn(chat, firstTurn, asked.prompt, model === undefined ? undefined : { id: model }, asked.from);
    }
    if (tree !== undefined) countUp(tree, 'chats');
    return { chat: chatUri };
  };

  /**
   * The chats of a running session, in the order a client reads them.
   *
   * The same answer whichever road asks - a tool in a session and a person
   * with no session behind the call - because neither changes what a session
   * holds.
   */
  const chatsOf = (session: string): { resource: string; title: string }[] => {
    const held = sessions.get(session);
    if (!held) return [];
    const rows = [...held.chats].map(([at, chat]) => ({ resource: at, title: chat.title() }));
    // The default first, since that is the one a link without a chat opens.
    rows.sort((a_, b_) => Number(b_.resource === held.defaultChat) - Number(a_.resource === held.defaultChat));
    return rows;
  };

  /** Models any session here can run on, each with the provider it belongs to. */
  const modelsKnown = (): { id: string; name: string; provider: string }[] =>
    [...learned].flatMap(([provider, known]) => known.models.map((model) => ({
      id: model.id, name: model.name, provider,
    })));

  /** Every backend this host offers, whether or not it has named a model yet. */
  const providersKnown = (): string[] => [...ctx.agents.keys()];

  /** A chat's conversation, as its channel snapshot carries it. */
  const contextOf = async (
    session: string, chatId?: string,
  ): Promise<{ turns: Bag[]; activeTurn?: Bag; hasMoreHistory: boolean } | undefined> => {
    const held = sessions.get(session);
    const found = held === undefined ? undefined : chatMeant(held, chatId);
    if (found === undefined) return undefined;
    const state = found.chat.chatState() as { turns?: unknown; activeTurn?: unknown; turnsNextCursor?: unknown };
    /*
     * Frozen copies of the turns, for the same reason a tool definition is
     * one: this leaves the host with whichever host tool asked, and a tool
     * that rewrote a turn would be rewriting the conversation.
     */
    return frozenCopy({
      turns: Array.isArray(state.turns) ? state.turns as Bag[] : [],
      ...(typeof state.activeTurn === 'object' && state.activeTurn !== null ? { activeTurn: state.activeTurn as Bag } : {}),
      hasMoreHistory: state.turnsNextCursor !== undefined,
    });
  };

  const toolContext = (uri: string, chatUri: string, provider?: string): ToolCall => ({
    session: uri,
    chat: chatUri,
    ...providerOf(uri, provider),
    turn: () => activeTurnOf(chatUri),
    person: () => personOfCall(uri, chatUri),
    may: (grant) => mayDo(chatUri, grant),
    refusal: (grant) => refusalOf(chatUri, grant),
    /*
     * The catalogue, cut down to what this call's person may read.
     *
     * A listing is the one answer a tool gives about sessions it is not in, so
     * it is the one place a session's own person is not enough: `list_sessions`
     * answers the rows of whoever asked, and every other tool asks `may` about
     * the grant it needs and is given the answer about one session rather than
     * a list of them. Nothing is cut on a host with no users directory, nor for
     * a call nobody is behind, which reads as it did.
     */
    sessions: async () => {
      const rows = await allRows();
      return mayDo(chatUri, 'session:read') ? rows : [];
    },
    chats: chatsOf,
    models: modelsKnown,
    providers: providersKnown,
    context: contextOf,
    send: async (at, chatId, text, from) => {
      /*
       * The tree the call is made from, which is the one it is counted against.
       *
       * The session the message goes to is not asked. A tool is counted where
       * it runs: the session that asked for the message is the one whose budget
       * an agent is spending, and charging the target instead would let one
       * runaway send a hundred messages into each of any number of sessions
       * without ever meeting a limit.
       */
      const tree = treeOf(idOf(uri));
      room(tree, 'messages');
      // A session asleep in the catalogue is woken for the message, and held
      // awake until it has begun.
      const release = ctx.hold(at);
      try {
        if (!sessions.has(at) && ctx.owners.has(at)) await ctx.wake(at);
        const held = sessions.get(at);
        const found = held === undefined ? undefined : chatMeant(held, chatId);
        if (found === undefined) throw new Error(`${at} is not a session this host is running`);
        const state = (ctx.stateOf(found.chat.chatUri) ?? found.chat.chatState()) as { activeTurn?: unknown; queuedMessages?: unknown; steeringMessage?: unknown };
        const busy = state.activeTurn !== undefined || state.steeringMessage !== undefined
          || (Array.isArray(state.queuedMessages) && state.queuedMessages.length > 0);
        if (busy) {
          // The chat's queued message, sent by whoever sent the calling turn.
          const calling = activeTurnOf(chatUri);
          ctx.enqueue(found.chat.chatUri, crypto.randomUUID(), text, from,
            calling === undefined ? undefined : { owner: senderOf(calling), connection: sentBy.get(calling) });
          countUp(tree, 'messages');
          return 'queued';
        }
        const started = crypto.randomUUID();
        remember(chatUri, started);
        void ctx.startTurn(found.chat, started, text, undefined, from);
        countUp(tree, 'messages');
        return 'sent';
      } finally {
        release();
      }
    },
    create: async (asked) => {
      /*
       * The chain this session is part of, and the tree it grows.
       *
       * The session made here is a child of the calling one, so it is the
       * calling session that is asked both questions: how deep it already sits
       * in its chain, and how much its tree has made.
       */
      const tree = treeOf(idOf(uri));
      room(tree, 'sessions');
      const depth = kept.depthOf?.(idOf(uri)) ?? 0;
      if (enforced() && depth >= MAX_SPAWN_DEPTH) {
        throw new Error(
          `Refusing to create a session: recursion limit reached (max spawn depth ${MAX_SPAWN_DEPTH}).`
          + ` This session was itself created ${depth} level(s) deep.`,
        );
      }
      /*
       * What the calling chat hands it, as VS Code's create-session takes it:
       * that chat's agent where the call names none, and where the new session
       * runs that agent, its model where the call names none and the settings
       * the agent says a new chat inherits.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1208-L1233
       */
      const defaults = creationDefaults({ uri, chatUri });
      const provider = asked.provider ?? defaults.agent?.provider ?? ctx.first?.provider;
      if (provider === undefined) throw new Error(noProvider(provider));
      const agent = ctx.agents.get(provider);
      if (agent === undefined) throw new Error(noProvider(provider));
      const inherits = defaults.agent === agent;
      const model = asked.model ?? (inherits ? defaults.model : undefined);
      /*
       * Named for the client whose turn made it: `<provider>:/<uuid>` when an
       * older VS Code window sent the running turn, so that window sees the
       * session, and `ahp-session:/<uuid>` otherwise, as the reference host
       * mints a session for the client that initiated its creation.
       * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L10074-L10108
       */
      const turn = activeTurnOf(chatUri);
      const older = turn !== undefined && sentBy.get(turn)?.legacySessionUris === true;
      const made = older ? `${provider}:/${crypto.randomUUID()}` : uriFor(crypto.randomUUID());
      /*
       * What the backend is given, checked against its own schema and under
       * the keys this call owns: `isolation` and `model` are the two the call
       * was made with, and a value of the same name inside `config` would be
       * the tool arguing with which session it asked for.
       */
      const config: Record<string, unknown> = {
        ...(inherits ? defaults.config ?? {} : {}),
        ...(checkedConfig(agent, asked.config) ?? {}),
        ...(asked.isolation !== undefined ? { isolation: asked.isolation } : {}),
        ...(model !== undefined ? { model } : {}),
      };
      // The same steps `createSession` takes for a client, in the same order:
      // the host's keys kept apart from the backend's, and a worktree made at
      // the first send.
      const where = asked.workingDirectory;
      await resolveCreatedSessionConfig(made, asked.workingDirectory, config);
      // The owner of the session this one was made inside, which is what a
      // tool acting for somebody means: the work is theirs whichever session
      // it ends up running in. And the session, chat and turn it was made
      // from, which `openSession` writes down beside the record so the summary
      // carries them from its announcement, as the reference host's create
      // carries its creation reference.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1236-L1242
      const madeFrom = { session: uri, chat: chatUri, ...(turn === undefined ? {} : { turnId: turn }) };
      openSession(made, provider, { ...config, _meta: { [CREATED_BY_META]: madeFrom } }, where, undefined, undefined, undefined,
        asked.title, forWhom(kept.owner(idOf(uri))));
      /*
       * The session this one was made inside, kept with its record.
       *
       * In the store rather than in memory, because what the link is for is
       * telling this session when its child ends, and a child can end after a
       * restart. The id is what is kept, so the session is found again under
       * whichever scheme this host is publishing it by then.
       */
      kept.setParent?.(idOf(made), idOf(uri));
      ctx.oweTree(made, {}, undefined, () => ({}));
      const lead = byChat.get(chatUriFor(made));
      if (lead === undefined) throw new Error(`${made} did not start`);
      const firstTurn = crypto.randomUUID();
      remember(chatUri, firstTurn);
      void ctx.startTurn(lead.chat, firstTurn, asked.prompt, model === undefined ? undefined : { id: model }, asked.from);
      countUp(tree, 'sessions');
      return { session: made, chat: chatUriFor(made) };
    },
    createChat: async (session, asked) => await openChat(session, asked, { uri, chatUri }),
    rename: (session, chat, title) => { renameChat(session, chat, title); },
    /*
     * A session deleted from inside another one, by whoever is asking.
     *
     * The tool acts for a person and not for the model: the turn's own sender,
     * which is who asked for this work, and never the connection that started
     * whichever session the name names. A session with no owner on this host
     * has no person behind it either, which is the same "nobody to name" the
     * owner's own reference has and the same answer: nobody is refused. An
     * owner whose principal this process has not met yet goes as the owner.
     */
    remove: async (session) => {
      /*
       * Who is asking: the turn's person where a turn is running, and the
       * session's own owner where none is.
       *
       * The turn says which of the people talking in one session asked, which
       * is what makes a colleague's delete of somebody else's session the same
       * refusal whichever session they asked from. With no turn behind the call
       * the owner's own reference decides, as it did before a turn carried
       * anybody - which a host with a users directory reaches only where the
       * call was let through at all, since `session:write` is asked before this
       * and a call nobody is behind does not hold it.
       */
      const turn = activeTurnOf(chatUri);
      const asking = turn === undefined ? undefined : senderOf(turn);
      const by = asking === undefined ? forWhom(kept.owner(idOf(uri))) : forWhom(asking);
      await removeSession(session, by?.principal ?? by?.owner);
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
    scheduleWake: (delaySeconds, prompt) => {
      const at = (options.now?.() ?? new Date()).getTime() + delaySeconds * 1000;
      /*
       * The person the wake will act as, kept with it.
       *
       * The turn this is set in is over long before the wake fires, and what
       * it carries cannot be looked up afterwards: the connection and the
       * sender are let go of when a turn ends. So the owner is written on the
       * record, where it outlives the session sleeping and the daemon
       * restarting, and the turn the wake begins carries it - a wake nobody
       * set starts a turn with nobody behind it, and that turn writes nothing.
       */
      const turn = activeTurnOf(chatUri);
      const sender = turn === undefined ? undefined : senderOf(turn);
      ctx.setWake(uri, chatUri, { at, prompt, ...(sender === undefined ? {} : { sender }) });
      return new Date(at);
    },
    cancelWake: () => ctx.setWake(uri, chatUri, undefined),
    artifacts: () => [...(kept.artifacts(idOf(uri)) ?? [])],
    setArtifacts: (list) => { setArtifacts(uri, list); },
    terminals: () => [...terminals.values()].map((held) => ({
      uri: held.uri,
      title: held.title(),
      cwd: String((held.state() as Record<string, unknown>).cwd ?? ''),
      running: held.exitCode() === undefined,
    })),
    read: async (asked) => {
      // A client's resource from the client the client scheme names, about
      // the URI as it knows it, as VS Code's host reads one through its client
      // filesystem, and this host's own store otherwise.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13851-L13867
      const answer = schemeOf(asked) === AGENT_CLIENT_SCHEME
        ? await clientResources.read(asked)
        : await need(options.resources, 'resourceRead').read(asked);
      const held = (typeof answer === 'object' && answer !== null ? answer : {}) as {
        data?: unknown; encoding?: unknown;
      };
      const data = String(held.data ?? '');
      return bodyText({ data, encoding: held.encoding === 'base64' ? 'base64' : 'utf-8' });
    },
    // The person is asked in the chat the call came from, and in the turn it
    // is running in, so the end of that turn is what ends the wait.
    ask: (questions) => ctx.asks.ask(chatUri, activeTurnOf(chatUri), questions),
  });

  /**
   * Who a call with no session is made by, as an owner.
   *
   * The owner a session made by them is opened under, and the sender a turn
   * they begin is sent by. A root caller is this host's own connection and owns
   * what it makes under `root:`, the way a session this host opens for itself
   * is owned; a caller with no principal on a host with no users directory owns
   * nothing, as a session opened there is owned by nobody.
   */
  const ownerOfCaller = (caller: ToolCaller): Owner | undefined => {
    if (caller.root === true) return `root:${options.hostName ?? 'host'}`;
    return caller.principal === undefined ? undefined : ownerOfPrincipal(caller.principal);
  };

  /**
   * Whether a call with no session may do `grant` here.
   *
   * A root caller is refused nothing, as `admit` refuses it nothing on the
   * wire; a host with no users directory has nobody to ask and answers as it
   * answered before there was anybody; and a caller who signed in is answered
   * by what they hold.
   */
  const callerMay = (caller: ToolCaller, grant: Grant): boolean => {
    if (options.users === undefined || caller.root === true) return true;
    return caller.principal?.can(grant) === true;
  };

  /** Who a call with no session acts for: the caller's id, or the host for root. */
  const callerPerson = (caller: ToolCaller): string | undefined =>
    (caller.root === true ? 'host' : caller.principal?.id);

  /** The refusal a sessionless tool throws when it needs a chat it has none of. */
  const needsSession = (): never => {
    throw new Error('This needs a session');
  };

  /**
   * What a host tool sees of this host when a person asks with no session.
   *
   * The same host as `toolContext`, and the same operations, reached by
   * somebody who is not in a chat: what a tool does to another session - a
   * message, a chat, a session, a title, a deletion - is done as the caller,
   * and what it does to its own chat throws instead of guessing one. Nothing
   * is counted against a tree, because a person with no session is not a tree.
   */
  const sessionlessContext = (caller: ToolCaller): SessionlessToolCall => {
    const sender = ownerOfCaller(caller);
    const person = callerPerson(caller);
    /** Who the turn a tool begins was sent by, written under the id it will carry. */
    const sent = (turnId: string): void => { if (sender !== undefined) senders.set(turnId, sender); };
    return {
      turn: () => undefined,
      person: () => person,
      may: (grant) => callerMay(caller, grant),
      refusal: (grant) => refusalReason(person ?? 'host', grant),
      sessions: async () => (callerMay(caller, 'session:read') ? await allRows() : []),
      chats: chatsOf,
      models: modelsKnown,
      providers: providersKnown,
      context: contextOf,
      send: async (at, chatId, text, from) => {
        // A session asleep in the catalogue is woken for the message, and held
        // awake until it has begun - the same road a call from a session takes.
        const release = ctx.hold(at);
        try {
          if (!sessions.has(at) && ctx.owners.has(at)) await ctx.wake(at);
          const held = sessions.get(at);
          const found = held === undefined ? undefined : chatMeant(held, chatId);
          if (found === undefined) throw new Error(`${at} is not a session this host is running`);
          const state = (ctx.stateOf(found.chat.chatUri) ?? found.chat.chatState()) as { activeTurn?: unknown; queuedMessages?: unknown; steeringMessage?: unknown };
          const busy = state.activeTurn !== undefined || state.steeringMessage !== undefined
            || (Array.isArray(state.queuedMessages) && state.queuedMessages.length > 0);
          if (busy) {
            ctx.enqueue(found.chat.chatUri, crypto.randomUUID(), text, from, { owner: sender });
            return 'queued';
          }
          const first = crypto.randomUUID();
          sent(first);
          void ctx.startTurn(found.chat, first, text, undefined, from);
          return 'sent';
        } finally {
          release();
        }
      },
      create: async (asked) => {
        // No chain and no tree: a session made here belongs to the caller, has
        // no parent, and spends no budget kept for one.
        const provider = asked.provider ?? ctx.first?.provider;
        if (provider === undefined) throw new Error(noProvider(provider));
        const agent = ctx.agents.get(provider);
        if (agent === undefined) throw new Error(noProvider(provider));
        const made = uriFor(crypto.randomUUID());
        // The backend's own settings, checked, and the two keys this call owns
        // over them, as a session made from a turn builds them.
        const config: Record<string, unknown> = {
          ...(checkedConfig(agent, asked.config) ?? {}),
          ...(asked.isolation !== undefined ? { isolation: asked.isolation } : {}),
          ...(asked.model !== undefined ? { model: asked.model } : {}),
        };
        const where = asked.workingDirectory;
        await resolveCreatedSessionConfig(made, asked.workingDirectory, config);
        openSession(made, provider, config, where, undefined, undefined, undefined, asked.title,
          sender === undefined ? undefined : forWhom(sender, caller.principal));
        ctx.oweTree(made, {}, undefined, () => ({}));
        const lead = byChat.get(chatUriFor(made));
        if (lead === undefined) throw new Error(`${made} did not start`);
        const first = crypto.randomUUID();
        sent(first);
        void ctx.startTurn(lead.chat, first, asked.prompt, asked.model === undefined ? undefined : { id: asked.model }, asked.from);
        return { session: made, chat: chatUriFor(made) };
      },
      createChat: async (session, asked) => await openChat(session, asked),
      rename: (session, chat, title) => { renameChat(session, chat, title); },
      remove: async (session) => {
        // The caller's own reference is who may dispose of it: the principal
        // they signed in as, or the `root:` owner this host's own connection is.
        await removeSession(session, caller.root === true ? sender : caller.principal ?? sender);
      },
      setWorkspace: needsSession,
      scheduleWake: needsSession,
      cancelWake: needsSession,
      artifacts: needsSession,
      setArtifacts: needsSession,
      terminals: needsSession,
      read: needsSession,
    };
  };

  /**
   * The tools a person may call with no session behind the call.
   *
   * The other list, for the other place tools run: the tools that say
   * `sessionless: true`, in the order this host contributes them, less the
   * advanced ones unless the host permits them - `ctx.contributing` is already
   * that set - and less the opt-in ones, which are offered to one kind of
   * session by name and never to a call with no session at all.
   *
   * A tool's `grant` decides the rest: a caller who may not do it is not
   * offered the tool, which is how a window that may read is offered
   * `list_sessions` and not `delete_session`. The list is built for one caller
   * and not kept, because the principal is both what it is cut by and the
   * person each bound tool answers to.
   */
  const sessionlessTools = (caller: ToolCaller): BoundTool[] =>
    ctx.contributing.flatMap((one): BoundTool[] => {
      if (one.sessionless !== true || one.optIn === true) return [];
      if (one.grant !== undefined && !callerMay(caller, one.grant)) return [];
      // No session means no strategy of its own: the deferred one this host
      // gives every session is the one a person is offered.
      const session: ToolSession = { titleStrategy: strategyOf('') };
      if (one.isEnabledForSession?.(session) === false) return [];
      const asked = one.forSession?.(session);
      const definition = asked?.definition === undefined ? one.definition : { ...one.definition, ...asked.definition };
      const person = callerPerson(caller);
      return [{
        /*
         * A frozen copy, as for a session: this one leaves the host with a
         * window, and one that changed the wording would be changing what the
         * next caller is offered.
         */
        definition: frozenCopy(definition),
        // The call and its outcome are one event, raised after the tool is
        // done, so a handler knows whether it answered and not only that it
        // ran. A call with no session names the person it was made by instead.
        run: async (input: Record<string, unknown>): Promise<string> => {
          try {
            /*
             * A tool the operator's rule names is refused here.
             *
             * The rule is the operator saying the call asks every time, and
             * this door has no session to ask in: a refusal is the one answer
             * that keeps the rule. The message names the key so a person can
             * find what refused them.
             */
            if (asksForTool(rootConfig, `ahp/${definition.name}`)) {
              throw new Error(`${definition.name} asks every time: eligibleForAutoApproval names ahp/${definition.name}, and /mcp has no session to ask in`);
            }
            const answer = await one.run(input, sessionlessContext(caller));
            void fire({ type: 'tool_call', tool: definition.name, ok: true, ...(person === undefined ? {} : { person }) });
            return answer;
          }
          catch (error) {
            void fire({
              type: 'tool_call',
              tool: definition.name,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              ...(person === undefined ? {} : { person }),
            });
            throw error;
          }
        },
        ...(one.effects !== undefined ? { effects: frozenCopy(one.effects) } : {}),
        ...(one.confirm !== undefined ? { confirm: one.confirm } : {}),
        ...(one.deferLoading !== undefined ? { deferLoading: one.deferLoading } : {}),
      }];
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
        .flatMap((part, at) => (part.type === 'mcpServer' && partOff(uri, one, at) ? [str(part.name) ?? ''] : [])));
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
  /**
   * Take back everything a session kept of its own, now that it is gone.
   *
   * Its endpoints, which stop answering with it, and the decisions it made for
   * itself about its backend's customizations - a session that is over has no
   * answer to give about one, and the store is where a decision that outlives
   * a session is kept.
   */
  const toolsServersGone = (uri: string): void => {
    for (const opened of served.get(uri) ?? []) opened.close();
    served.delete(uri);
    decided.delete(uri);
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

  /**
   * The tools a session with something to call is handed, in the order it is
   * offered them - less the session tools where this session's provider is not
   * offered them, which is read off the provider the tools are being bound for
   * rather than off the held session, because at a session's start there is no
   * held session to ask yet.
   */
  const offeredTools = (uri: string, chatUri: string, provider?: string): BoundTool[] => [
    ...clientTools(uri),
    ...contributingTo(uri, provider).flatMap((one): BoundTool[] => {
      const definition = shapedDefinition(one, uri);
      return definition === undefined ? [] : [{
        /*
         * A frozen copy: this one leaves the host with the backend, and a
         * backend that changed the wording would be changing what the host
         * offers the next session.
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
        ...(one.confirm !== undefined ? { confirm: one.confirm } : {}),
        ...(one.deferLoading !== undefined ? { deferLoading: one.deferLoading } : {}),
      }];
    }),
  ];
  /**
   * Whether a client in this session offers the tool the origin instruction names.
   *
   * The instruction tells the agent to report back with `send_remote_message`,
   * and a client is what runs that tool - so a session whose clients offer
   * none is one where the model would be told to call something it has not
   * got. Asked of what was announced rather than of what is offered, because
   * the announcement is the same list whichever way the host names it back.
   */
  const offersSendRemoteMessage = (uri: string): boolean => activeClientsOf(uri).some((client) =>
    (Array.isArray(client.tools) ? client.tools : []).some((tool) => bag(tool).name === SEND_REMOTE_MESSAGE));

  /**
   * The bodies of the session's client rules that always apply.
   *
   * Read off the copies this host made of the clients' plugins, so these are
   * the client's own words and not this host's. A rule that does not say
   * `alwaysApply: true` is left out: such a rule is one an agent reads where it
   * applies, and this host has no turn to decide that for.
   *
   * Read when a chat starts rather than kept, because the copies move with the
   * session's clients and a start is the only moment they are handed over.
   */
  const rulesTold = (uri: string): string[] => pluginCopies(uri).flatMap((path) =>
    (rulesOf(path, uriOf(path)) ?? []).flatMap(({ part, body }) => {
      // A rule with nothing written in it says nothing to a model.
      if (part.alwaysApply !== true || body === '') return [];
      if (body.length > RULE_MOST) {
        log(`the rule ${str(part.name) ?? path} in ${path} is over ${String(RULE_MOST)} characters, so it was dropped`);
        return [];
      }
      return [body];
    }));

  /**
   * What the model is told when a chat of this session begins.
   *
   * The host's tools first, in the order the tools are offered, and the
   * session's client rules after them: what a tool wants said about itself is
   * this host's own wording, and a rule is a client's standing instruction
   * that holds whatever the tools happen to be. An opt-in tool this session
   * did not name is not among them: an instruction about a tool the model has
   * not been offered is an instruction it cannot follow.
   */
  const instructions = (uri: string): string[] => {
    const named = namedBy(uri);
    return [
      ...ctx.contributing.flatMap((one) => {
        if (one.optIn === true && !named.includes(one.definition.name)) return [];
        if (one.isEnabledForSession?.(toolSession(uri)) === false) return [];
        return one.instruction === undefined ? [] : [one.instruction];
      }),
      ...rulesTold(uri),
    ];
  };

  /**
   * What a turn of a session another window delegated here is told.
   *
   * Report back to the chat the work came from, given only where such a
   * session has a client that can report - the window's own rule over the
   * origin it wrote and the tool it names. Handed to the backend as the words
   * to read when the turn begins rather than as the words themselves, because
   * this is the instruction that cannot be settled once: a client that joins,
   * or leaves, reaches the next turn and not the one already running.
   */
  const turnInstructions = (uri: string): TurnOptions => ({
    instructions: () => (kept.remoteOrigin?.(idOf(uri)) === undefined || !offersSendRemoteMessage(uri)
      ? []
      : [REMOTE_SESSION_ORIGIN_INSTRUCTION]),
  });

  return {
    permitted, strategyOf, sessionBindings, shapedDefinition, toolDefinitions, serverToolsMoved,
    clientTools, clientPluginsOf, toggleClientPlugin, customizationUnder, folderOf, withEntries, tellOff, forgetTold, keepDecision, publishSessionCustomizations,
    retool, pluginsSettled, chatMeant, renameChat, renameSession, snapshotDefaultChatTitle, toolContext, sessionlessContext,
    pluginsFor, pluginsMoved, mcpFor, deniedMcpServers,
    toolsServersGone, boundTools, sessionlessTools, instructions, turnInstructions, openChat,
    moving, served,
  };
}