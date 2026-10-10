import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState, SessionInputRequestKind } from '@microsoft/agent-host-protocol';
import { RpcError, INTERNAL_ERROR } from '../rpc.js';
import { computerId, computersFor } from '../computers.js';
import { uriOf } from '../fileuri.js';
import { deepFreeze, frozenCopy } from '../frozen.js';
import { nestedAgent } from '../nested.js';
import { idOf, uriFor, Status } from '../catalog.js';
import { meter } from '../meter.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../tools/clientcalls.js';
import { chatUriFor, subagentChatUri } from './channels.js';
import { CLOSING } from './common.js';
import { sameFolder, trusted } from './trust.js';
import type { Bag } from '../types/common.js';
import type { Agent } from '../types/agent.js';
import type { Connection } from '../types/host.js';
import type { Session, SubagentChat, SubagentRequest } from '../types/session.js';
import type { ResourceStore } from '../types/resources.js';
import type { RunClientTool, ToolsChanged, ToolsEndpoint } from '../tools/server.js';
import type { Move } from './lifecycle.js';
import type { HostContext } from './context.js';

/**
 * What starting a backend's session is made of.
 *
 * The one place a backend session comes to life, together with the worker chats
 * it asks for: the call stamps a worker chat is linked by, the row a worker is
 * announced as, and the titles and harness a session is recorded under.
 */
export interface Spawn {
  /** Fold one worker chat's action into the state a subscriber reads. */
  absorb(ref: { state: Bag }, action: Bag): void;
  /** Whether a tool call, or a tool call action, spawns a worker whose chat URI it does not carry yet. */
  unstamped(meta: unknown): meta is Bag;
  /** A tool call action with the worker chat's URI in its `_meta`. */
  withWorkerUri(chat: string, action: Bag): Bag;
  /** Every turn's tool calls stamped with this session's name. */
  stampedCalls(session: string, turns: Bag[]): Bag[];
  /** Every turn marked with which client sent it. */
  withSender(session: string, turns: Bag[]): Bag[];
  /** Write one action on a worker's chat, and keep the state a subscriber reads. */
  sendSubagent(uri: string, given: Bag): void;
  /** What each worker chat's row last said, so an unchanged one is not re-sent. */
  describedSub: Map<string, string>;
  /** Workers whose turn has been ended, so a second ending is not a second turn. */
  endedWorkers: Set<string>;
  /** The worker chat for one tool call of a backend's, made on first ask. */
  openSubagent(session: string, lead: string, toolCallId: string, request: SubagentRequest): SubagentChat;
  /** A chat of a session in the session's `ahp-session:/<id>` spelling, when it has one. */
  formerChatUri(uri: string, chatUri: string): string | undefined;
  /** A chat's stored title. */
  titleOf(uri: string, chatUri: string): string | undefined;
  /** Store a chat's title under its name. */
  keepTitle(uri: string, chatUri: string, title: string): void;
  /** Write down which harness a session runs on, under every id it answers to. */
  keepProvider(uri: string, agent: Agent, session: Session): void;
  /**
   * Start one backend's session, and the worker chats it goes on to ask for.
   *
   * `sender` is the connection that sent the turn this start is for, when a
   * client sent it. It is what the start's `trusted` is read from and nothing
   * else is, so a start nobody's connection asked for - an automation, a host
   * tool, a daemon restarting what it held - is a start with no trust at all.
   */
  spawn(
    agent: Agent,
    uri: string,
    chatUri: string,
    chatId: string | undefined,
    config: Record<string, unknown>,
    resuming?: { resume?: string; seed?: Bag[]; forkAt?: string; rewindAt?: string; context?: string },
    workingDirectory?: string,
    credentials?: Record<string, string>,
    additional?: string[],
    sender?: Connection,
  ): Session;
}

/**
 * The host's store, as one session's backend is handed it.
 *
 * A new object per session, frozen, whose every method calls the host's own -
 * so a backend that replaces `read` on what it was given changes its own view
 * and nothing else, while the bytes it reads are still the host's. The live
 * store is one object shared by every session and by the resource commands,
 * and a backend that reached into it would be changing what the next client
 * reads - decision `a-plugin-gets-frozen-copies-of-host-values`.
 *
 * The write half is the store's to offer or leave out, and this view offers
 * exactly what it holds: a store that cannot be written stays a read-only
 * store here rather than one that throws on every call.
 */
function heldResources(store: ResourceStore): ResourceStore {
  const taken: ResourceStore = {
    list: (uri) => store.list(uri),
    read: (uri, wanted) => store.read(uri, wanted),
    resolve: (uri, followSymlinks) => store.resolve(uri, followSymlinks),
    complete: (typed, base, limit) => store.complete(typed, base, limit),
  };
  const write = store.write;
  const remove = store.remove;
  const mkdir = store.mkdir;
  const move = store.move;
  const copy = store.copy;
  const watch = store.watch;
  if (write !== undefined) taken.write = (uri, content, owner, reader) => write(uri, content, owner, reader);
  if (remove !== undefined) taken.remove = (uri, recursive, owner, reader) => remove(uri, recursive, owner, reader);
  if (mkdir !== undefined) taken.mkdir = (uri) => mkdir(uri);
  if (move !== undefined) taken.move = (source, destination, failIfExists) => move(source, destination, failIfExists);
  if (copy !== undefined) taken.copy = (source, destination, failIfExists) => copy(source, destination, failIfExists);
  if (watch !== undefined) taken.watch = (uri, asked, onChange) => watch(uri, asked, onChange);
  return Object.freeze(taken);
}

