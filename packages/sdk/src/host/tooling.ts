import { idOf } from '../catalog.js';
import { ROOT, chatUriFor } from './channels.js';
import { need } from './common.js';
import type { Bag } from '../types/common.js';
import type { HostTool, ToolCall, TitleStrategy } from '../types/host.js';
import type { BoundTool, McpServer } from '../types/agent.js';
import type { Session } from '../types/session.js';
import type { ToolDefinition } from '@microsoft/agent-host-protocol';
import type { ToolsEndpoint } from '../toolserver.js';
import type { Held } from './state.js';
import type { HostContext } from './context.js';

/**
 * What a session's model is offered, and what a host tool sees of this host.
 *
 * The tools this host contributes and the ones its clients provide, shaped per
 * session by the compact wording and the title strategy, the turn a host tool
 * is handed, and the endpoints and MCP servers a backend is started with.
 */
export interface Tooling {
  /** The tools a session is offered, with the permission applied once. */
  permitted(tools: readonly HostTool[]): HostTool[];
  /** Whether the client asked for the compact wording. */
  compactPrompts(): boolean;
  /** The title strategy each running session resolved when it opened. */
  strategies: Map<string, TitleStrategy>;
  /** The strategy a session's uri resolves to, snapshot or root config. */
  strategyOf(uri: string): TitleStrategy;
  /** One tool's definition for a session, after the compact and strategy shaping. */
  shapedDefinition(one: HostTool, uri: string): ToolDefinition | undefined;
  /** The definitions alone for one session, which is the half that goes on the wire. */
  toolDefinitions(uri: string): ToolDefinition[];
  /** The tools the clients in a session provide, as tools to offer the model. */
  clientTools(uri: string): BoundTool[];
  /** Tell a session's chats what they may offer, after the clients moved. */
  retool(uri: string): void;
  /** The chat a tool means in a session: the one with that id, or the default. */
  chatMeant(held: Held, chatId: string | undefined): { uri: string; chat: Session } | undefined;
  /** A move a session's agent asked for, waiting for its turn to end. */
  moving: Map<string, { chat: string; directory: string; isolation: boolean }>;
  /** Give a chat a title, and say so. */
  renameChat(uri: string, chatUri: string, title: string): void;
  /** What a host tool sees of this host, from inside one chat. */
  toolContext(uri: string, chatUri: string): ToolCall;
  /** The MCP servers this session is offered, read now rather than held. */
  mcpFor(): Record<string, McpServer>;
  /** The endpoints opened for a session, by the session that opened them. */
  served: Map<string, ToolsEndpoint[]>;
  /** Take back every endpoint a session opened. */
  toolsServersGone(uri: string): void;
  /** The tools as one session runs them, with the host's own view bound in. */
  boundTools(uri: string, chatUri: string): BoundTool[];
  /** What the host's tools want the model told, in the order the tools are offered. */
  instructions(uri: string): string[];
}

