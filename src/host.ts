/**
 * The protocol server: channels, subscriptions, requests and state actions.
 *
 * One host serves many connections. It owns the session catalogue, the live
 * sessions and the sequence number that orders everything it emits.
 *
 * Rules that govern anything answering AHP:
 *
 * - `serverSeq` advances when state changes, not per message. A snapshot is
 *   taken at a sequence number and every action after it carries a greater
 *   one, which is how a client knows it missed nothing.
 * - Notifications carry no id and get no reply. `unsubscribe` and
 *   `dispatchAction` are notifications.
 * - Subscriptions are per connection. Dropping one client's subscription must
 *   not affect another's.
 * - Only client-dispatchable actions are accepted from clients; the rest are
 *   the host reporting what it did.
 */

import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { RpcError, METHOD_NOT_FOUND } from './rpc.js';
import { idFor, idOf, uriFor, Status } from './catalog.js';
import { tail, older } from './transcript.js';
import type { Connection, Host, HostOptions } from './types/host.js';
import type { Summary } from './types/catalog.js';
import type { Agent } from './types/agent.js';
import type { Bag } from './types/common.js';
import type { Session } from './types/session.js';
import type { Peer } from './types/rpc.js';

const ROOT = 'ahp-root://';

export function createHost(options: HostOptions): Host {
  const dir = options.path;
  /**
   * The backends this host serves, by the id clients name.
   *
   * A host with two answers `createSession` for either and lists both
   * catalogues as one. Nothing below here knows what any of them are.
   */
  const agents = new Map<string, Agent>();
  for (const agent of options.agents) {
    if (agents.has(agent.provider)) {
      throw new Error(`Two agents both call themselves ${agent.provider}`);
    }
    agents.set(agent.provider, agent);
  }
  const first = options.agents[0];
  if (!first)
    throw new Error('A host with no agents can serve nothing. Pass at least one.');
  const connections = new Set<Connection>();
  /**
   * `IsRead` and `IsArchived`, per session.
   *
   * The client flags, and unlike the in-process host these genuinely belong
   * here: a flag one client sets is a flag every other client has to see, and
   * that is exactly what having a host buys.
   */
  const flags = new Map<string, number>();
  /** Live sessions, by their own uri, and the chats that belong to them. */
  const sessions = new Map<string, Session>();
  /**
   * Which backend a session belongs to, by session URI.
   *
   * Kept for live ones as they are started and for browsed ones as they are
   * listed: the URI says nothing about who owns it, and everything answered
   * about a session - its schema, its transcript, the process that continues
   * it - is that backend's answer rather than the host's.
   */
  const owners = new Map<string, Agent>();
  /** Where a browsed session ran, as its own catalogue reported it. */
  const wheres = new Map<string, string[]>();
  /**
   * Config chosen for a session that has no agent running.
   *
   * A row read from its transcript is configurable before it is resumed, and
   * this is where the answers wait. Most of what the schema offers is fixed
   * when the query is built, so a session resumed without them is one that can
   * never be given them - which made "plan only" unofferable on exactly the
   * sessions somebody is deciding whether to continue.
   */
  const chosen = new Map<string, Record<string, string>>();
  const byChat = new Map<string, Session>();
  /**
   * What one backend turned out to offer.
   *
   * Advertised on the *root* channel, but only a live backend can enumerate
   * it - so it is empty until its probe answers, and that emptiness is a real
   * answer rather than a loading state. When it fills, every client watching
   * the root is told with `root/agentsChanged`.
   */
  interface Learned {
    /** Models a turn can run on. */
    models: { id: string; name: string }[];
    /** What a slash offers when no session of this backend is running. */
    commands: { name: string; description?: string; argumentHint?: string }[];
    /**
     * Skills, commands, subagents and MCP servers, as the probe found them.
     *
     * What every new session reports until its own backend answers. That takes
     * several seconds, and a client asks once - so a session that started
     * empty stayed empty for anyone who looked before the reply landed.
     */
    seeds: Bag[];
  }
  const learned = new Map<string, Learned>();
  const about = (provider: string): Learned => {
    const held = learned.get(provider);
    if (held) return held;
    const made: Learned = { models: [], commands: [], seeds: [] };
    learned.set(provider, made);
    return made;
  };
  let serverSeq = 0;
  /**
   * How many actions to keep for a client that comes back.
   *
   * A number, because the alternative is a buffer that grows for the length
   * of the daemon's life. Past it, a returning client is handed fresh
   * snapshots instead - which is correct, only more expensive, and is what
   * the protocol has the second reconnect result for.
   */
  const REPLAY = 1000;
  /** The last `REPLAY` action envelopes, oldest first. */
  const replayable: { channel: string; action: Record<string, unknown>; serverSeq: number; origin: undefined }[] = [];
  const log = (message: string): void => options.onEvent?.(message);
  /**
   * A session's status, with the client flags folded in.
   *
   * Activity is the session's own; `IsRead` and `IsArchived` are this host's,
   * and every answer carrying a status has to carry both halves or a row goes
   * back to unread the moment anything else about it changes.
   */
  const statusOf = (uri: string): number => {
    const session = sessions.get(uri);
    return (session ? session.status() : Status.Idle) | (flags.get(uri) ?? 0);
  };
  /** Everything watching a channel, which is not everything connected. */
  const broadcast = (channel: string, method: string, params: unknown): void => {
    for (const connection of connections) {
      if (!connection.watching.has(channel))
        continue;
      connection.peer.notify(method, params);
    }
  };
  /**
   * One state action, to everyone watching that channel.
   *
   * `serverSeq` moves here and only here. A snapshot is taken *at* a sequence
   * number and every action after it carries a greater one, which is how a
   * client knows it missed nothing - so the counter has to advance with state,
   * never with messages.
   */
  const dispatch = (channel: string, action: Record<string, unknown>): void => {
    serverSeq += 1;
    const envelope = { channel, action, serverSeq, origin: undefined };
    // Kept whether or not anyone was listening: a client that dropped is by
    // definition not listening, and it is the one that will ask for these.
    replayable.push(envelope);
    if (replayable.length > REPLAY) replayable.shift();
    broadcast(channel, 'action', envelope);
  };
  /** The catalogue moved. Carries no payload: `listSessions` is how you read it. */
  const catalogueMoved = (uri: string, method: string): void => {
    const session = sessions.get(uri);
    broadcast(ROOT, method, {
      channel: ROOT,
      resource: uri,
      ...(session
        ? {
          summary: {
            resource: uri,
            provider: owners.get(uri)?.provider ?? first.provider,
            title: session.title(),
            status: statusOf(uri),
            ...(session.activity() !== undefined ? { activity: session.activity() } : {}),
            createdAt: session.modifiedAt(),
            modifiedAt: session.modifiedAt(),
            workingDirectories: session.workingDirectories(),
          },
        }
        : {}),
    });
  };
  /**
   * Fill in the models, once there is a CLI to ask.
   *
   * Only when they actually change: `root/agentsChanged` on every handshake
   * would have every client re-reading the same list once per session created.
   */
  const learnModels = (uri: string): void => {
    const session = sessions.get(uri);
    const owner = owners.get(uri);
    if (!session || !owner)
      return;
    const found = session.models();
    if (found.length === 0)
      return;
    const held = about(owner.provider);
    const same = found.length === held.models.length
      && found.every((model, index) => model.id === held.models[index]?.id);
    if (same)
      return;
    held.models = found;
    log(`${owner.provider}: ${found.length} model(s): ${found.map((m) => m.id).join(', ')}`);
    dispatch(ROOT, { type: 'root/agentsChanged', agents: descriptors() });
  };
  /**
   * One CLI at startup, to learn what the harness offers.
   *
   * Fire and forget: nothing waits for it, and until it answers the models
   * are empty - which is the same real answer this host gives for a harness
   * nobody has signed into.
   */
  for (const agent of agents.values()) {
    if (!agent.probe)
      continue;
    void agent.probe().then((offered) => {
      const held = about(agent.provider);
      held.commands = offered.commands;
      held.seeds = offered.customizations;
      if (offered.models.length === 0)
        return;
      held.models = offered.models;
      log(`${agent.provider}: ${held.models.length} model(s), ${held.commands.length} command(s)`);
      dispatch(ROOT, { type: 'root/agentsChanged', agents: descriptors() });
    }).catch(() => { });
  }
  const spawn = (
    agent: Agent,
    uri: string,
    config: Record<string, string>,
    resuming?: { resume: string; seed: Bag[] },
    workingDirectory?: string,
  ): Session => {
    const chatUri = `ahp-chat:/${idFor(uri)}`;
    const session = agent.create({
      uri,
      chatUri,
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(resuming ? { resume: resuming.resume, seed: resuming.seed } : {}),
      settings: { ...agent.defaults(), ...config },
      schema: agent.schema,
      // What the boot probe already learned: the commands behind a slash, the
      // skills, the subagents and the MCP servers. A session that answered
      // `[]` until its own agent replied was empty for the first several
      // seconds - and a client that asks once and caches never found out
      // otherwise.
      seedCustomizations: about(agent.provider).seeds,
      emit: (channel, action) => {
        dispatch(channel === 'chat' ? chatUri : uri, action);
        // A turn starting or finishing moves the catalogue too, and a client
        // watching only the list is the one that most needs telling.
        catalogueMoved(uri, 'root/sessionSummaryChanged');
      },
      onHandshake: () => { learnModels(uri); },
    });
    sessions.set(uri, session);
    byChat.set(chatUri, session);
    owners.set(uri, agent);
    return session;
  };
  /**
   * Every backend, as the root channel advertises them.
   *
   * `models` is what its probe found, or empty for one that has not answered
   * yet - which is the same real answer a host gives for a harness nobody has
   * signed into.
   */
  const descriptors = () => [...agents.values()].map((agent) => ({
    provider: agent.provider,
    displayName: agent.displayName,
    ...(agent.description ? { description: agent.description } : {}),
    models: about(agent.provider).models,
  }));
  /**
   * The catalogue: what is on disk, and what this host is running.
   *
   * The two overlap and do not share a name. A client picks the session URI
   * before anything exists, the agent picks its own id when it starts, and the
   * transcript is written under the agent's - so a running session appears
   * twice, once as the channel being talked to and once as the file it is
   * writing. The live row wins and the file it claims is dropped: they are one
   * conversation, and the row somebody can open is the useful half.
   */
  const listing = async (): Promise<Summary[]> => {
    const claimed = new Set<string>();
    for (const [uri, session] of sessions) {
      claimed.add(idFor(uri));
      const own = session.agentId();
      if (own)
        claimed.add(own);
    }
    const found: Summary[] = [];
    for (const agent of agents.values()) {
      if (!agent.list)
        continue;
      // One backend refusing is not the catalogue refusing. The others still
      // have rows, and a list that failed because a second harness is not
      // signed in is a client that can open nothing.
      const rows = await agent.list().catch(() => []);
      for (const row of rows) {
        if (claimed.has(row.id))
          continue;
        const resource = uriFor(row.id);
        // Remembered as it is listed: opening a row asks its backend for the
        // transcript, and the URI says neither whose it is nor where it ran.
        owners.set(resource, agent);
        wheres.set(resource, row.workingDirectories);
        found.push({
          resource,
          provider: agent.provider,
          title: row.title,
          // Nothing this host started is running yet, so activity is idle and
          // the only bits set are the client's own.
          status: Status.Idle | (flags.get(resource) ?? 0),
          createdAt: row.createdAt,
          modifiedAt: row.modifiedAt,
          workingDirectories: row.workingDirectories,
        });
      }
    }
    // The protocol says a server SHOULD order them most-recently-modified
    // first, and a client that has to sort a list it was handed is a client
    // doing the server's job.
    found.sort((a_, b_) => b_.modifiedAt.localeCompare(a_.modifiedAt));
    // Sessions this host started are real and are not listed by a backend yet.
    // A catalogue that dropped them would lose the one being looked at.
    for (const [uri, session] of sessions) {
      found.unshift({
        resource: uri,
        provider: owners.get(uri)?.provider ?? first.provider,
        title: session.title(),
        status: statusOf(uri),
        // What it is doing, so a list of twenty sessions says which one is
        // busy with what rather than only which one is busy.
        ...(session.activity() !== undefined ? { activity: session.activity() } : {}),
        createdAt: session.modifiedAt(),
        modifiedAt: session.modifiedAt(),
        workingDirectories: session.workingDirectories(),
      });
    }
    return found;
  };
  const rootState = async () => ({
    agents: descriptors(),
    activeSessions: (await listing()).length,
  });
  /**
   * A session that already happened, read from its transcript.
   *
   * Cached, because a client subscribes to the session channel and then to the
   * chat channel and both want the same turns - reading the file twice per
   * open would be this host doing the same work to answer the same question.
   */
  const history = new Map();
  /**
   * The catalogue's own title, kept when a row is opened.
   *
   * Deriving one from the first message looks right and is not: a first
   * message routinely opens with editor context the person never typed, so
   * every row would be titled `<ide_opened_file>…`. The catalogue already
   * carries a real summary - the row and the session it opens should not
   * disagree about what the conversation is called.
   */
  const titles = new Map();
  const past = async (id: string): Promise<Bag[] | undefined> => {
    const held = history.get(id);
    if (held)
      return held;
    // The listing is what says whose session this is, so it is asked first.
    const found = await listing();
    const row = found.find((item) => idFor(item.resource) === id);
    const owner = owners.get(uriFor(id));
    if (!row || !owner?.transcript)
      return undefined;
    titles.set(id, row.title);
    const built = await owner.transcript(id);
    if (!built)
      return undefined;
    history.set(id, built);
    return built;
  };
  const snapshotOf = async (channel: string): Promise<Record<string, unknown>> => {
    if (channel === ROOT) {
      return { resource: ROOT, state: await rootState(), fromSeq: serverSeq };
    }
    const session = sessions.get(channel);
    if (session) {
      // The session reports its own activity; `IsRead` and `IsArchived` are
      // this host's and it has never heard of them.
      const state = { ...session.sessionState(), status: statusOf(channel) };
      return { resource: channel, state, fromSeq: serverSeq };
    }
    const chat = byChat.get(channel);
    if (chat)
      return { resource: channel, state: chat.chatState(), fromSeq: serverSeq };
    /*
     * A session in the catalogue that this host is not running.
     *
     * Served read-only from its transcript. No agent process is started until
     * somebody sends a turn to it.
     */
    const id = idOf(channel);
    const turns = await past(id);
    const owner = owners.get(uriFor(id)) ?? first;
    if (turns) {
      const title = titles.get(id) ?? 'Session';
      if (channel.startsWith('ahp-chat:/')) {
        return {
          resource: channel,
          state: {
            resource: channel,
            title,
            status: Status.Idle,
            modifiedAt: new Date().toISOString(),
            ...tail(turns),
            queuedMessages: [],
          },
          fromSeq: serverSeq,
        };
      }
      return {
        resource: channel,
        state: {
          resource: channel,
          provider: owner.provider,
          title,
          status: Status.Idle | (flags.get(`ahp-session:/${id}`) ?? 0),
          lifecycle: 'ready',
          defaultChat: `ahp-chat:/${id}`,
          chats: [{ resource: `ahp-chat:/${id}`, title }],
          workingDirectories: wheres.get(`ahp-session:/${id}`) ?? [`file://${dir}`],
          // What its backend offers, since nothing is running to say what this
          // session in particular was given.
          customizations: about(owner.provider).seeds,
          // The same schema a live session reports. Leaving it out drew no
          // controls at all on a browsed row - no permission mode, no effort -
          // which are the settings somebody wants *before* continuing one.
          config: {
            schema: owner.schema(),
            values: { ...owner.defaults(), ...(chosen.get(`ahp-session:/${id}`) ?? {}) },
          },
        },
        fromSeq: serverSeq,
      };
    }
    // Not running and not in the catalogue. Refusing is the honest answer and
    // the one a client already knows how to render - it is what a real host
    // says about a session whose agent has gone.
    throw new RpcError(-32001, `No agent for session ${channel}`);
  };
  return {
    connections: () => connections.size,
    accept(peer: Peer) {
      const connection = { peer, clientId: '', watching: new Set<string>() };
      connections.add(connection);
      const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
        /**
         * The handshake.
         *
         * Version negotiation is a *choice from what the client offered*, in
         * the client's own order of preference - not the newest either side
         * knows. A host that answers with a version the client did not offer
         * has answered with a version the client cannot read.
         */
        initialize: async (params) => {
          const offered = Array.isArray(params.protocolVersions)
            ? params.protocolVersions.filter((v) => typeof v === 'string')
            : [];
          const agreed = offered.find((version) => SUPPORTED_PROTOCOL_VERSIONS.includes(version));
          if (!agreed) {
            throw new RpcError(-32005, 'No protocol version in common', { supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
          }
          connection.clientId = typeof params.clientId === 'string' ? params.clientId : 'anonymous';
          const wanted = Array.isArray(params.initialSubscriptions)
            ? params.initialSubscriptions.filter((uri) => typeof uri === 'string')
            : [];
          const snapshots = [];
          for (const channel of wanted) {
            // A handshake that fails because one requested channel is gone is
            // a client that cannot connect at all. Take what can be taken.
            try {
              snapshots.push(await snapshotOf(channel));
              connection.watching.add(channel);
            }
            catch { /* not subscribed, and the client will be told if it asks */ }
          }
          log(`${connection.clientId} connected, speaking ${agreed}`);
          return {
            protocolVersion: agreed,
            serverSeq,
            serverInfo: { name: 'ahpd', version: '0.0.1' },
            snapshots,
            defaultDirectory: `file://${dir}`,
            // What the client should ask about rather than send. A slash is a
            // skill or a prompt the host contributed; an at-sign is a file.
            // Without this the client has no reason to believe either means
            // anything here, and types them into the chat as text.
            completionTriggerCharacters: ['/', '@'],
          };
        },
        ping: async () => ({}),
        /**
         * A client that dropped, coming back.
         *
         * `serverSeq` is what makes this answerable: it advances with state
         * and never with messages, so "everything after the last one I saw"
         * is a well-formed question. The subscriptions come from the client
         * because they were its own - this host forgot them when the
         * connection went.
         *
         * Two answers, and the difference is whether the gap still fits in
         * the buffer. Replay is cheap and exact; a snapshot is neither, and
         * is what an hour-long disconnection gets.
         */
        reconnect: async (params) => {
          const clientId = typeof params.clientId === 'string' ? params.clientId : connection.clientId;
          connection.clientId = clientId;
          const wanted = Array.isArray(params.subscriptions)
            ? params.subscriptions.filter((uri): uri is string => typeof uri === 'string')
            : [];
          const since = typeof params.lastSeenServerSeq === 'number' ? params.lastSeenServerSeq : 0;

          const missing: string[] = [];
          const resumed: string[] = [];
          for (const channel of wanted) {
            try {
              await snapshotOf(channel);
              connection.watching.add(channel);
              resumed.push(channel);
            }
            catch {
              // A session whose agent has gone, or one this client may no
              // longer see. Named, so the client drops it rather than waiting
              // on a channel that will never speak again.
              missing.push(channel);
            }
          }

          const oldest = replayable[0]?.serverSeq;
          // Nothing buffered means nothing has happened since, which is a
          // replay of nothing rather than a reason to re-snapshot.
          const replayable_ = oldest === undefined || since >= oldest - 1;
          if (replayable_) {
            log(`${clientId} came back at ${since}, replaying`);
            return {
              type: 'replay',
              actions: replayable.filter((held) => held.serverSeq > since
                && resumed.includes(held.channel)),
              missing,
            };
          }
          log(`${clientId} came back at ${since}, too far behind ${oldest} - snapshotting`);
          const snapshots = [];
          for (const channel of resumed) snapshots.push(await snapshotOf(channel));
          return { type: 'snapshot', snapshots };
        },
        subscribe: async (params) => {
          const channel = String(params.channel ?? '');
          const snapshot = await snapshotOf(channel);
          connection.watching.add(channel);
          return { snapshot };
        },
        /**
         * Older turns, on demand.
         *
         * The result is deliberately empty: the turns arrive as
         * `chat/turnsLoaded` on the channel, so every client watching the chat
         * gets the page - not only the one that asked for it. A host that
         * answered in the result would be telling one client something the
         * others would never learn.
         */
        fetchTurns: async (params) => {
          const channel = String(params.channel ?? '');
          const live = byChat.get(channel);
          const all = live ? live.allTurns() : await past(idOf(channel));
          if (!all)
            throw new RpcError(-32001, `No agent for session ${channel}`);
          const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
          // No cursor means "load whatever is next", which is the page before
          // the one the snapshot carried.
          const page = cursor === undefined
            ? older(all, String(tail(all).turnsNextCursor ?? 0))
            : older(all, cursor);
          if (!page) {
            // Guessing at a cursor this host did not issue would answer a
            // question about old turns with new ones, and the client would
            // page for ever without noticing.
            throw new RpcError(-32602, `Unrecognised cursor ${String(cursor)}`);
          }
          dispatch(channel, {
            type: 'chat/turnsLoaded',
            turns: page.turns,
            ...(page.turnsNextCursor ? { turnsNextCursor: page.turnsNextCursor } : {}),
          });
          return {};
        },
        /**
         * Completions for the text a person is composing.
         *
         * Answers `/` with the commands available to the session, or the
         * harness-wide list when it has none yet. `@` means a file and is not
         * served, so it returns nothing.
         */
        completions: async (params) => {
          if (String(params.kind ?? '') !== 'userMessage')
            return { items: [] };
          const text = String(params.text ?? '');
          const offset = typeof params.offset === 'number'
            ? Math.max(0, Math.min(params.offset, text.length))
            : text.length;
          // A slash at the start of a word, and nothing but word characters
          // since. A slash mid-sentence is a path, not a command.
          const found = /(?:^|\s)\/([\w:-]*)$/.exec(text.slice(0, offset));
          if (!found)
            return { items: [] };
          const typed = (found[1] ?? '').toLowerCase();
          const start = offset - typed.length - 1;
          const session = byChat.get(String(params.channel ?? ''))
            ?? sessions.get(String(params.channel ?? ''));
          // A live session's own list wins: two sessions in one directory can
          // be handed different things.
          const own = (session?.customizations() ?? [])
            // Skills as well as prompts, and not the ones the CLI keeps for
            // the agent: offering one it will refuse is worse than not
            // offering it.
            .filter((entry) => (entry.type === 'prompt' || entry.type === 'skill')
              && entry.disableUserInvocation !== true)
            .map((entry) => ({
            name: String(entry.name),
            description: typeof entry.description === 'string' ? entry.description : undefined,
            argumentHint: typeof entry.argumentHint === 'string' ? entry.argumentHint : undefined,
          }));
          /*
           * ...but an empty list means *not known yet*, not *none*.
           *
           * A session created a moment ago has not heard back from its
           * backend, and preferring its silence over the backend-wide list is
           * a slash menu that is empty for exactly as long as somebody is
           * likely to use it.
           *
           * With no session it is the root channel being asked, and the
           * answer is every backend's - narrowed to one when the client says
           * which provider it is composing for, because that is the only
           * thing that knows.
           */
          const named = String(params.provider ?? '');
          const wide = named !== '' && agents.has(named)
            ? about(named).commands
            : [...agents.keys()].flatMap((provider) => about(provider).commands);
          const offered = own.length > 0 ? own : wide;
          const matches = offered
            .filter((command) => command.name.toLowerCase().includes(typed))
            // What was typed a prefix of, first. A substring match is useful
            // and is not what somebody typing `de` is looking for.
            .sort((a, b) => {
            const rank = Number(b.name.toLowerCase().startsWith(typed))
              - Number(a.name.toLowerCase().startsWith(typed));
            return rank !== 0 ? rank : a.name.localeCompare(b.name);
          })
            /*
             * A menu's worth when something was typed; the list when nothing
             * was.
             *
             * A bare slash is a client asking what there is, and it may well
             * filter the answer itself rather than ask again per keystroke -
             * so truncating that to a screenful drops commands it would then
             * never offer, silently and always the same ones. A narrowing
             * query is the interactive case and stays bounded.
             */
            .slice(0, typed === '' ? 500 : 50);
          return {
            items: matches.map((command) => ({
              // The space only when it takes an argument: a trailing space on
              // a command that takes none is a character somebody deletes.
              insertText: command.argumentHint ? `/${command.name} ` : `/${command.name}`,
              rangeStart: start,
              rangeEnd: offset,
              attachment: {
                type: 'simple',
                label: `/${command.name}`,
                ...(command.description ? { modelRepresentation: command.description } : {}),
              },
            })),
          };
        },
        listSessions: async () => ({ items: await listing() }),
        /**
         * Start one.
         *
         * The **client** chooses the URI and sends it as `channel` - which is
         * what makes the session addressable before this host has answered, so
         * the client can subscribe to it without a round trip in between.
         */
        createSession: async (params) => {
          const uri = String(params.channel ?? '');
          if (!uri.startsWith('ahp-session:/')) {
            throw new RpcError(-32602, `${uri} is not a session URI`);
          }
          if (sessions.has(uri))
            throw new RpcError(-32003, `${uri} already exists`);
          const provider = String(params.provider ?? first.provider);
          const agent = agents.get(provider);
          if (!agent)
            throw new RpcError(-32002, `No provider called ${provider}`);
          const config = (typeof params.config === 'object' && params.config !== null
            ? params.config
            : {}) as Record<string, string>;
          /*
           * Where the client asked the agent to work.
           *
           * A list on the wire and one directory to a session, so the first is
           * the answer. `file://` comes off: everything below here deals in
           * paths, and a backend handed a URI would open a directory called
           * `file:`.
           */
          const asked = Array.isArray(params.workingDirectories)
            ? params.workingDirectories.find((entry) => typeof entry === 'string')
            : undefined;
          const where = typeof asked === 'string'
            ? asked.replace(/^file:\/\//, '')
            : undefined;
          let session;
          try {
            session = spawn(agent, uri, config, undefined, where);
          }
          catch (error) {
            // The backend's own words. It is the thing that knows which
            // directories it serves, and a refusal a client can read beats an
            // internal error it cannot.
            throw new RpcError(-32602, error instanceof Error ? error.message : String(error));
          }
          log(`created ${uri}${where ? ` in ${where}` : ''}`);
          // Ready, then announced. A client that hears about a session before
          // it can be subscribed to has been told about something that is not
          // there yet.
          dispatch(uri, { type: 'session/ready' });
          catalogueMoved(uri, 'root/sessionAdded');
          return {};
        },
        disposeSession: async (params) => {
          const uri = String(params.channel ?? '');
          const session = sessions.get(uri);
          if (!session)
            throw new RpcError(-32001, `No agent for session ${uri}`);
          session.close();
          sessions.delete(uri);
          byChat.delete(session.chatUri);
          // Every other client is told, because the session was theirs too.
          broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, resource: uri });
          log(`disposed ${uri}`);
          return {};
        },
        /**
         * The configuration a session would have, before one exists.
         *
         * Separate from a session's own config precisely because it has to be
         * answerable with no session: what a composer offers has to be
         * offerable before anything has been created.
         */
        /**
         * The schema, and what it defaults to.
         *
         * `schema`, not `properties` at the top level: a client reads
         * `result.schema.properties`, and putting them one level up draws no
         * controls at all - no permission mode, no model, no effort. Which is
         * exactly what it did.
         */
        resolveSessionConfig: async (params) => {
          const provider = String(params.provider ?? first.provider);
          const agent = agents.get(provider);
          if (!agent)
            throw new RpcError(-32002, `No provider called ${provider}`);
          const answered = (typeof params.config === 'object' && params.config !== null
            ? params.config
            : {}) as Record<string, string>;
          // Iterative, as a real host's is: what has been answered comes back
          // answered, so re-asking does not quietly undo a choice.
          return { schema: agent.schema(), values: { ...agent.defaults(), ...answered } };
        },
      };
      /** Notifications: no id, no answer, and that is the whole difference. */
      const notifications: Record<string, (params: Record<string, unknown>) => void> = {
        unsubscribe: (params) => {
          // This connection stops watching. Not the channel - doing that to
          // shed one consumer kills the stream the others are reading.
          connection.watching.delete(String(params.channel ?? ''));
        },
        /**
         * What the client says happened.
         *
         * Only the actions a client is *allowed* to originate: the rest are
         * this host telling clients what it did, and one arriving from a
         * client is a client lying about what happened. The protocol package
         * carries the authority - `IS_CLIENT_DISPATCHABLE` - and its own
         * docstring says servers should check it.
         */
        dispatchAction: (params) => {
          const channel = String(params.channel ?? '');
          const action = (typeof params.action === 'object' && params.action !== null
            ? params.action
            : {}) as Record<string, unknown>;
          const type = String(action.type ?? '');
          /*
           * The client flags, which are the host's to keep.
           *
           * Answered before anything looks for a running session, because
           * these are the two actions that are *about* a session nobody has
           * opened: marking a row read, or filing it away, is what somebody
           * does from the catalogue - and starting an agent to record a bit
           * would start one per row scrolled past.
           */
          if (type === 'session/isReadChanged' || type === 'session/isArchivedChanged') {
            const uri = `ahp-session:/${idOf(channel)}`;
            const bit = type === 'session/isReadChanged' ? Status.IsRead : Status.IsArchived;
            const on = type === 'session/isReadChanged'
              ? action.isRead === true
              : action.isArchived === true;
            const before = flags.get(uri) ?? 0;
            const after = on ? before | bit : before & ~bit;
            if (after === before)
              return;
            flags.set(uri, after);
            // Every client watching, and the catalogue: a flag one client sets
            // is a flag the others have to see, which is what having a host
            // for this buys over each client keeping its own.
            dispatch(uri, action);
            catalogueMoved(uri, 'root/sessionSummaryChanged');
            return;
          }
          const held = sessions.get(channel) ?? byChat.get(channel);
          /*
           * Config for a session with no agent yet: remembered, not refused.
           *
           * It is applied when the session is resumed, which is what makes the
           * controls on a browsed row mean something. Starting an agent here
           * instead would start one per setting somebody tried.
           */
          if (!held && type === 'session/configChanged') {
            const uri = `ahp-session:/${idOf(channel)}`;
            const config = (typeof action.config === 'object' && action.config !== null
              ? action.config
              : {}) as Record<string, unknown>;
            const kept = { ...chosen.get(uri) };
            for (const [key, value] of Object.entries(config)) kept[key] = String(value);
            chosen.set(uri, kept);
            dispatch(uri, action);
            return;
          }
          /*
           * A turn on a session this host is not running yet.
           *
           * This is where browsing becomes continuing: the row was readable
           * from its transcript, and saying something is what makes it worth
           * a subprocess. Resumed rather than replayed - the agent gets the
           * context it built before, not a transcript it has been shown.
           */
          if (!held && type === 'chat/turnStarted') {
            const id = idOf(channel);
            void (async () => {
              const seed = await past(id);
              if (!seed) {
                log(`turn on unknown ${channel}`);
                return;
              }
              const uri = `ahp-session:/${id}`;
              // `past` is what learned whose session this is.
              const owner = owners.get(uri);
              if (!owner) {
                log(`no backend owns ${channel}`);
                return;
              }
              // Back where it ran. A session continued in another directory is
              // a conversation whose second half cannot see the files its
              // first half was about.
              const ran = wheres.get(uri)?.[0]?.replace(/^file:\/\//, '');
              const session = spawn(owner, uri, chosen.get(uri) ?? {}, { resume: id, seed }, ran);
              log(`resumed ${uri}`);
              dispatch(uri, { type: 'session/ready' });
              catalogueMoved(uri, 'root/sessionSummaryChanged');
              const message = (typeof action.message === 'object' && action.message !== null
                ? action.message
                : {}) as Record<string, unknown>;
              session.begin(String(action.turnId ?? ''), String(message.text ?? ''), typeof message.model === 'string' ? message.model : undefined);
            })();
            return;
          }
          const session = held;
          if (!session) {
            log(`dispatchAction ${type} on unknown ${channel}`);
            return;
          }
          switch (type) {
            case 'chat/turnStarted': {
              const message = (typeof action.message === 'object' && action.message !== null
                ? action.message
                : {}) as Record<string, unknown>;
              session.begin(String(action.turnId ?? ''), String(message.text ?? ''), typeof message.model === 'string' ? message.model : undefined);
              break;
            }
            /**
             * One key, merged.
             *
             * The action carries only what changed, so writing the whole
             * object back would revert whatever another client set while this
             * one had the form open.
             */
            case 'session/configChanged': {
              const config = (typeof action.config === 'object' && action.config !== null
                ? action.config
                : {}) as Record<string, unknown>;
              for (const [key, value] of Object.entries(config)) {
                if (key === 'permissionMode') {
                  // Confirmed, like every other key here. Applying it in
                  // silence leaves each client showing whatever it last chose
                  // for itself, and the two disagree the moment there are two.
                  if (session.setPermissionMode(String(value))) {
                    dispatch(session.uri, { type: 'session/configChanged', config: { permissionMode: String(value) } });
                  }
                  else {
                    log(`the CLI has no permission mode called ${String(value)}`);
                  }
                  continue;
                }
                if (key === 'model') {
                  void session.setModel(String(value)).then((took) => {
                    if (took)
                      dispatch(session.uri, { type: 'session/configChanged', config: { model: String(value) } });
                    else
                      log(`the CLI would not take model ${String(value)}`);
                  });
                  continue;
                }
                if (key === 'effortLevel') {
                  if (session.setEffort(String(value))) {
                    dispatch(session.uri, { type: 'session/configChanged', config: { effortLevel: String(value) } });
                  }
                  continue;
                }
                if (key === 'thinking') {
                  // Immutable, and said so rather than accepted and dropped: a
                  // control that reports success and changes nothing is worse
                  // than one that refuses.
                  log('thinking is fixed when the session is created');
                  continue;
                }
                log(`config key ${key} is not served yet`);
              }
              break;
            }
            case 'chat/turnCancelled':
              session.cancel(String(action.turnId ?? ''));
              break;
            /**
             * Say it after the turn that is running.
             *
             * The queue is the host's, which is the whole difference between a
             * queue and a list: it starts the next turn from the head the
             * moment it goes idle, and every client watching the chat sees the
             * same one. Held in a client it would never be sent - nothing
             * there is watching for a turn to end.
             */
            case 'chat/pendingMessageSet': {
              const kind = String(action.kind ?? 'queued');
              if (kind !== 'queued') {
                // Steering is injected *into* the running turn. The SDK has
                // nowhere to put one, and queueing it behind the turn it was
                // meant for would deliver it to the wrong conversation.
                log(`${kind} messages are not served yet`);
                break;
              }
              const message = (typeof action.message === 'object' && action.message !== null
                ? action.message
                : {}) as Record<string, unknown>;
              const model = (typeof message.model === 'object' && message.model !== null
                ? message.model
                : {}) as Record<string, unknown>;
              session.queue(
                String(action.id ?? ''),
                String(message.text ?? ''),
                typeof model.id === 'string' ? model.id : undefined,
              );
              break;
            }
            /**
             * Turn a skill or an MCP server on or off.
             *
             * `enablement` carries a decision per scope - global, workspace,
             * session - and this host has one scope, so the session's is the
             * one that matters and anything else is a decision about machines
             * it does not own.
             */
            case 'session/customizationToggled': {
              const id = String(action.id ?? '');
              const enablement = Array.isArray(action.enablement) ? action.enablement.map((entry) => (
                typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}
              )) : [];
              const wanted = enablement.find((entry) => entry.kind === 'session') ?? enablement[0];
              const enabled = wanted?.enabled !== false;
              void session.setCustomizationEnabled(id, enabled).then((took) => {
                if (took)
                  return;
                // Said, not swallowed. The customization list is what a client
                // draws the switch from, so re-reporting it puts the switch
                // back where it was rather than leaving it showing a change
                // that did not happen.
                log(`${id} has no runtime switch`);
                dispatch(session.uri, { type: 'session/customizationsChanged', customizations: session.customizations() });
              });
              break;
            }
            case 'session/mcpServerStartRequested':
              void session.startMcpServer(String(action.id ?? '')).then((took) => {
                if (!took) log(`${String(action.id ?? '')} would not start`);
              });
              break;
            case 'session/mcpServerStopRequested':
              void session.stopMcpServer(String(action.id ?? '')).then((took) => {
                if (!took) log(`${String(action.id ?? '')} would not stop`);
              });
              break;
            case 'chat/pendingMessageRemoved':
              session.unqueue(String(action.id ?? ''));
              break;
            case 'chat/queuedMessagesReordered':
              session.reorder(Array.isArray(action.order)
                ? action.order.filter((id): id is string => typeof id === 'string')
                : []);
              break;
            case 'chat/toolCallConfirmed':
              session.confirm(String(action.toolCallId ?? ''), action.approved === true);
              break;
            case 'chat/inputCompleted':
              session.answer(String(action.requestId ?? action.id ?? ''), action.accepted !== false, (typeof action.answers === 'object' && action.answers !== null
                ? action.answers
                : {}) as Record<string, unknown>);
              break;
            default:
              log(`dispatchAction ${type} is not served yet`);
          }
        },
      };
      return {
        async handle(request) {
          const notify = notifications[request.method];
          if (notify) {
            notify(request.params);
            return undefined;
          }
          const handler = handlers[request.method];
          if (!handler) {
            // Said, not silently accepted. A host that answers an empty
            // success to a method it does not have leaves the client waiting
            // for state that is never coming.
            throw new RpcError(METHOD_NOT_FOUND, `This host does not serve ${request.method} yet`);
          }
          return handler(request.params);
        },
        close() {
          connections.delete(connection);
          log(`${connection.clientId || 'a client'} went away`);
        },
      };
    },
  };
}
export { ROOT, type Summary };