export function createSpawn(ctx: HostContext): Spawn {
  const {
    options, sessions, byChat, subagents, owners, kept, names, births, drafts, about,
    dispatch, log, described, links, resumedSessions,
    sessionHolding, respell, dirOf, operationsMoved, refreshWatched, refreshFacts,
    fire, charged, senders, senderOf, sentBy, enteredIn, inMachine, bringBackOf,
    contributedDefaults, runningSchema, chatSummary, subagentSummary, summaryMoved, learnModels,
  } = ctx;

  /**
   * One worker chat's actions, folded into the state a subscriber reads.
   *
   * The protocol package's own `chatReducer`, deliberately: a hand-rolled
   * folder here would be a second answer to what a chat action means, and the
   * one a client runs is the one that has to agree with it.
   */
  const absorb = (ref: { state: Bag }, action: Bag): void => {
    try {
      ref.state = chatReducer(ref.state as unknown as ChatState, action as unknown as ChatAction) as unknown as Bag;
    }
    catch { /* an action the reducer will not take leaves the state as it was */ }
    ref.state.modifiedAt = new Date().toISOString();
  };

  /** Whether a tool call, or a tool call action, spawns a worker whose chat URI it does not carry yet. */
  const unstamped = (meta: unknown): meta is Bag =>
    typeof meta === 'object' && meta !== null && (meta as Bag).toolKind === 'subagent'
    && (meta as Bag).subagentChatUri === undefined;
  /**
   * A tool call action with the worker chat's URI in its `_meta`.
   *
   * The reference's `subagentChatUri`, stamped on every tool call action that
   * carries a `_meta` whose `toolKind` is `subagent`, so a client can open the
   * worker's chat from the call before the chat is announced. Every such
   * action and not only the start: an action carrying `_meta` replaces the
   * call's whole bag. The backend never spells a chat URI; this host does.
   * Any other action is returned as it is.
   */
  const withWorkerUri = (chat: string, action: Bag): Bag => {
    if (typeof action.type !== 'string' || !action.type.startsWith('chat/toolCall')) return action;
    if (!unstamped(action._meta) || typeof action.toolCallId !== 'string') return action;
    const session = sessionHolding(chat);
    if (session === undefined) return action;
    return { ...action, _meta: { ...action._meta, subagentChatUri: subagentChatUri(session, action.toolCallId) } };
  };
  /**
   * A chat's state with the same stamp on every spawning call in its turns,
   * so a client that subscribes late reads what the wire said. A copy where
   * anything moved; the state passed in is the backend's own.
   */
  const stampedCalls = (session: string, turns: Bag[]): Bag[] => turns.map((turn) => {
    const parts = Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : undefined;
    if (parts === undefined) return turn;
    let touched = false;
    const next = parts.map((part) => {
      const call = part.toolCall as Bag | undefined;
      if (call === undefined || !unstamped(call._meta) || typeof call.toolCallId !== 'string') return part;
      touched = true;
      return { ...part, toolCall: { ...call, _meta: { ...call._meta, subagentChatUri: subagentChatUri(session, call.toolCallId) } } };
    });
    return touched ? { ...turn, responseParts: next } : turn;
  });
  /**
   * A turn with the sender who asked it, and every turn without one left as it
   * is.
   *
   * `_meta` is the protocol's own place for a message's context and only the
   * message declares one - `Turn` and `ActiveTurn` do not - so a turn read out
   * of a session says who sent it the way the live action does, on the thing
   * the client was handed. A copy where a sender was found and the backend's
   * own object everywhere else, because `chatState()` is the agent's answer
   * and not a place this host writes into.
   */
  const withSender = (session: string, turns: Bag[]): Bag[] => turns.map((turn) => {
    const sender = kept.sender(idOf(session), String(turn.id ?? ''));
    const message = turn.message as Bag | undefined;
    if (sender === undefined || typeof message !== 'object' || message === null) return turn;
    return { ...turn, message: { ...message, _meta: { ...(message._meta as Bag | undefined), 'ahpd.sender': sender } } };
  });

  /**
   * Write one action on a worker's chat, and keep the state a subscriber reads.
   *
   * Reduced here rather than asked of the backend: the emitter the backend
   * holds is the only thing that writes to this chat, so folding everything it
   * sends is the whole of that chat's state, and the row is re-announced only
   * when what it says has moved.
   */
  const describedSub = new Map<string, string>();
  /** Workers whose turn has been ended, so a second ending is not a second turn. */
  const endedWorkers = new Set<string>();
  const sendSubagent = (uri: string, given: Bag): void => {
    const ref = subagents.get(uri);
    if (ref === undefined) return;
    const action = withWorkerUri(uri, given);
    const was = { status: ref.state.status, activity: ref.state.activity };
    absorb(ref, action);
    dispatch(uri, action);
    const summary = subagentSummary(uri, ref);
    const now = JSON.stringify(summary);
    if (describedSub.get(uri) === now) return;
    describedSub.set(uri, now);
    dispatch(ref.session, { type: 'session/chatUpdated', chat: uri, changes: summary });
    // A worker's status and activity are part of what its session reads as.
    if (ref.state.status !== was.status || ref.state.activity !== was.activity) summaryMoved(ref.session);
  };

  /**
   * The worker chat for one tool call of a backend's, made on first ask.
   *
   * The row is announced on the session, the turn is opened with the prompt,
   * and the spawning call is linked to it - which is the whole of what makes a
   * worker's conversation a conversation rather than a pile of parts inside
   * somebody else's turn.
   */
  const openSubagent = (session: string, lead: string, toolCallId: string, request: SubagentRequest): SubagentChat => {
    const uri = subagentChatUri(session, toolCallId);
    /*
     * The chat the call is in. A nested worker's call is in the worker chat
     * that spawned it, which is why the parent names a call and not a chat.
     */
    const parentChat = request.parentToolCallId !== undefined && request.parentToolCallId !== ''
      ? subagentChatUri(session, request.parentToolCallId)
      : lead;
    let ref = subagents.get(uri);
    if (ref === undefined) {
      const now = new Date().toISOString();
      ref = {
        session,
        parentChat,
        toolCallId,
        title: request.title,
        ...(request.agentName !== undefined ? { agentName: request.agentName } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        turnId: `turn-${crypto.randomUUID()}`,
        openedAt: Date.now(),
        state: {
          resource: uri,
          title: request.title,
          status: Status.Idle,
          modifiedAt: now,
          origin: { kind: 'tool', chat: parentChat, toolCallId },
          interactivity: 'read-only',
          turns: [],
          queuedMessages: [],
        },
      };
      subagents.set(uri, ref);
      dispatch(session, { type: 'session/chatAdded', summary: subagentSummary(uri, ref) });
      sendSubagent(uri, {
        type: 'chat/turnStarted',
        turnId: ref.turnId,
        startedAt: now,
        // The parent agent's instruction, which is the worker's own message.
        message: { text: request.prompt ?? '', origin: { kind: 'tool' } },
      });
      /*
       * The link, on the call itself.
       *
       * The protocol keeps the two ends consistent: the chat's origin names
       * the call, and the call's result content names the chat. Written with
       * whatever the call already had, which is why the content is remembered
       * beside the action that carried it. Written only while the call's chat
       * has a turn open: an action naming a turn that has ended lands on no
       * turn a client holds, and the backend's own completion of the call
       * carries the link instead. A nested worker's call is in its parent
       * worker's chat, whose state this host reduces, so the link goes through
       * `sendSubagent` and lands in that state too.
       */
      const parentTurn = links.turnOf(parentChat);
      if (parentTurn !== undefined) {
        const content = { type: 'subagent', resource: uri, title: request.title,
          ...(request.agentName !== undefined ? { agentName: request.agentName } : {}),
          ...(request.description !== undefined ? { description: request.description } : {}) };
        const held = (links.contentOf(parentChat, toolCallId) ?? []).filter((one) => !(one.type === 'subagent' && one.resource === uri));
        const next = [...held, content];
        links.hold(parentChat, toolCallId, next);
        const link = { type: 'chat/toolCallContentChanged', turnId: parentTurn, toolCallId, content: next };
        if (subagents.has(parentChat)) sendSubagent(parentChat, link);
        else dispatch(parentChat, link);
      }
    }
    const held = ref;
    return {
      uri,
      turnId: held.turnId,
      emit: (action: Bag) => sendSubagent(uri, action),
      end: (state: 'complete' | 'error' | 'cancelled', why?: string) => {
        const held = subagents.get(uri);
        if (held === undefined || endedWorkers.has(uri)) return;
        endedWorkers.add(uri);
        const duration = Math.max(0, Date.now() - held.openedAt);
        const turnId = held.turnId;
        if (state === 'complete') sendSubagent(uri, { type: 'chat/turnComplete', turnId, duration });
        else if (state === 'cancelled') sendSubagent(uri, { type: 'chat/turnCancelled', turnId, duration });
        else {
          sendSubagent(uri, {
            type: 'chat/error',
            turnId,
            duration,
            part: { kind: 'error', error: { errorType: 'turnFailed', message: why ?? 'The subagent failed' } },
          });
        }
      },
    };
  };

  /**
   * A chat of a session in the session's `ahp-session:/<id>` spelling, or
   * nothing for a chat whose name does not carry its session - one a client
   * named itself.
   *
   * A default or worker chat's URI embeds its session's, and a session store
   * may hold a chat's title under that spelling of it, so a title is looked
   * for there too.
   */
  const formerChatUri = (uri: string, chatUri: string): string | undefined => {
    const former = respell(chatUri, uri, uriFor(idOf(uri)));
    return former === chatUri ? undefined : former;
  };
  /** A chat's stored title: under its name, or else under its `ahp-session:` spelling. */
  const titleOf = (uri: string, chatUri: string): string | undefined => {
    const former = formerChatUri(uri, chatUri);
    return kept.chatTitle(idOf(uri), chatUri) ?? (former === undefined ? undefined : kept.chatTitle(idOf(uri), former));
  };
  /** A nested session's record with a new title or a new time, where it has one. */
  const moveNested = (id: string, change: { title?: string }): void => {
    const was = kept.nested?.(id);
    if (was === undefined) return;
    kept.setNested?.(id, { ...was, ...change, modifiedAt: new Date().toISOString() });
  };
  /** Store a chat's title under its name, and clear one kept under its `ahp-session:` spelling. */
  const keepTitle = (uri: string, chatUri: string, title: string): void => {
    kept.setChatTitle(idOf(uri), chatUri, title);
    if (chatUri === chatUriFor(uri)) moveNested(idOf(uri), { title });
    const former = formerChatUri(uri, chatUri);
    if (former !== undefined && kept.chatTitle(idOf(uri), former) !== undefined) kept.setChatTitle(idOf(uri), former, '');
    // And on the session's own list of chats, so a session served read-only
    // after a restart lists this one under the name it was given.
    ctx.keepChat(uri, chatUri, undefined, false);
  };

  /**
   * Which harness a session runs on, written down under every id it answers to.
   *
   * The host's own and the agent's, which are one name unless the backend chose
   * a different id for the transcript it writes. Written when a session starts
   * rather than when it is listed: two agents can read the same transcripts, a
   * listing is a read, and a session that was never recorded still has to open
   * somewhere. A backend that names its own id only once a turn has run is
   * recorded at the end of that turn instead, in the chat's own emit.
   */
  const keepProvider = (uri: string, agent: Agent, session: Session): void => {
    kept.setProvider(idOf(uri), agent.provider);
    const own = session.agentId();
    if (own !== undefined && own !== '') kept.setProvider(own, agent.provider);
  };

  const spawn = (
    agent: Agent,
    uri: string,
    chatUri: string,
    chatId: string | undefined,
    config: Record<string, unknown>,
    resuming?: { resume?: string; seed?: Bag[]; forkAt?: string; rewindAt?: string; context?: string },
    workingDirectory?: string,
    credentials?: Record<string, string>,
    additional?: string[],
    sender?: Connection,
  ): Session => {
    /*
     * The backend that actually runs this session.
     *
     * A backend that cannot move its own process into a machine declares
     * `runsNested`, and a session of it that names a computer runs through the
     * SDK's proxy instead: a whole host with that backend loaded is started
     * inside the machine and its frames are carried out as this session's -
     * decision `a-cofold-session-in-a-computer-runs-in-a-nested-host`. A
     * session with no machine, or a backend without the flag, is started here
     * exactly as it was.
     *
     * The host inside loads the plugin that registered the agent here, as its
     * spec was recorded, and an agent with no record ends its session saying
     * so - decision `the-host-records-which-plugin-registered-each-agent`.
     */
    const plugin = options.agentPlugins?.[agent.provider];
    const used = agent.runsNested === true && computerId(config.computer) !== undefined
      ? nestedAgent(agent, { plugins: plugin === undefined ? [] : [plugin], log })
      : agent;
    if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
    if (resuming?.resume !== undefined) resumedSessions.add(uri);
    /*
     * What this session's turns cost, kept against each turn until it ends.
     *
     * Only where the host was given somewhere to keep usage: a host with no
     * `usage` port records nothing, and a meter that had one would only hold a
     * running sum nobody reads. The owner and the scope are asked of the turn
     * and the session when the record is written rather than held here, because
     * both can move while the turn runs.
     */
    const metering = options.usage === undefined ? undefined : meter({
      usage: options.usage,
      ...(options.usagePer === undefined ? {} : { per: options.usagePer }),
      onProblem: log,
      session: uri,
      chat: chatUri,
      agent: agent.provider,
      computer: () => computerId(config.computer),
      senderOf,
      owner: () => kept.owner(idOf(uri)),
      scope: () => charged.get(uri)?.scope,
    });
    /*
     * The MCP servers this session's agent is offered, read when the session
     * starts rather than held, so a daemon that edits the key while it runs
     * changes what the next session is given.
     *
     * The session's client plugins are part of them: a plugin's own servers
     * reach every backend through here, including the ones that cannot load a
     * plugin at all.
     */
    const servers = ctx.mcpFor(uri);
    /*
     * The client plugin copies this chat's agent is handed, and a note of
     * which they were.
     *
     * A backend that loads plugins opens these directories and one that cannot
     * ignores the field; either way the set is written down here, because a
     * send is the only thing that can compare it with the session's set now.
     */
    const plugins = ctx.pluginsFor(uri, chatUri);
    /*
     * The servers of those plugins a client switched off, by name.
     *
     * Left out of `mcpFor` above, and named here: a backend that opens a
     * plugin directory can find a server there on its own, and this is how it
     * is told not to run one.
     */
    const denied = ctx.deniedMcpServers(uri);
    /*
     * The same tools as an MCP server, for a backend that cannot call them in
     * this process - an ACP agent, which asks its client for them.
     *
     * One endpoint per session, opened when the backend asks and closed when
     * the session goes, so a token reaches the tools of the session it was
     * handed to and nothing else.
     */
    const toolsServer = (ask?: { runClient?: RunClientTool; toolsChanged?: ToolsChanged }): ToolsEndpoint | undefined => {
      const opened = options.toolsServers?.open(
        ctx.boundTools(uri, chatUri, agent.provider),
        ask?.runClient,
        ask?.toolsChanged,
      );
      if (opened === undefined) return undefined;
      const held = ctx.served.get(uri) ?? [];
      held.push(opened);
      ctx.served.set(uri, held);
      return opened;
    };
    /*
     * What this backend is told about the folders it is handed.
     *
     * Read from the connection that sent the turn that starts or restarts this
     * backend, and on a host with people only when that connection is the
     * session's owner - decision
     * `a-folder-is-untrusted-until-a-client-says-otherwise`. A turn somebody
     * else sends into this session is not theirs to widen, which is why the
     * two are compared rather than the value simply passed along; and an
     * automation, a host tool and a daemon coming back up have no connection
     * at all, so what they start is untrusted - which is the same answer as a
     * window that pushed nothing.
     *
     * Where the host has no people directory there is nobody to be other than
     * the sender, and the sender decides - decision
     * `the-sender-decides-on-a-host-with-no-people`. `ownerFor` answers
     * `undefined` for every connection there, so comparing owners would refuse
     * every folder on such a host and make the value a window pushes dead on
     * it.
     *
     * A worktree this host made is read as the repository it was cut from: it
     * is a folder the window has never opened and so cannot have pushed, and
     * one the host made is trusted exactly when its repository is - decision
     * `a-worktree-inherits-its-repositorys-trust`.
     */
    const trustedBy = (folder: string): boolean => {
      if (sender === undefined) return false;
      if (options.users !== undefined) {
        const who = ctx.ownerFor(sender);
        if (who === undefined || who !== kept.owner(idOf(uri))) return false;
      }
      const made = ctx.worktrees.get(uri);
      const vouched = made !== undefined && sameFolder(made.path, folder) ? made.repository : folder;
      return trusted(vouched, sender.config?.workspaceTrust, sender.trustedFolders);
    };
    const session = used.create({
      uri,
      chatUri,
      trusted: trustedBy,
      /*
       * The tools bound to this session: this host's own, and whatever the
       * clients already in it provide.
       *
       * Asked of `boundTools` rather than of `contributing`, because a host
       * that contributes none of its own still has a client's to pass on -
       * and a session created by a client that announced its tools in the same
       * breath would otherwise have been offered nothing until the next
       * announcement moved the list.
       */
      ...(ctx.boundTools(uri, chatUri, agent.provider).length > 0 ? { tools: deepFreeze(ctx.boundTools(uri, chatUri, agent.provider)) } : {}),
      ...(ctx.instructions(uri).length > 0 ? { instructions: ctx.instructions(uri) } : {}),
      /*
       * The stores a backend may need for itself, handed down only when the
       * host holds them. Files are this host's own store, so a backend reads
       * what a client reads. `terminals` is not that store but the factory
       * over it: the host owns the URI, the root registration and the emit,
       * and a backend given the raw port would get none of the three.
       */
      ...(options.resources !== undefined ? { resources: heldResources(options.resources) } : {}),
      ...(options.terminals !== undefined ? { terminals: ctx.heldTerminals(options.terminals, uri, chatUri) } : {}),
      ...(options.computers !== undefined ? { computers: computersFor(options.computers, agent.provider, uri, kept.owner(idOf(uri))) } : {}),
      /*
       * The MCP servers, when there are any.
       *
       * Absent rather than an empty map, because a backend that reads it has no
       * way to tell a host that configured none from a host that never heard of
       * them, and the answer to either is the same.
       */
      ...(Object.keys(servers).length === 0 ? {} : { mcpServers: servers }),
      /*
       * The client plugins, when the session's clients brought any - which is
       * a directory each, here, because a path on the client's machine is not
       * one a backend running here could open.
       */
      ...(plugins.length === 0 ? {} : { plugins }),
      ...(denied.length === 0 ? {} : { deniedMcpServers: denied }),
      ...(options.toolsServers === undefined ? {} : { toolsServer }),
      // Resolved here rather than left for the backend to default, so what a
      // call waits is one number the host decided and a deployment set once.
      clientToolTimeoutMs: options.clientToolTimeoutMs ?? DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
      ...(credentials && Object.keys(credentials).length > 0 ? { credentials } : {}),
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(additional !== undefined && additional.length > 0 ? { additional: frozenCopy(additional) } : {}),
      /*
       * The chat's own name for its conversation, where it has one.
       *
       * Handed on every start of that chat - the first, a resume and a restart -
       * because it is the name the backend keeps it under, and a second start
       * that named nothing would open the session's transcript instead of this
       * chat's. A fork is the one place a backend may mint its own: it was asked
       * for a copy under a name of its own, and the id it answers with is the
       * one this host records for the chat.
       */
      ...(chatId === undefined ? {} : { chatId }),
      ...(resuming?.resume !== undefined ? { resume: resuming.resume } : {}),
      ...(resuming?.seed !== undefined ? { seed: resuming.seed } : {}),
      ...(resuming?.forkAt !== undefined ? { forkAt: resuming.forkAt } : {}),
      ...(resuming?.rewindAt !== undefined ? { rewindAt: resuming.rewindAt } : {}),
      ...(resuming?.context !== undefined ? { context: resuming.context } : {}),
      /*
       * The values in force, as a frozen copy rather than the host's own map.
       *
       * A backend reads these to know what it was started with; one that set
       * `model` on them would be setting what the host records against this
       * session and what the next turn is started with - decision
       * `a-plugin-gets-frozen-copies-of-host-values`.
       */
      settings: frozenCopy({ ...agent.defaults(), ...contributedDefaults(), ...config }),
      schema: () => runningSchema(agent),
      // What the boot probe already learned: the commands behind a slash, the
      // skills, the subagents and the MCP servers. A session that answered
      // `[]` until its own agent replied was empty for the first several
      // seconds - and a client that asks once and caches never found out
      // otherwise.
      seedCustomizations: about(agent.provider).seeds,
      /*
       * What the boot probe learned the models are, for the same reason and
       * read from the same place: a session opened with a stored model needs to
       * know this variant offers it before it will reopen on it, and a session
       * that has not been asked is not going to find out from anybody.
       */
      seedModels: about(agent.provider).models,
      /*
       * The worker chat a backend asks for, named and opened here.
       *
       * The host is the only thing that knows what a chat URI looks like, what
       * a catalogue row says and which turn a part belongs to - so the backend
       * brings the call id and the words, and everything else is this.
       */
      subagent: (toolCallId: string, request: SubagentRequest) => openSubagent(uri, chatUri, toolCallId, request),
      emit: (channel, action) => {
        const where = channel === 'chat' ? chatUri : uri;
        /*
         * Who sent this turn, and a queued one finding out which turn it became.
         *
         * The sender was recorded against the queued message's id, because that
         * is the only id a queued message has; the backend names the turn it
         * ran as, and the sender follows it there. Read before the dispatch
         * below, because an action that goes out before the move is the action
         * a client sees with nothing on it.
         */
        const turn = String(action.turnId ?? '');
        if (action.type === 'chat/turnStarted' && typeof action.queuedMessageId === 'string') {
          const waiting = senders.get(action.queuedMessageId);
          if (waiting !== undefined) senders.set(turn, waiting);
          // The window follows it too, for the same reason and by the same
          // hand: a move asked for in a queued message is asked about on the
          // connection that queued it.
          const queuedBy = sentBy.get(action.queuedMessageId);
          if (queuedBy !== undefined) sentBy.set(turn, queuedBy);
        }
        const sender = senderOf(turn);
        /*
         * Who asked, on the wire and on disk.
         *
         * The action carries it because `chat/turnStarted` is one of the few
         * that declares a `_meta`; the store keeps it because the in-memory
         * entry is let go of when the turn ends and a session read out of its
         * transcript asks the store, not this map. Nothing is written and
         * nothing is sent where there is nobody to name, so a host with no
         * users directory sends exactly what it sent before.
         */
        if (sender !== undefined && action.type === 'chat/turnStarted') {
          kept.setSender(idOf(uri), turn, sender);
          dispatch(where, { ...action, _meta: { ...(action._meta as Bag | undefined), 'ahpd.sender': sender } });
        }
        else dispatch(where, action);
        // A tool call that finished may have written to this session's tree, so
        // the changeset is re-read then rather than waiting for the turn's end.
        if (action.type === 'chat/toolCallComplete') {
          const dir = dirOf(uri);
          if (dir !== undefined) void refreshWatched(dir);
        }
        /*
         * What this turn used, kept against it until it ends.
         *
         * Read here rather than where a turn is run because this is the one
         * place every action a backend sends goes through, and before the
         * sender is let go of below, because the record says who sent the work.
         * The three endings are the ones `settleRun` reads: a turn that failed
         * is ended by its `chat/error`, not by a completion after it.
         */
        if (metering !== undefined) {
          if (action.type === 'chat/turnStarted') {
            const asked = ((action.message ?? {}) as Bag).model;
            metering.started(turn,
              typeof action.startedAt === 'string' ? action.startedAt : new Date().toISOString(),
              typeof (asked as Bag | undefined)?.id === 'string' ? ((asked as Bag).id as string) : undefined);
          }
          else if (action.type === 'chat/usage') metering.reported(turn, (action.usage ?? {}) as Bag);
          else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled'
            || action.type === 'chat/error') metering.ended(turn);
        }
        // A turn that has ended is let go of, once what a usage record will want
        // has been read off it and what a history needs is the store's.
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          senders.delete(turn);
          sentBy.delete(turn);
        }
        // A nested session's record follows the title and the last turn.
        if (action.type === 'session/titleChanged' && typeof action.title === 'string') moveNested(idOf(uri), { title: action.title });
        else if (channel === 'chat' && action.type === 'chat/turnComplete') moveNested(idOf(uri), {});
        // The two ends of a turn, as the host sees them: the backend saying it
        // began, and saying it finished or was stopped. A per-token delta is
        // not an event, because a plugin that wants the stream is a client.
        if (action.type === 'chat/turnStarted') {
          void fire({
            type: 'turn_start',
            session: uri,
            chat: chatUri,
            turn,
            ...(sender === undefined ? {} : { sender }),
          });
        }
        else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          void fire({
            type: 'turn_end',
            session: uri,
            chat: chatUri,
            turn,
            status: action.type === 'chat/turnCancelled' ? 'cancelled' : 'complete',
            ...(sender === undefined ? {} : { sender }),
          });
        }
        /*
         * A session that began, or stopped, waiting on a person. The set is an
         * upsert keyed by `id`, so setting one entry again raises it again.
         */
        if (action.type === 'session/inputNeededSet') {
          const request = (action.request ?? {}) as Bag;
          const id = String(request.id ?? '');
          const chat = String(request.chat ?? '');
          if (id !== '' && chat !== '') {
            void fire({
              type: 'input_needed_set',
              session: uri,
              chat,
              id,
              kind: request.kind as `${SessionInputRequestKind}`,
            });
          }
        }
        else if (action.type === 'session/inputNeededRemoved') {
          const id = String(action.id ?? '');
          if (id !== '') void fire({ type: 'input_needed_removed', session: uri, id });
        }
        /*
         * And the run this session was started for, when the turn that was it
         * ends. One call per action, so a run is never settled twice for one
         * event.
         */
        if (action.type === 'chat/turnComplete') ctx.settleRun(uri, { status: 'completed' });
        else if (action.type === 'chat/turnCancelled') ctx.settleRun(uri, { status: 'cancelled' });
        else if (action.type === 'chat/error') {
          // `ChatErrorAction.part` is `{ kind: 'error', error: { errorType,
          // message } }`, and only the message is worth carrying into a run.
          const part = (action.part ?? {}) as Bag;
          const failure = (part.error ?? {}) as Bag;
          ctx.settleRun(uri, {
            status: 'failed',
            error: { message: typeof failure.message === 'string' ? failure.message : 'The run failed' },
          });
        }
        /*
         * The harness a transcript is written under, kept as soon as the
         * backend has said what that id is.
         *
         * Claude names the transcript from the stream, so a fork, and a
         * session whose id the host chose and the backend did not, have no id
         * of their own until a turn has run - and a fork has none at all,
         * because `keepProvider` is called before anything is said. Only when
         * the store does not already say it: a row rewritten on every turn is
         * a store written to for nothing.
         *
         * And the chat's own record, from the same answer: a chat whose URI
         * names no id the backend took, and a fork that was asked for a copy
         * under a name of its own, run under an id this host never chose. What
         * a restart resumes is read from the record, so a record holding the
         * name that was asked for instead is a resume of a conversation that
         * does not exist.
         */
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          const own = byChat.get(chatUri)?.chat.agentId();
          if (own !== undefined && own !== '' && kept.provider(own) !== agent.provider) kept.setProvider(own, agent.provider);
          if (own !== undefined && own !== '' && ctx.recordedChat(idOf(uri), chatUri)?.backendId !== own) {
            ctx.keepChat(uri, chatUri, own, false);
          }
        }
        /*
         * The session's list of chats, when one of them has moved.
         *
         * Only on a change: a chat says something on every delta, and a
         * summary re-sent per token is a list redrawn per token.
         */
        const owner = sessions.get(uri);
        const moved = owner?.chats.get(chatUri);
        if (moved) {
          const previous = described.get(chatUri) ?? '';
          const now = `${moved.title()}\u0000${String(moved.status())}\u0000${String(moved.activity() ?? '')}`;
          if (now !== described.get(chatUri)) {
            described.set(chatUri, now);
            dispatch(uri, { type: 'session/chatUpdated', chat: chatUri, changes: chatSummary(uri, chatUri, moved) });
            // A title the backend derived is the subject a commit would use, so
            // the question the changeset's commit asks has changed with it.
            if (owner !== undefined && chatUri === owner.defaultChat && previous.split('\u0000')[0] !== moved.title()) {
              operationsMoved(uri);
            }
          }
        }
        // A turn starting or finishing moves the catalogue too, and a client
        // watching only the list is the one that most needs telling.
        summaryMoved(uri);
        /*
         * And a finished turn is when the branch is worth asking about again:
         * the agent may have changed it, or somebody may have in a terminal.
         *
         * The machine's own commits first, where the session is in one: a
         * machine that commits in a git directory of its own leaves the host's
         * branch where it was until ahpd fetches, so the facts read after this
         * are the facts of a folder whose branch holds the turn's work -
         * decision `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
         * A session in no machine has nothing to fetch, and its facts are read
         * without waiting for an answer nobody was asked for.
         */
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          const dir = dirOf(uri);
          if (dir !== undefined) {
            if (enteredIn.get(uri) === undefined) refreshFacts(dir);
            else void bringBackOf(uri).then(() => { refreshFacts(dir); });
          }
        }
        // A turn starting or ending is the whole of what disables and re-enables
        // a changeset's operations, and it moves nothing inside the changeset
        // itself - so it has to be said here or it is never said.
        if (action.type === 'chat/turnStarted' || action.type === 'chat/turnComplete'
          || action.type === 'chat/turnCancelled') operationsMoved(uri);
        // And a move the agent asked for is made now, once its turn is over:
        // the one moment the backend can be started again without losing
        // anything.
        if ((action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error')
          && ctx.moving.get(uri)?.chat === chatUri) {
          const move = ctx.moving.get(uri) as Move;
          ctx.moving.delete(uri);
          void ctx.moveSession(uri, move).catch((error: unknown) => {
            log(`${uri} could not move to ${move.directory}: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      },
      /*
       * A file the agent is about to change, on its way to the changeset.
       *
       * The session says which file and when, because it is the thing that
       * can see its own tools; the source reads it, because it is the thing
       * with a filesystem. Neither has to know about the other. What the
       * session already holds of a side is passed on, and what the source
       * answers for is returned, so a `before` is read before the write that
       * would truncate the file out from under it.
       */
      onFileEdit: (turnId, path, phase, text) => {
        const dir = dirOf(uri);
        if (dir === undefined) return;
        return options.changes?.observe?.(dir, uri, turnId, path, phase, text);
      },
      /*
       * A file a person is being asked about, on its way to the same source.
       *
       * The other direction of the seam above: this is a call the agent has
       * not run, so the source reads the file and keeps the text the tool
       * would leave rather than recording a side of a change already made.
       * The session names the call; the source mints the URI the client reads
       * it from, because the URI is the source's own scheme.
       *
       * Nothing where this session has no folder, which is the folder the
       * previews would be of. A session running in a computer is the same
       * case the changeset is: this source reads the daemon's own disk.
       */
      onEditProposed: (toolCallId, path, apply) => {
        const dir = dirOf(uri);
        if (dir === undefined) return undefined;
        return options.changes?.propose?.(dir, uri, toolCallId, path, apply);
      },
      onEditSettled: (toolCallId) => {
        options.changes?.settle?.(uri, toolCallId);
      },
      /*
       * A turn the backend has written under an id of its own.
       *
       * What the host keeps against a turn is kept against the id the client
       * chose it by, and a backend whose transcript names turns its own way -
       * Claude names every turn by the CLI's frame uuid - is read back by that
       * other id after a restart, finding nothing. So the sender is kept under
       * it as well, rather than the host learning one backend's transcript
       * format: decision
       * `a-backend-says-which-transcript-id-a-turn-was-written-as`.
       *
       * The in-memory entry first, because a turn still running is only in
       * that map, and the store after it for the turn a backend names once
       * the turn is over. Nothing where the two ids agree, which is every
       * backend that keeps the ids it was given, and nothing where nobody sent
       * the turn.
       */
      onTurnRecorded: (turnId, transcriptId) => {
        if (transcriptId === turnId) return;
        const sender = senderOf(turnId) ?? kept.sender(idOf(uri), turnId);
        if (sender !== undefined) kept.setSender(idOf(uri), transcriptId, sender);
      },
      onHandshake: () => { learnModels(uri); },
    });
    const held = sessions.get(uri) ?? {
      agent,
      chats: new Map<string, Session>(),
      defaultChat: chatUri,
      config,
      workingDirectory,
      additional,
      // The catalogue's value for a session being resumed; now, for one being
      // started. A second chat in a session that already exists takes the
      // session's own, because `sessions.get` answered above.
      createdAt: births.get(uri) ?? new Date().toISOString(),
    };
    // Said back to the catalogue, so a row listed after this agrees with the
    // session channel about when it began.
    births.set(uri, held.createdAt);
    held.chats.set(chatUri, session);
    sessions.set(uri, held);
    /*
     * Written down, in the one place every road to a running backend goes
     * through.
     *
     * The store is what knows a session's chats: which session a chat's own
     * URI belongs to, which of them a client gets when it names none, and what
     * a restart starts again. The backend id is the one this start was handed,
     * and the session's own id for the chat that is the session - until the
     * backend answers with its own, which the chat's own emit records.
     */
    ctx.keepChat(uri, chatUri, chatId ?? idOf(uri), held.defaultChat === chatUri);
    /*
     * The name it had before, when it is being created again.
     *
     * A chat's title is its own and the catalogue's is derived, so the store
     * is what remembers it across a restart. Applied here, before the chat is
     * announced or handed to a backend, so a client never sees the derived
     * name first and then a correction.
     */
    const named_ = titleOf(uri, chatUri);
    if (named_ !== undefined) session.setTitle?.(named_);
    // The name it is held under, which is its provider's. Recorded so every
    // other answer about it uses that same string.
    names.set(idOf(uri), uri);
    byChat.set(chatUri, { uri, chat: session });
    /*
     * The draft somebody left on this chat before it was running.
     *
     * Handed over rather than dropped: it was typed into this conversation,
     * and a session that loses it on the way to starting is one that ate what
     * was in the composer.
     */
    const typed = drafts.get(chatUri);
    if (typed !== undefined) {
      drafts.delete(chatUri);
      session.setDraft(typed);
    }
    owners.set(uri, agent);
    /*
     * The machine this session is now running in, told to the plugin that owns
     * it.
     *
     * Here rather than in each caller, because `spawn` is the one place every
     * road to a running backend goes through: a session created, one resumed
     * from the list after a daemon restart, a restart, a chat started again, a
     * fork and a truncate all call it, and a disposable machine whose last
     * session has left is waiting out its delay. A road that reached a backend
     * without saying so would have its machine removed under it.
     */
    const inside = computerId(config.computer);
    if (inside !== undefined) {
      inMachine(inside, uri, true);
      enteredIn.set(uri, inside);
    }
    /*
     * A nested session's record, which is what lists it after a restart: its
     * transcript is in the machine and no backend here can list it.
     */
    if (used !== agent && inside !== undefined) {
      const id = idOf(uri);
      const was = kept.nested?.(id);
      const now = new Date().toISOString();
      kept.setNested?.(id, {
        provider: agent.provider,
        machine: inside,
        inner: resuming?.resume ?? id,
        title: named_ ?? was?.title ?? session.title(),
        createdAt: was?.createdAt ?? now,
        modifiedAt: now,
        workingDirectories: workingDirectory !== undefined ? [uriOf(workingDirectory)] : was?.workingDirectories ?? [],
      });
    }
    return session;
  };

  return {
    absorb, unstamped, withWorkerUri, stampedCalls, withSender,
    sendSubagent, describedSub, endedWorkers,
    openSubagent, formerChatUri, titleOf, keepTitle, keepProvider,
    spawn,
  };
}