export function createTooling(ctx: HostContext): Tooling {
  const {
    options, sessions, byChat, first, kept, terminals, learned, rootConfig,
    activeClientsOf, leadOf, heldAs, ownerOf, listing, setArtifacts, forWhom,
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
  /** Whether the client asked for the compact wording. */
  const compactPrompts = (): boolean => rootConfig.artifactToolsCompactPrompts === true;
  /**
   * The title strategy each running session resolved when it opened.
   *
   * Snapshotted rather than read from the root config on every call, so a
   * root change affects sessions opened after it and not one mid-turn. A
   * session this host is only browsing has no entry and resolves from the
   * root each time, which is the compatibility path.
   */
  const strategies = new Map<string, TitleStrategy>();
  const strategyOf = (uri: string): TitleStrategy =>
    strategies.get(uri) ?? (rootConfig.deferredTitleGeneration === true ? 'deferred' : 'activeAgent');
  /**
   * One tool's definition for a session, after the compact and strategy
   * shaping, or nothing where the session's strategy withholds the tool.
   *
   * The compact wording is merged first and the strategy's over it, so a
   * strategy that changes a description wins.
   */
  const shapedDefinition = (one: HostTool, uri: string): ToolDefinition | undefined => {
    const compacted = compactPrompts() && one.compact?.definition !== undefined
      ? { ...one.definition, ...one.compact.definition }
      : one.definition;
    const asked = one.forSession?.({ titleStrategy: strategyOf(uri) });
    if (asked?.offered === false) return undefined;
    return asked?.definition === undefined ? compacted : { ...compacted, ...asked.definition };
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
        definition: {
          ...definition as unknown as BoundTool['definition'],
          name: `${clientId}__${name}`,
        },
        owner: clientId,
      }];
    });
  });

  /**
   * Tell a session's chats what they may offer, after the clients moved.
   *
   * Every chat, because the clients are the session's rather than one chat's -
   * somebody with two conversations open in one session contributes the same
   * tools to both. A backend that cannot take tools at all answers false and
   * is left alone; there is nothing to report to a client either way, because
   * what it announced is already on the session state.
   */
  const retool = (uri: string): void => {
    const held = sessions.get(uri);
    if (!held) return;
    for (const [chatUri, chat] of held.chats) {
      void chat.setTools?.(boundTools(uri, chatUri)).catch(() => {});
    }
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
   * The catalogue is `listing()`, which is what `listSessions` answers; a
   * message is `begin` or `queue` on the chat, which is what `chat/turnStarted`
   * and `chat/pendingMessageSet` come to; a session is `openSession`, which is
   * what `createSession` comes to. Nothing is reachable from here that is not
   * reachable from a client, and the reverse is nearly true.
   */
  const toolContext = (uri: string, chatUri: string): ToolCall => ({
    session: uri,
    chat: chatUri,
    turn: () => {
      const chat = byChat.get(chatUri)?.chat;
      const active = chat === undefined ? undefined : (chat.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
      return typeof active?.id === 'string' ? active.id : undefined;
    },
    sessions: () => listing(),
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
      return {
        turns: Array.isArray(state.turns) ? state.turns as Bag[] : [],
        ...(typeof state.activeTurn === 'object' && state.activeTurn !== null ? { activeTurn: state.activeTurn as Bag } : {}),
        hasMoreHistory: state.turnsNextCursor !== undefined,
      };
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
      const chat = spawn(held.agent, at, chatUri, backendsOwn(held.config), undefined, held.workingDirectory, undefined, held.additional);
      log(`opened ${chatUri} in ${at}`);
      if (asked.title !== undefined) { chat.setTitle?.(asked.title); keepTitle(at, chatUri, asked.title); }
      dispatch(at, { type: 'session/chatAdded', summary: chatSummary(at, chatUri, chat) });
      chat.begin(crypto.randomUUID(), asked.prompt, asked.model === undefined ? undefined : { id: asked.model }, asked.from);
      return { chat: chatUri };
    },
    rename: (session, chat, title) => { renameChat(heldAs(session), chat, title); },
    remove: async (session) => { removeSession(heldAs(session)); },
    setWorkspace: (directory, isolation) => {
      moving.set(uri, { chat: chatUri, directory: directory.replace(/^file:\/\//, ''), isolation });
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
      return held.encoding === 'base64' ? Buffer.from(data, 'base64').toString('utf8') : data;
    },
  });

  /**
   * The MCP servers this session is offered, read now rather than held.
   *
   * The host's own map with the session's enabled client plugins' over it, a
   * client plugin winning a name clash - the merge VS Code makes - because the
   * client that asked for a server is closer to the work than the host is.
   *
   * Only the host's half is here: this host has no client plugin
   * customizations to merge, so nothing overrides a name yet and the merge is
   * one spread waiting for the plugins that will fill it.
   */
  const mcpFor = (): Record<string, McpServer> => ({ ...options.mcpServers });

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
   */
  const boundTools = (uri: string, chatUri: string): BoundTool[] => [
    ...clientTools(uri),
    ...ctx.contributing.flatMap((one): BoundTool[] => {
      const definition = shapedDefinition(one, uri);
      return definition === undefined ? [] : [{
        definition,
        // The call and its outcome are one event, raised after the tool is
        // done, so a handler knows whether it answered and not only that it
        // ran. Raising it before would report an attempt as a result.
        run: async (input: Record<string, unknown>): Promise<string> => {
          try {
            const answer = await one.run(input, toolContext(uri, chatUri));
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
        ...(one.effects !== undefined ? { effects: one.effects } : {}),
        ...(one.deferLoading !== undefined ? { deferLoading: one.deferLoading } : {}),
      }];
    }),
  ];
  /** What the host's tools want the model told, in the order the tools are offered. */
  const instructions = (uri: string): string[] => ctx.contributing.flatMap((one) => {
    if (one.forSession?.({ titleStrategy: strategyOf(uri) })?.offered === false) return [];
    const said = compactPrompts() && one.compact?.instruction !== undefined ? one.compact.instruction : one.instruction;
    return said === undefined ? [] : [said];
  });

  return {
    permitted, compactPrompts, strategyOf, shapedDefinition, toolDefinitions,
    clientTools, retool, chatMeant, renameChat, toolContext, mcpFor,
    toolsServersGone, boundTools, instructions,
    strategies, moving, served,
  };
}