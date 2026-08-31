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
import { RpcError, INTERNAL_ERROR, METHOD_NOT_FOUND } from './rpc.js';
import { idFor, idOf, uriFor, Status } from './catalog.js';
import { tail, older } from './transcript.js';
import type { Terminal } from './types/terminals.js';
import type { Connection, Host, HostOptions } from './types/host.js';
import type { Summary } from './types/catalog.js';
import type { Agent } from './types/agent.js';
import type { Bag } from './types/common.js';
import type { Session } from './types/session.js';
import type { Peer } from './types/rpc.js';

/** `file://` and a path. A string, so this file needs no filesystem to say it. */
const uriOf = (path: string): string => `file://${path}`;

/**
 * A port this host was not given.
 *
 * Refused the way anything else it does not have is refused, and with the same
 * words: a host without a filesystem does not serve `resourceRead`, and saying
 * so is what lets a client draw the screen it can rather than wait for one it
 * cannot.
 */
const need = <T>(port: T | undefined, method: string): T => {
  if (port === undefined)
    throw new RpcError(METHOD_NOT_FOUND, `This host does not serve ${method} yet`);
  return port;
};

const ROOT = 'ahp-root://';
/** The automation catalogue, which belongs to the host rather than to a session. */
const AUTOMATIONS = 'ahp-automations://';

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
  /**
   * Every directory any backend serves, plus the host's own.
   *
   * What a client may browse and read. Asked each time rather than captured,
   * because a backend may learn about a directory after this host started.
   */
  const browsable = (): string[] => {
    const found = new Set<string>([options.path]);
    for (const agent of options.agents) {
      for (const dir_ of agent.directories?.() ?? []) found.add(dir_);
    }
    return [...found];
  };
  const first = options.agents[0];
  if (!first)
    throw new Error('A host with no agents can serve nothing. Pass at least one.');
  const connections = new Set<Connection>();
  /**
   * The watches clients have asked for, by the channel each was given.
   *
   * The protocol ties a watch's life to its subscription - there is no dispose
   * command, and `unsubscribe` is the only handle a client needs - so this is
   * what `unsubscribe` and a dropped connection are checked against.
   */
  /**
   * Who is in each session, by session URI and then by client id.
   *
   * The protocol calls these `activeClients` and makes membership the host's
   * to keep: a client announces itself with `session/activeClientSet` and the
   * host takes it out again when the client unsubscribes or goes. Keyed by
   * `clientId` rather than by connection, because that is what the protocol
   * keys it by - a client that reconnects is the same client.
   */
  const presence = new Map<string, Map<string, Bag>>();

  const watches = new Map<string, {
    state: Bag;
    watcher: { close(): void };
    /** The connection that asked for it, which keeps it alive until it subscribes. */
    owner: Connection;
    /** Whether anybody has ever subscribed. Until they have, there is nothing to have stopped. */
    opened: boolean;
  }>();
  /**
   * `IsRead` and `IsArchived`, per session.
   *
   * The client flags, and unlike the in-process host these genuinely belong
   * here: a flag one client sets is a flag every other client has to see, and
   * that is exactly what having a host buys.
   */
  const flags = new Map<string, number>();
  /**
   * A live session: one or more chats, and what they all run on.
   *
   * The protocol's session is a *container*. It was one conversation here
   * because one backend session is one CLI, and the two were collapsed - so a
   * second chat had nowhere to go.
   */
  interface Held {
    /** The backend running it. */
    agent: Agent;
    /** Its chats, by URI, in the order they were opened. */
    chats: Map<string, Session>;
    /** Which of them a client gets when it names none. */
    defaultChat: string;
    /** Config in force. Every chat in the session runs on it. */
    config: Record<string, string>;
    /** Where they work, when the client named a directory. */
    workingDirectory: string | undefined;
  }
  /** Live sessions, by their own uri. */
  const sessions = new Map<string, Held>();
  /** Every chat, back to the session holding it. */
  const byChat = new Map<string, { uri: string; chat: Session }>();
  /**
   * One chat, as its session's catalogue lists it.
   *
   * A `ChatSummary` and not a name and a URI: `status` and `modifiedAt` are
   * required of one, and a client reducing its list against a partial row
   * gets one it cannot sort or draw a state for.
   */
  const chatSummary = (uri: string, chat: Session) => ({
    resource: uri,
    title: chat.title(),
    status: chat.status(),
    modifiedAt: chat.modifiedAt(),
    ...(chat.activity() !== undefined ? { activity: chat.activity() } : {}),
  });
  /** What each chat's summary last said, so an unchanged one is not re-sent. */
  const described = new Map<string, string>();
  /**
   * The chat a session-level question is really about.
   *
   * The default one: its status is the session's, its customizations are what
   * the session was handed, and it is the one a client talks to when it has
   * not asked for another.
   */
  const leadOf = (held: Held): Session | undefined => held.chats.get(held.defaultChat);
  /**
   * Which backend a session belongs to, by session URI.
   *
   * Kept for live ones as they are started and for browsed ones as they are
   * listed: the URI says nothing about who owns it, and everything answered
   * about a session - its schema, its transcript, the process that continues
   * it - is that backend's answer rather than the host's.
   */
  const owners = new Map<string, Agent>();
  /**
   * Terminals, by their own channel URI.
   *
   * The host's rather than a session's: a terminal outlives the turn that
   * opened it, several clients watch one, and the protocol lists them on the
   * *root* channel - which is where something owned by no session belongs.
   */
  const terminals = new Map<string, Terminal>();
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
    const held = sessions.get(uri);
    if (!held)
      return Status.Idle | (flags.get(uri) ?? 0);
    /*
     * The default chat's activity, promoted by any other chat that needs
     * something.
     *
     * The protocol's own rule: a session waiting on a person is waiting
     * whichever of its chats is doing the waiting, and a catalogue that only
     * looked at the default one would show a session as idle while another
     * chat in it is blocked.
     */
    let activity = leadOf(held)?.status() ?? Status.Idle;
    for (const chat of held.chats.values()) {
      const its = chat.status();
      if (its === Status.InputNeeded) activity = Status.InputNeeded;
      else if (its === Status.Error && activity !== Status.InputNeeded) activity = Status.Error;
    }
    return activity | (flags.get(uri) ?? 0);
  };
  /** The most recent change across a session's chats. */
  const modifiedOf = (held: Held): string => [...held.chats.values()]
    .map((chat) => chat.modifiedAt())
    .sort()
    .at(-1) ?? new Date().toISOString();
  /** What a session is doing: its default chat's, or whichever chat is waiting. */
  const activityOf = (held: Held): string | undefined => {
    for (const chat of held.chats.values()) {
      if (chat.status() === Status.InputNeeded) return chat.activity();
    }
    return leadOf(held)?.activity();
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
  /**
   * Let a watch go once nobody is listening to it.
   *
   * The protocol's rule, and it is a MUST: when every subscriber has
   * unsubscribed, or the connection drops, the watcher is released. Checked
   * against every connection rather than the one that just left, because two
   * clients may watch one channel and the second is still reading.
   *
   * The connection that *created* it counts even before it has subscribed:
   * `createResourceWatch` hands back a channel and the client subscribes after,
   * so releasing on "nobody is watching" alone would close every watch in the
   * gap between the two calls.
   */
  const releaseWatch = (channel: string): void => {
    const held = watches.get(channel);
    if (!held) return;
    for (const connection of connections) {
      if (connection.watching.has(channel)) return;
    }
    // Handed out and not yet subscribed to. Its owner is still here, so it is
    // still on its way to being watched rather than finished with.
    if (!held.opened && connections.has(held.owner)) return;
    held.watcher.close();
    watches.delete(channel);
    log(`released ${channel}`);
  };

  /** Who this session currently has in it. Always a list, because the field is required. */
  const activeClientsOf = (uri: string): Bag[] => [...(presence.get(uri)?.values() ?? [])];

  /**
   * Take a client out of a session, if nothing else is holding it there.
   *
   * The protocol names three ways this happens - unsubscribe, disconnect
   * without reconnecting, reconnect without resubscribing - and they are the
   * same condition seen from three places: no connection with that client id
   * is watching that session any more. Checked rather than assumed, because
   * one person can have two windows open on one session and closing the first
   * must not remove them from it.
   */
  const leaves = (uri: string, clientId: string): void => {
    const held = presence.get(uri);
    if (!held?.has(clientId)) return;
    for (const connection of connections) {
      if (connection.clientId === clientId && connection.watching.has(uri)) return;
    }
    held.delete(clientId);
    if (held.size === 0) presence.delete(uri);
    dispatch(uri, { type: 'session/activeClientRemoved', clientId });
  };

  /**
   * How many sessions this host is running, said when it changes.
   *
   * `sessions.size` and not the catalogue: the protocol asks for the active,
   * non-disposed sessions *on the server*, and a transcript on disk is a row
   * somebody can open rather than a session the host is holding. Reporting the
   * catalogue meant a host running nothing claimed a hundred.
   */
  let announced = -1;
  const activeSessionsMoved = (): void => {
    if (sessions.size === announced) return;
    announced = sessions.size;
    dispatch(ROOT, { type: 'root/activeSessionsChanged', activeSessions: sessions.size });
  };

  /** The catalogue moved. Carries no payload: `listSessions` is how you read it. */
  const catalogueMoved = (uri: string, method: string): void => {
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    broadcast(ROOT, method, {
      channel: ROOT,
      resource: uri,
      ...(held && lead
        ? {
          summary: {
            resource: uri,
            provider: held.agent.provider,
            title: lead.title(),
            status: statusOf(uri),
            ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
            createdAt: modifiedOf(held),
            modifiedAt: modifiedOf(held),
            workingDirectories: lead.workingDirectories(),
            ...describes(uri),
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
    const lead = session && leadOf(session);
    const owner = owners.get(uri);
    if (!lead || !owner)
      return;
    const found = lead.models();
    if (found.length === 0)
      return;
    const learnt = about(owner.provider);
    const same = found.length === learnt.models.length
      && found.every((model, index) => model.id === learnt.models[index]?.id);
    if (same)
      return;
    learnt.models = found;
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
  /*
   * Everything known about every directory served, before anything asks.
   *
   * A catalogue is drawn from a snapshot, and one taken before this had
   * answered would draw every row without its facts and only fill them in
   * when something else happened to move the row.
   */
  for (const dir_ of browsable()) {
    void options.directories?.refresh?.(dir_).catch(() => {});
    void options.changes?.refresh?.(dir_).catch(() => {});
  }

  /**
   * Say an automation moved, on whichever channel is about it.
   *
   * The store owns the clock and this owns the channels, so a run that started
   * on its own reaches a client only through here. Wired once at startup
   * rather than per request, because the interesting case is the one nobody
   * asked for.
   */
  options.automations?.onChanged?.((event) => {
    if (event.removed !== undefined) {
      dispatch(AUTOMATIONS, { type: 'automation/removed', resource: event.removed });
      return;
    }
    if (event.automation !== undefined) {
      const found = options.automations?.get(event.automation);
      if (found) dispatch(AUTOMATIONS, { type: 'automation/set', automation: found });
    }
    if (event.run !== undefined) {
      const run = options.automations?.runOf(event.run);
      if (!run) return;
      // Two channels, because they answer different questions: the run's own
      // says what it is doing, and the catalogue's says which session it is
      // doing it in.
      dispatch(event.run, { type: 'automationRun/lifecycleChanged', lifecycle: run.lifecycle });
      if (run.primarySession !== undefined) {
        dispatch(event.run, { type: 'automationRun/primarySessionChanged', primarySession: run.primarySession });
      }
    }
  });

  for (const agent of agents.values()) {
    if (!agent.probe)
      continue;
    void agent.probe().then((offered) => {
      const held = about(agent.provider);
      held.commands = offered.commands;
      held.seeds = offered.customizations;
      /*
       * An empty model list is kept out, and says nothing about the rest.
       *
       * A harness nobody has signed into enumerates no models and still has
       * skills and MCP servers, so the guard is on the assignment and not on
       * the announcement - the root channel has to hear about the
       * customizations either way, or the only client that ever sees them is
       * one that connected after the probe answered.
       */
      if (offered.models.length > 0) held.models = offered.models;
      log(`${agent.provider}: ${held.models.length} model(s), ${held.commands.length} command(s), ${held.seeds.length} customization(s)`);
      dispatch(ROOT, { type: 'root/agentsChanged', agents: descriptors() });
    }).catch(() => { });
  }
  /**
   * Start one chat, and the session holding it if there is not one yet.
   *
   * One backend session is one CLI, and a chat is one conversation, so a
   * second chat in a session is a second CLI on the same directory and the
   * same config - which is what makes them peers rather than one being the
   * other's child.
   */
  /**
   * The directory a session works in, as a path.
   *
   * Every description of a session wants it - the project name and the branch
   * both come from it - and the two places it is kept spell it as a `file://`
   * URI, which git and `basename` do not take.
   */
  const dirOf = (uri: string): string | undefined => {
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    const where = lead?.workingDirectories()[0] ?? wheres.get(uri)?.[0];
    return where?.replace(/^file:\/\//, '');
  };

  /**
   * What a session says about itself beyond the protocol's own fields.
   *
   * One helper for all four places a session is described - the live snapshot,
   * the browsed one, the catalogue row and the notification that moves it -
   * because a row and the session it opens disagreeing is the bug this is
   * meant to avoid.
   */
  /**
   * The changesets a session advertises, as catalogue entries.
   *
   * One builder, because there are two places that say them - a session's
   * state and the action that says they moved - and an entry that carried a
   * capability in one and not the other would be a client drawing a checkbox
   * that vanished when anything changed.
   */
  const catalogueOf = (uri: string, dir: string): Bag[] =>
    (options.changes?.scopes(dir, uri) ?? []).map((scope) => ({
      label: scope.label,
      uriTemplate: `${uri}/changeset/${scope.id}`,
      changeKind: scope.changeKind,
      ...(scope.description ? { description: scope.description } : {}),
      // A presence flag, and on the *catalogue* entry so a client can decide
      // whether to draw a checkbox before it subscribes to anything.
      ...(scope.reviewable ? { capabilities: { review: {} } } : {}),
    }));

  /**
   * What one changeset URI is a changeset *of*.
   *
   * `<sessionUri>/changeset/<scope>` split back into its two halves, which is
   * wanted in four places now. Undefined for a URI that is not one.
   */
  const changesetAt = (channel: string): { owner: string; scope: string; dir: string } | undefined => {
    const cut = channel.indexOf('/changeset/');
    if (cut <= 0) return undefined;
    const owner = channel.slice(0, cut);
    const dir = dirOf(owner);
    if (dir === undefined) return undefined;
    return { owner, scope: channel.slice(cut + '/changeset/'.length), dir };
  };

  /**
   * Invocations in flight, and the last one that failed.
   *
   * Keyed by changeset and operation, because status is per operation on a
   * changeset rather than per source: two clients looking at the same
   * changeset must see the same spinner, which is the whole reason the
   * protocol reflects an imperative call back into state.
   */
  const inFlight = new Set<string>();
  const lastError = new Map<string, string>();
  const opKey = (channel: string, id: string): string => `${channel}\u0000${id}`;

  /**
   * The operations a changeset offers, with the status the host owns.
   *
   * The source declares the verbs and this decides what may be pressed:
   * `Disabled` while the session is mid-turn, because the working tree is
   * being written by the agent and an operation that mutated it underneath
   * would race the thing that is doing the work; `Running` while an invocation
   * is out; `Error` carrying whatever the last one said.
   */
  const operationsOf = (channel: string): Bag[] => {
    const at = changesetAt(channel);
    if (!at) return [];
    const busy = (statusOf(at.owner) & Status.InProgress) !== 0;
    return (options.changes?.operations?.(at.dir, at.owner, at.scope) ?? []).map((operation) => {
      const key = opKey(channel, operation.id);
      const failure = lastError.get(key);
      const status = inFlight.has(key) ? 'running'
        : busy ? 'disabled'
          : failure !== undefined ? 'error'
            : 'idle';
      return {
        id: operation.id,
        label: operation.label,
        ...(operation.description !== undefined ? { description: operation.description } : {}),
        scopes: operation.scopes,
        ...(operation.confirmation !== undefined ? { confirmation: operation.confirmation } : {}),
        ...(operation.icon !== undefined ? { icon: operation.icon } : {}),
        ...(operation.group !== undefined ? { group: operation.group } : {}),
        status,
        ...(status === 'error' && failure !== undefined ? { error: { message: failure } } : {}),
      };
    });
  };

  /**
   * Say again what a session's changesets can be told to do.
   *
   * Sent on turn boundaries, because that is when the answer changes without
   * anything in a changeset's *content* moving: a turn starting disables every
   * operation on every changeset the session has, and nothing else would say
   * so. Only channels somebody is watching - a changeset nobody subscribed to
   * has no buttons on screen to correct.
   */
  const operationsMoved = (uri: string): void => {
    const done = new Set<string>();
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (!channel.startsWith(`${uri}/changeset/`) || done.has(channel)) continue;
        done.add(channel);
        const operations = operationsOf(channel);
        // `undefined` is how the protocol clears the list, and an operation
        // list that went from three to none is exactly that.
        dispatch(channel, {
          type: 'changeset/operationsChanged',
          ...(operations.length > 0 ? { operations } : {}),
        });
      }
    }
  };

  /**
   * The changesets themselves, after something wrote to the tree.
   *
   * `changeset/contentChanged` rather than a fresh snapshot: a client watching
   * a changeset is holding a file list, and an operation that reverted one
   * file has changed that list - which nothing else here says, because the
   * catalogue action carries the *set* of changesets a session offers and not
   * what is in any of them.
   */
  const contentMoved = async (uri: string): Promise<void> => {
    const done = new Set<string>();
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (!channel.startsWith(`${uri}/changeset/`) || done.has(channel)) continue;
        done.add(channel);
        const at = changesetAt(channel);
        if (!at) continue;
        const state = await options.changes?.state(at.dir, at.owner, at.scope);
        if (!state) continue;
        const operations = operationsOf(channel);
        dispatch(channel, {
          type: 'changeset/contentChanged',
          files: state.files,
          ...(operations.length > 0 ? { operations } : {}),
        });
      }
    }
  };

  const describes = (uri: string): Bag => {
    const dir = dirOf(uri);
    if (dir === undefined) return {};
    /*
     * The project's name is the directory's own, not its path.
     *
     * A catalogue of sessions across several repositories is read by which
     * repository each row is in, and every row spelling out
     * `/home/somebody/work/…` differs only in the part that scrolls off. Done
     * here rather than with `basename` because it is a string and this file
     * is the protocol.
     */
    const project = { uri: `file://${dir}`, displayName: dir.split('/').filter(Boolean).pop() ?? dir };
    // Anything past the path is the host's to be told, not this file's to go
    // and find - `git` is a binary, and a host may be given none.
    const meta = options.directories?.meta(dir);
    // The changesets this session can be asked about, as URIs a client
    // subscribes to. A template with no variables in it is the whole scope;
    // the ones with `{turnId}` are not served yet.
    const changesets = catalogueOf(uri, dir);
    const summary = options.changes?.summary(dir);
    return {
      project,
      ...(meta ? { _meta: meta } : {}),
      ...(changesets.length > 0 ? { changesets } : {}),
      ...(summary?.files ? { changes: summary } : {}),
    };
  };

  /**
   * Ask git again, and tell everyone if the answer moved.
   *
   * A branch changes underneath a session - somebody checks one out in a
   * terminal - so it is re-read when a turn ends rather than only when a
   * session starts. `session/metaChanged` replaces `_meta` whole, which is
   * what `metaOf` writes.
   */
  const refreshFacts = (dir: string): void => {
    /** Every session in that directory, since a fact is the directory's. */
    const inThere = (): string[] => [...sessions.keys()].filter((uri) => dirOf(uri) === dir);

    void options.directories?.refresh?.(dir).then((moved) => {
      if (!moved) return;
      for (const uri of inThere()) {
        const meta = options.directories?.meta(dir);
        dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
        catalogueMoved(uri, 'root/sessionSummaryChanged');
      }
    }).catch(() => {});

    /*
     * And what it changed.
     *
     * The catalogue entry rather than the changeset itself: the protocol has
     * `session/changesetsChanged` carry the *list* a session offers, and a
     * client that is watching one re-reads it from its own channel. Sending
     * the files here would be the same answer from two places.
     */
    void options.changes?.refresh?.(dir).then((moved) => {
      if (!moved) return;
      for (const uri of inThere()) {
        // Asked per session, because two of the scopes are the session's own.
        dispatch(uri, { type: 'session/changesetsChanged', changesets: catalogueOf(uri, dir) });
        catalogueMoved(uri, 'root/sessionSummaryChanged');
      }
    }).catch(() => {});
  };

  const spawn = (
    agent: Agent,
    uri: string,
    chatUri: string,
    config: Record<string, string>,
    resuming?: { resume: string; seed: Bag[] },
    workingDirectory?: string,
  ): Session => {
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
        /*
         * The session's list of chats, when one of them has moved.
         *
         * Only on a change: a chat says something on every delta, and a
         * summary re-sent per token is a list redrawn per token.
         */
        const moved = sessions.get(uri)?.chats.get(chatUri);
        if (moved) {
          const now = `${moved.title()}\u0000${String(moved.status())}\u0000${String(moved.activity() ?? '')}`;
          if (now !== described.get(chatUri)) {
            described.set(chatUri, now);
            dispatch(uri, { type: 'session/chatUpdated', chat: chatUri, changes: chatSummary(chatUri, moved) });
          }
        }
        // A turn starting or finishing moves the catalogue too, and a client
        // watching only the list is the one that most needs telling.
        catalogueMoved(uri, 'root/sessionSummaryChanged');
        // And a finished turn is when the branch is worth asking about again:
        // the agent may have changed it, or somebody may have in a terminal.
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          const dir = dirOf(uri);
          if (dir !== undefined) refreshFacts(dir);
        }
        // A turn starting or ending is the whole of what disables and re-enables
        // a changeset's operations, and it moves nothing inside the changeset
        // itself - so it has to be said here or it is never said.
        if (action.type === 'chat/turnStarted' || action.type === 'chat/turnComplete'
          || action.type === 'chat/turnCancelled') operationsMoved(uri);
      },
      /*
       * A file the agent is about to change, on its way to the changeset.
       *
       * The session says which file and when, because it is the thing that
       * can see its own tools; the source reads it, because it is the thing
       * with a filesystem. Neither has to know about the other.
       */
      onFileEdit: (turnId, path, phase) => {
        const dir = dirOf(uri);
        if (dir === undefined) return;
        options.changes?.observe?.(dir, uri, turnId, path, phase);
      },
      onHandshake: () => { learnModels(uri); },
    });
    const held = sessions.get(uri) ?? {
      agent,
      chats: new Map<string, Session>(),
      defaultChat: chatUri,
      config,
      workingDirectory,
    };
    held.chats.set(chatUri, session);
    sessions.set(uri, held);
    byChat.set(chatUri, { uri, chat: session });
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
    /*
     * The skills, subagents and MCP servers, before any session exists.
     *
     * The protocol puts them here as well as on a session - `AgentInfo` has a
     * `customizations` list, and says a session created with this agent gets
     * these entries augmented and propagated into its own. So a client can
     * show what a harness offers without creating a session to ask, which is
     * exactly when somebody wants to know: the new-session screen is where a
     * person picks a skill to open with.
     *
     * The same list a session is seeded from, deliberately: two answers to
     * "what does this harness offer" that could disagree is worse than one
     * answer that arrives a moment after boot.
     */
    ...(about(agent.provider).seeds.length > 0
      ? { customizations: about(agent.provider).seeds }
      : {}),
    capabilities: {
      /*
       * Several chats per session, and neither of the source modes.
       *
       * Multi-chat is the host's doing rather than a backend's - a second
       * chat is `create` called twice - so it holds for any backend. `fork`
       * and `sideChat` both need a backend that can resume at a *turn*, and
       * an empty object is the protocol's way of saying multi-chat without
       * them.
       */
      multipleChats: {},
    },
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
    for (const [uri, held] of sessions) {
      claimed.add(idFor(uri));
      for (const chat of held.chats.values()) {
        const own = chat.agentId();
        if (own)
          claimed.add(own);
      }
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
          ...describes(resource),
        });
      }
    }
    // The protocol says a server SHOULD order them most-recently-modified
    // first, and a client that has to sort a list it was handed is a client
    // doing the server's job.
    found.sort((a_, b_) => b_.modifiedAt.localeCompare(a_.modifiedAt));
    // Sessions this host started are real and are not listed by a backend yet.
    // A catalogue that dropped them would lose the one being looked at.
    for (const [uri, held] of sessions) {
      const lead = leadOf(held);
      if (!lead)
        continue;
      found.unshift({
        resource: uri,
        provider: held.agent.provider,
        title: lead.title(),
        status: statusOf(uri),
        // What it is doing, so a list of twenty sessions says which one is
        // busy with what rather than only which one is busy.
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
        createdAt: modifiedOf(held),
        modifiedAt: modifiedOf(held),
        workingDirectories: lead.workingDirectories(),
        ...describes(uri),
      });
    }
    return found;
  };
  /** Every terminal, as the root channel lists them. */
  const terminalInfo = () => [...terminals.values()].map((held) => ({
    resource: held.uri,
    title: held.title(),
    claim: held.claim(),
    ...(held.exitCode() !== undefined ? { exitCode: held.exitCode() } : {}),
  }));
  const rootState = async () => ({
    agents: descriptors(),
    // What this host is running, not what is on disk beside it.
    activeSessions: sessions.size,
    ...(terminals.size > 0 ? { terminals: terminalInfo() } : {}),
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
    const terminal = terminals.get(channel);
    if (terminal)
      return { resource: channel, state: terminal.state(), fromSeq: serverSeq };
    /*
     * A changeset, which lives under the session it belongs to.
     *
     * `<sessionUri>/changeset/<scope>`. Nested on purpose: disposing a session
     * tears down every changeset it had by string-prefix scan, and the reverse
     * lookup - which session is this - is the same scan.
     */
    if (channel === AUTOMATIONS) {
      return {
        resource: channel,
        state: { entries: need(options.automations, 'the automations channel').list() },
        fromSeq: serverSeq,
      };
    }
    if (channel.startsWith('ahp-automation-run:/')) {
      const found = options.automations?.runOf(channel);
      if (!found) throw new RpcError(-32001, `No automation run at ${channel}`);
      return { resource: channel, state: found, fromSeq: serverSeq };
    }
    const watching = watches.get(channel);
    if (watching) {
      // The state is what the watch *is*, not what it has seen. The protocol's
      // reducer keeps no history: `resourceWatch/changed` exists to deliver
      // events to whoever is subscribed, and a client that arrives later has
      // missed them the way it misses anything it was not there for.
      return { resource: channel, state: watching.state, fromSeq: serverSeq };
    }
    const at = changesetAt(channel);
    if (at) {
      /*
       * Asked again, here, because this is the moment somebody reads one.
       *
       * `git status` is cached per directory - a catalogue of a hundred rows
       * must not be a hundred `git` runs - and it used to be refreshed only
       * when a turn ended. That is right for what the *agent* did and wrong
       * for everything else: a person editing in an editor, a build writing
       * artefacts, a `git checkout` in a terminal this same host is serving.
       * All of it was invisible until the next turn finished, so a client that
       * opened a changeset in between was shown a working tree that had moved.
       *
       * Deliberately not a watcher for this. `fs.watch` recursive costs an
       * inotify handle per directory, and a host told to serve a home
       * directory would spend thousands of them before answering anything. A
       * client that wants to be *told* asks for `createResourceWatch` on a
       * path it names, which is what the protocol has for it; this is only
       * about the host's own cache being true at the moment it is read.
       */
      await options.changes?.refresh?.(at.dir).catch(() => false);
      const state = await options.changes?.state(at.dir, at.owner, at.scope);
      if (!state) throw new RpcError(-32001, `No changeset at ${channel}`);
      // The verbs, alongside the files. Omitted when there are none, which
      // the protocol asks for and which is what a changeset with nothing to
      // do to it says.
      const operations = operationsOf(channel);
      return {
        resource: channel,
        state: { ...state, ...(operations.length > 0 ? { operations } : {}) },
        fromSeq: serverSeq,
      };
    }
    const held = sessions.get(channel);
    const lead = held && leadOf(held);
    if (held && lead) {
      /*
       * The session's state, assembled here rather than asked of one chat.
       *
       * A session is a container: its title, config and customizations come
       * from the default chat, its status and activity from whichever chat is
       * driving them, its `modifiedAt` from the latest of all - and `chats` is
       * the list, which no single chat knows. `IsRead` and `IsArchived` are
       * this host's, and no chat has heard of them.
       */
      const state = {
        ...lead.sessionState(),
        ...describes(channel),
        // Required by the protocol and empty until somebody announces
        // themselves, which is a real answer: a session nobody has opened has
        // nobody in it.
        activeClients: activeClientsOf(channel),
        status: statusOf(channel),
        modifiedAt: modifiedOf(held),
        defaultChat: held.defaultChat,
        chats: [...held.chats].map(([uri_, chat_]) => chatSummary(uri_, chat_)),
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
      };
      return { resource: channel, state, fromSeq: serverSeq };
    }
    const talking = byChat.get(channel);
    if (talking)
      return { resource: channel, state: talking.chat.chatState(), fromSeq: serverSeq };
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
          activeClients: activeClientsOf(`ahp-session:/${id}`),
          ...describes(`ahp-session:/${id}`),
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
      const connection = { peer, clientId: '', watching: new Set<string>(), grants: new Set<string>() };
      connections.add(connection);
      /**
       * Whether this client has talked its way into writing that.
       *
       * A grant on a directory covers what is under it. The alternative is an
       * exact match per URI, which is defensible and unusable: an editor saves
       * a file it has open, and a round trip per file turns one negotiation
       * into one per keystroke-since-last-save. Asking for `file:///project`
       * and being answered about `file:///project` is what the client did -
       * this is honouring that answer, not widening it.
       *
       * Prefix on a path separator, never on the string: a grant on
       * `/src/brb` must not reach `/src/brb_framework`.
       */
      const mayWrite = (uri: string): boolean => {
        if (connection.grants.has(`write:${uri}`)) return true;
        if (!uri.startsWith('file://')) return false;
        const path = uri.slice('file://'.length);
        for (const held of connection.grants) {
          if (!held.startsWith('write:file://')) continue;
          const root = held.slice('write:file://'.length);
          if (path === root || path.startsWith(`${root}/`)) return true;
        }
        return false;
      };

      /**
       * Refuse a write nobody asked permission for, and say how to ask.
       *
       * The `request` in the error data is the protocol's own affordance: it
       * is a `resourceRequest` payload that, sent as-is, would make the same
       * call work. A refusal without it is a dead end.
       */
      const needsWrite = (uri: string): void => {
        if (mayWrite(uri)) return;
        throw new RpcError(-32009, `Write access to ${uri} has not been granted`, {
          request: { channel: ROOT, uri, write: true },
        });
      };

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
          // What this connection was watching before the drop. Whatever it
          // does not ask back for is the third way the protocol says a client
          // stops being active in a session: reconnecting without
          // resubscribing to it.
          const before = [...connection.watching];
          connection.watching.clear();
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

          // Whatever it did not ask back for, it has left.
          for (const channel of before) {
            if (!connection.watching.has(channel)) leaves(channel, clientId);
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
          // From here on, an unsubscribe means something: a watch nobody has
          // subscribed to yet is not one everybody has finished with.
          const held = watches.get(channel);
          if (held) held.opened = true;
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
          const all = live ? live.chat.allTurns() : await past(idOf(channel));
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
          const before = text.slice(0, offset);
          /*
           * An at-sign at the start of a word, and a path since.
           *
           * Answered before the slash, because the two cannot both match and
           * a file is the more specific question. What follows may contain
           * slashes - `@src/ho` is a path being typed, not a command - so the
           * pattern stops at whitespace rather than at a separator.
           */
          const asked = /(?:^|\s)@(\S*)$/.exec(before);
          if (asked) {
            const typed_ = asked[1] ?? '';
            const from = offset - typed_.length - 1;
            const asking = String(params.channel ?? '');
            const chat_ = byChat.get(asking)?.chat
              ?? (sessions.get(asking) ? leadOf(sessions.get(asking) as Held) : undefined);
            // Relative to the session's own directory, which is what a person
            // means by a path while talking to an agent working there.
            const base = chat_?.workingDirectories()[0]?.replace(/^file:\/\//, '') ?? dir;
            // Nothing rather than an error: this same command serves `/`,
            // and a host with no filesystem still has commands to offer.
            if (!options.resources) return { items: [] };
            const paths = await options.resources.complete(typed_, base, browsable());
            return {
              items: paths.map((path) => ({
                insertText: `@${path}`,
                rangeStart: from,
                rangeEnd: offset,
                attachment: {
                  // A reference, not the bytes: the file is fetched with
                  // `resourceRead` if anything needs it, and a completion that
                  // carried a megabyte would carry it per keystroke.
                  type: 'resource',
                  uri: uriOf(`${base}/${path}`.replace(/\/{2,}/g, '/')),
                  label: path,
                },
              })),
            };
          }
          // A slash at the start of a word, and nothing but word characters
          // since. A slash mid-sentence is a path, not a command.
          const found = /(?:^|\s)\/([\w:-]*)$/.exec(before);
          if (!found)
            return { items: [] };
          const typed = (found[1] ?? '').toLowerCase();
          const start = offset - typed.length - 1;
          const asked_ = String(params.channel ?? '');
          const session = byChat.get(asked_)?.chat
            ?? (sessions.get(asked_) ? leadOf(sessions.get(asked_) as Held) : undefined);
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
        /*
         * The host's filesystem, as far as a client is allowed to see it.
         *
         * Read-only on purpose. The write half of `resource*` exists and is
         * not served: a host that let any connected client write anywhere is
         * a different thing from one that lets it read the project it is
         * working on, and this daemon is meant to be reachable from another
         * machine. A client that asks gets `-32601` rather than silence.
         */
        /**
         * A shell on this machine.
         *
         * The client picks the URI, as it does for a session, so it can
         * subscribe without a round trip in between. `cwd` is checked against
         * the directories this host serves - a terminal is arbitrary code on
         * the machine, and one that started anywhere would be a host that
         * hands out a shell wherever it is asked.
         */
        createTerminal: async (params) => {
          // Before the URI is looked at. A host that opens no shells at all
          // should say that, not complain about the argument to a request it
          // was never going to answer.
          const shells = need(options.terminals, 'createTerminal');
          const uri = String(params.channel ?? '');
          if (!uri.startsWith('ahp-terminal:'))
            throw new RpcError(-32602, `${uri} is not a terminal URI`);
          if (terminals.has(uri))
            throw new RpcError(-32003, `${uri} already exists`);
          const asked = typeof params.cwd === 'string' ? params.cwd.replace(/^file:\/\//, '') : dir;
          const roots = browsable();
          if (!roots.some((root) => asked === root || asked.startsWith(`${root}/`))) {
            throw new RpcError(-32009, `This host does not serve ${asked}. It serves ${roots.join(', ')}.`);
          }
          const claim = (typeof params.claim === 'object' && params.claim !== null
            ? params.claim
            : { kind: 'client', clientId: connection.clientId }) as Record<string, unknown>;
          const terminal = shells.create({
            uri,
            cwd: asked,
            claim,
            ...(typeof params.name === 'string' ? { name: params.name } : {}),
            ...(typeof params.cols === 'number' ? { cols: params.cols } : {}),
            ...(typeof params.rows === 'number' ? { rows: params.rows } : {}),
            emit: (_channel, action) => { dispatch(uri, action); },
          });
          terminals.set(uri, terminal);
          log(`opened ${uri} in ${asked}`);
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
          return {};
        },
        disposeTerminal: async (params) => {
          const uri = String(params.channel ?? '');
          const terminal = terminals.get(uri);
          if (!terminal)
            throw new RpcError(-32008, `No terminal at ${uri}`);
          terminal.close();
          terminals.delete(uri);
          log(`closed ${uri}`);
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
          return {};
        },
        resourceList: async (params) => ({
          entries: await need(options.resources, 'resourceList').list(String(params.uri ?? ''), browsable()),
        }),
        resourceRead: async (params) => {
          const uri = String(params.uri ?? '');
          // The `before` side of an edit is not a file on disk - it is what a
          // file used to be - so the changeset source is asked first, and
          // answers only for the URIs it minted.
          const own = await options.changes?.read?.(uri);
          if (own) return own;
          return await need(options.resources, 'resourceRead').read(
            uri,
            browsable(),
            typeof params.encoding === 'string' ? params.encoding : undefined,
          );
        },
        /**
         * What kinds of trigger this host understands.
         *
         * Asked before any automation exists, because it is what a client
         * needs to draw the form. A store that schedules nothing answers with
         * no schedule trigger, and the client then offers no cron box - which
         * is better than a box that takes an expression nothing will ever act
         * on.
         */
        listAutomationTriggerDefinitions: async (params) => ({
          items: need(options.automations, 'listAutomationTriggerDefinitions').triggers({
            ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
            ...(Array.isArray(params.workingDirectories)
              ? { workingDirectories: params.workingDirectories.filter((one): one is string => typeof one === 'string') }
              : {}),
          }),
        }),
        /**
         * Start one now.
         *
         * The session is created here rather than in the store, because only
         * this file knows what a session is - the store is handed a function
         * and gets a URI back. `requestId` is echoed nowhere: the protocol has
         * it so a client can match its own request to the run it gets, and the
         * run URI in the result is that match.
         */
        runAutomation: async (params) => {
          const store = need(options.automations, 'runAutomation');
          const automation = String(params.automation ?? '');
          const requestId = String(params.requestId ?? '');
          const run = await store.run(
            automation,
            { kind: 'manual', requestId, clientId: connection.clientId },
            async (wanted) => {
              const uri = `ahp-session:/${crypto.randomUUID()}`;
              await handlers.createSession?.({
                channel: uri,
                ...(wanted.provider !== undefined ? { provider: wanted.provider } : {}),
                ...(wanted.workingDirectory !== undefined
                  ? { workingDirectories: [`file://${wanted.workingDirectory}`] }
                  : {}),
                ...(wanted.config !== undefined ? { config: wanted.config } : {}),
              });
              // The first message, which is what the automation is *for*: a
              // session created and never spoken to is a session that does
              // nothing, and the whole point is that nobody is at the keyboard.
              const chatUri = `ahp-chat:/${idOf(uri)}`;
              byChat.get(chatUri)?.chat.begin(crypto.randomUUID(), wanted.text);
              return uri;
            },
          );
          if (!run) throw new RpcError(-32001, `No automation at ${automation}, or it is switched off`);
          return { resource: run.resource };
        },
        /** A page of what one automation has done, newest first. */
        fetchAutomationRuns: async (params) => need(options.automations, 'fetchAutomationRuns').runs(
          String(params.automation ?? ''),
          typeof params.cursor === 'string' ? params.cursor : undefined,
        ),
        /**
         * Tell me when that changes.
         *
         * The client gets a channel back and subscribes to it; there is no
         * dispose command, and the last `unsubscribe` is what releases the
         * watcher. Gated the way `resourceRead` is rather than the way a write
         * is: watching is a read, and a client already able to read a
         * directory learns nothing new by being told when it moved.
         */
        createResourceWatch: async (params) => {
          const uri = String(params.uri ?? '');
          const store = need(options.resources, 'createResourceWatch');
          const start = need(store.watch, 'createResourceWatch');
          const items = (value: unknown): string[] => {
            const held = (typeof value === 'object' && value !== null ? value : {}) as { items?: unknown };
            return Array.isArray(held.items) ? held.items.filter((one): one is string => typeof one === 'string') : [];
          };
          const recursive = params.recursive === true;
          const excludes = items(params.excludes);
          const includes = items(params.includes);
          const channel = `ahp-resource-watch:/${crypto.randomUUID()}`;
          const watcher = await start.call(store, uri, browsable(), { recursive, excludes, includes }, (changes) => {
            // Only if it still exists: a batch can be in flight when the last
            // subscriber leaves, and dispatching to a released channel is a
            // client being told about a watch it has forgotten.
            if (!watches.has(channel)) return;
            dispatch(channel, { type: 'resourceWatch/changed', changes: { items: changes } });
          });
          watches.set(channel, {
            watcher,
            owner: connection,
            opened: false,
            state: {
              root: uri,
              recursive,
              ...(excludes.length > 0 ? { excludes: { items: excludes } } : {}),
              ...(includes.length > 0 ? { includes: { items: includes } } : {}),
            },
          });
          log(`${connection.clientId} is watching ${uri}${recursive ? ' and under it' : ''}`);
          return { channel };
        },
        /*
         * The write half of `resource*`.
         *
         * Every one takes the same two gates in the same order, and the order
         * matters. The grant is checked here, because it is a fact about this
         * *connection* and the store has never heard of connections; the path
         * is checked in the store, because only it knows what a path means -
         * and it resolves the parent rather than the target, so a symlink
         * pointing out of the served set cannot be written through.
         *
         * `need` twice, because there are two ways not to have this: a host
         * given no `resources` port at all, and one given a store that only
         * reads. Both answer `-32601`, which is what the protocol has for a
         * method that is not here, and neither is a refusal about a path.
         */
        resourceWrite: async (params) => {
          const uri = String(params.uri ?? '');
          needsWrite(uri);
          const encoding = params.encoding === 'base64' ? 'base64' as const : 'utf-8' as const;
          await need(need(options.resources, 'resourceWrite').write, 'resourceWrite')(uri, browsable(), {
            data: String(params.data ?? ''),
            encoding,
            ...(typeof params.mode === 'string' ? { mode: params.mode as 'truncate' | 'append' | 'insert' } : {}),
            ...(typeof params.position === 'number' ? { position: params.position } : {}),
            ...(params.createOnly === true ? { createOnly: true } : {}),
            ...(typeof params.ifMatch === 'string' ? { ifMatch: params.ifMatch } : {}),
          });
          log(`${connection.clientId} wrote ${uri}`);
          return {};
        },
        resourceDelete: async (params) => {
          const uri = String(params.uri ?? '');
          needsWrite(uri);
          await need(need(options.resources, 'resourceDelete').remove, 'resourceDelete')(
            uri, browsable(), params.recursive === true,
          );
          log(`${connection.clientId} removed ${uri}`);
          return {};
        },
        resourceMkdir: async (params) => {
          const uri = String(params.uri ?? '');
          needsWrite(uri);
          await need(need(options.resources, 'resourceMkdir').mkdir, 'resourceMkdir')(uri, browsable());
          return {};
        },
        /*
         * Both ends, because a move writes both.
         *
         * The source is emptied and the destination is filled, so a grant on
         * one of them is permission for half of what would happen. `copy` only
         * needs the destination - reading the source is what the read half
         * already allows inside a served directory.
         */
        resourceMove: async (params) => {
          const source = String(params.source ?? '');
          const destination = String(params.destination ?? '');
          needsWrite(source);
          needsWrite(destination);
          await need(need(options.resources, 'resourceMove').move, 'resourceMove')(
            source, destination, browsable(), params.failIfExists === true,
          );
          log(`${connection.clientId} moved ${source} to ${destination}`);
          return {};
        },
        resourceCopy: async (params) => {
          const source = String(params.source ?? '');
          const destination = String(params.destination ?? '');
          needsWrite(destination);
          await need(need(options.resources, 'resourceCopy').copy, 'resourceCopy')(
            source, destination, browsable(), params.failIfExists === true,
          );
          return {};
        },
        /**
         * May I read this, may I write it.
         *
         * The negotiated form of a refusal, and the only door onto anything
         * here that writes. A grant is per resource and per connection: a
         * client asks about one file, is answered about that file, and a
         * second client on the same port inherits nothing from the first.
         *
         * What this host will grant is the directories it was told to serve,
         * and nothing else. There is no person at a daemon to prompt, so the
         * third answer the protocol allows is not available to it - which
         * makes the served set the whole policy, and makes a request for
         * anything outside it a refusal rather than a question.
         */
        resourceRequest: async (params) => {
          const uri = String(params.uri ?? '');
          const path = uri.startsWith('file://') ? uri.slice('file://'.length) : undefined;
          const inside = path !== undefined
            && browsable().some((dir_) => path === dir_ || path.startsWith(`${dir_}/`));
          if (!inside) throw new RpcError(-32009, `This host does not mediate ${uri}`);
          // Neither flag is a read, which is what the protocol tells receivers
          // to make of a request that sets nothing.
          const write = params.write === true;
          const read = params.read === true || !write;
          if (read) connection.grants.add(`read:${uri}`);
          if (write) connection.grants.add(`write:${uri}`);
          log(`${connection.clientId} may ${write ? 'write' : 'read'} ${uri}`);
          return {};
        },
        /**
         * Run one of the verbs a changeset advertised.
         *
         * Four gates, and none of them is a flag on this host: the id has to
         * be one this changeset offers *now*, the target has to be a kind that
         * operation accepts, the session must not be mid-turn, and an
         * operation that writes needs a `resourceRequest` grant on what it
         * would write. The list is the access model - a client can invoke
         * nothing that was not already put in front of it.
         */
        invokeChangesetOperation: async (params) => {
          const channel = String(params.channel ?? '');
          const at = changesetAt(channel);
          if (!at) throw new RpcError(-32001, `No changeset at ${channel}`);
          const source = need(options.changes, 'invokeChangesetOperation');
          const operationId = String(params.operationId ?? '');
          const offered = (source.operations?.(at.dir, at.owner, at.scope) ?? [])
            .find((one) => one.id === operationId);
          if (!offered)
            throw new RpcError(-32602, `No operation called ${operationId} on ${channel}`);

          const raw = params.target as Record<string, unknown> | undefined;
          const target = raw !== undefined && typeof raw === 'object'
            ? {
              kind: raw.kind === 'range' ? 'range' as const : 'resource' as const,
              resource: String(raw.resource ?? ''),
              ...(raw.side === 'before' || raw.side === 'after' ? { side: raw.side as 'before' | 'after' } : {}),
              ...(typeof raw.range === 'object' && raw.range !== null
                ? { range: raw.range as { startLine: number; endLine: number } }
                : {}),
            }
            : undefined;
          // No target is the changeset itself, which is how the protocol says
          // a changeset-scoped invocation.
          const kind = target?.kind ?? 'changeset';
          if (!offered.scopes.includes(kind))
            throw new RpcError(-32602, `${operationId} cannot be invoked on a ${kind}`);

          // Refused rather than queued. The agent is writing to this tree, and
          // an operation that rewrote a file underneath it would be racing the
          // thing whose work the changeset is about.
          if ((statusOf(at.owner) & Status.InProgress) !== 0)
            throw new RpcError(-32002, `${at.owner} is mid-turn`);

          // A file for a targeted operation, the project for a changeset-wide
          // one: committing is a write to the directory and there is no single
          // resource to name for it.
          if (offered.writes === true) needsWrite(target?.resource ?? `file://${at.dir}`);

          const key = opKey(channel, operationId);
          const held = sessions.get(at.owner);
          const lead = held && leadOf(held);
          inFlight.add(key);
          lastError.delete(key);
          dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'running' });
          try {
            const result = await need(source.invoke, 'invokeChangesetOperation').call(source, {
              dir: at.dir,
              session: at.owner,
              scope: at.scope,
              operationId,
              ...(target !== undefined ? { target } : {}),
              ...(lead ? { subject: lead.title() } : {}),
            });
            inFlight.delete(key);
            dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'idle' });
            // Something wrote to the tree, so every changeset of this session
            // is now describing a directory that has moved. The catalogue
            // first, because `refresh` is what makes the next read fresh.
            refreshFacts(at.dir);
            await options.changes?.refresh?.(at.dir).catch(() => false);
            await contentMoved(at.owner);
            return { ...(result.message !== undefined ? { message: result.message } : {}) };
          }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            inFlight.delete(key);
            lastError.set(key, message);
            dispatch(channel, {
              type: 'changeset/operationStatusChanged',
              operationId,
              status: 'error',
              error: { message },
            });
            log(`${operationId} on ${channel} failed: ${message}`);
            throw new RpcError(INTERNAL_ERROR, message);
          }
        },
        resourceResolve: async (params) => await need(options.resources, 'resourceResolve').resolve(
          String(params.uri ?? ''),
          browsable(),
          params.followSymlinks !== false,
        ),
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
            session = spawn(agent, uri, `ahp-chat:/${idFor(uri)}`, config, undefined, where);
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
          activeSessionsMoved();
          return {};
        },
        /**
         * A second conversation in one session.
         *
         * Same backend, same directory, same config - which is what makes the
         * chats peers rather than one being the other's child. `source` is not
         * served: forking a chat from a turn needs the backend to resume at
         * that turn, and this one resumes whole sessions.
         */
        createChat: async (params) => {
          const uri = String(params.channel ?? '');
          const chatUri = String(params.chat ?? '');
          const held = sessions.get(uri);
          if (!held)
            throw new RpcError(-32001, `No agent for session ${uri}`);
          if (!chatUri.startsWith('ahp-chat:'))
            throw new RpcError(-32602, `${chatUri} is not a chat URI`);
          if (byChat.has(chatUri))
            throw new RpcError(-32003, `${chatUri} already exists`);
          if (params.source !== undefined)
            throw new RpcError(-32602, 'This host does not fork a chat from a turn');
          const chat = spawn(held.agent, uri, chatUri, held.config, undefined, held.workingDirectory);
          log(`opened ${chatUri} in ${uri}`);
          // `summary`, not `chat`: the reducer reads `action.summary.resource`,
          // and a chat named any other way arrives as a TypeError inside it.
          dispatch(uri, { type: 'session/chatAdded', summary: chatSummary(chatUri, chat) });
          const first_ = (typeof params.initialMessage === 'object' && params.initialMessage !== null
            ? params.initialMessage
            : undefined) as Record<string, unknown> | undefined;
          if (first_ !== undefined) {
            chat.begin(crypto.randomUUID(), String(first_.text ?? ''));
          }
          return {};
        },
        disposeChat: async (params) => {
          const chatUri = String(params.channel ?? '');
          const found = byChat.get(chatUri);
          if (!found)
            throw new RpcError(-32001, `No chat at ${chatUri}`);
          const held = sessions.get(found.uri);
          if (held && held.chats.size === 1) {
            // The last one is the session. Removing it would leave a session
            // with nothing to talk to, which `disposeSession` says properly.
            throw new RpcError(-32602, `${chatUri} is the only chat in ${found.uri}; dispose the session instead`);
          }
          found.chat.close();
          byChat.delete(chatUri);
          held?.chats.delete(chatUri);
          if (held && held.defaultChat === chatUri) {
            held.defaultChat = [...held.chats.keys()][0] as string;
            dispatch(found.uri, { type: 'session/defaultChatChanged', defaultChat: held.defaultChat });
          }
          log(`closed ${chatUri}`);
          dispatch(found.uri, { type: 'session/chatRemoved', chat: chatUri });
          return {};
        },
        disposeSession: async (params) => {
          const uri = String(params.channel ?? '');
          const held = sessions.get(uri);
          if (!held)
            throw new RpcError(-32001, `No agent for session ${uri}`);
          for (const [chatUri, chat] of held.chats) {
            chat.close();
            byChat.delete(chatUri);
          }
          sessions.delete(uri);
          presence.delete(uri);
          activeSessionsMoved();
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
          const channel = String(params.channel ?? '');
          connection.watching.delete(channel);
          // Except for a resource watch, where the protocol says the opposite
          // in as many words: it has no dispose command, so the last
          // unsubscribe is what releases the watcher.
          releaseWatch(channel);
          // And unsubscribing from a session is one of the three ways the
          // protocol says a client stops being active in it.
          leaves(channel, connection.clientId || 'anonymous');
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
          /*
           * Ticking a file off a diff, which belongs to no session's agent.
           *
           * Answered here for the same reason the flags below are: it is a
           * reader's bookkeeping about a changeset, it writes nothing to disk,
           * and it arrives on the changeset's own channel rather than a
           * session's. Review is deliberately not an *operation* - the
           * protocol has clients dispatch this and the server keep the flag.
           */
          if (type === 'changeset/filesReviewChanged') {
            const cut = channel.indexOf('/changeset/');
            const owner = cut > 0 ? channel.slice(0, cut) : '';
            const scope = cut > 0 ? channel.slice(cut + '/changeset/'.length) : '';
            const dir = owner === '' ? undefined : dirOf(owner);
            const files = Array.isArray(action.files)
              ? action.files.filter((one): one is string => typeof one === 'string')
              : [];
            const on = action.reviewed === true;
            if (dir === undefined || files.length === 0) return;
            // Only when it moved. A client ticking a file already ticked would
            // otherwise have every other client redraw for nothing.
            if (options.changes?.review?.(dir, owner, scope, files, on) !== true) return;
            dispatch(channel, { type, files, reviewed: on });
            return;
          }

          /*
           * Somebody is here, and what they brought.
           *
           * Client-dispatchable and host-kept, which is the whole point: one
           * client says it once and every other client watching the session
           * learns of it, which is not something they could tell each other.
           * The id is this connection's own rather than whatever the action
           * carried - a client naming somebody else would be a client
           * announcing a presence that is not theirs.
           */
          /*
           * A client writing an automation, or patching one.
           *
           * Both are *requests* in the protocol's own spelling - the client
           * says what it wants and the host decides, then says what it
           * actually holds with `automation/set`. So neither of these echoes:
           * what goes out is the store's answer, which is not necessarily what
           * was asked for.
           */
          if (type === 'automation/createRequested' || type === 'automation/updateRequested') {
            const store = options.automations;
            if (!store) { log(`${type} needs an automations store, and this host has none`); return; }
            const resource = String(action.resource ?? '');
            if (!resource.startsWith('ahp-automation:/')) return;
            const made = type === 'automation/createRequested'
              ? store.create(resource, (typeof action.definition === 'object' && action.definition !== null
                ? action.definition
                : {}) as Bag)
              : store.update(resource, (typeof action.changes === 'object' && action.changes !== null
                ? action.changes
                : {}) as Bag);
            // `onChanged` is what dispatches. A store that told the host
            // nothing would be one whose own timers were invisible, so
            // everything goes out the same way.
            if (!made) log(`no automation at ${resource}`);
            return;
          }

          /*
           * Forgetting one, which the client dispatches and the host checks.
           *
           * The protocol is precise about the order: a client may send this
           * "only while the target advertises `Remove`", and the host
           * "revalidates that operation before permanently deleting". So the
           * advertised list is checked here rather than trusted - a client
           * holding a stale catalogue would otherwise delete something this
           * host had since decided may not be deleted.
           */
          if (type === 'automation/removed') {
            const store = options.automations;
            const resource = String(action.resource ?? '');
            const found = store?.get(resource);
            // "Removing an unknown resource is a no-op."
            if (!store || !found) return;
            if (!found.operations.includes('remove')) {
              log(`${resource} does not offer remove`);
              return;
            }
            store.remove(resource);
            return;
          }

          if (type === 'automationRun/cancelRequested') {
            log('automationRun/cancelRequested is not served: a run here is a session, and disposing it is how it stops');
            return;
          }

          if (type === 'session/activeClientSet') {
            if (!sessions.has(channel) && !titles.has(channel)) return;
            const clientId = connection.clientId || 'anonymous';
            const carried = (typeof action.activeClient === 'object' && action.activeClient !== null
              ? action.activeClient
              : {}) as Bag;
            const activeClient: Bag = {
              ...carried,
              clientId,
              tools: Array.isArray(carried.tools) ? carried.tools : [],
            };
            const held = presence.get(channel) ?? new Map<string, Bag>();
            presence.set(channel, held);
            // Re-announcing is how a client refreshes what it contributes, so
            // this replaces rather than merges - a tool taken away has to be
            // able to go.
            held.set(clientId, activeClient);
            dispatch(channel, { type, activeClient });
            return;
          }

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
          const terminal = terminals.get(channel);
          if (terminal) {
            switch (type) {
              /*
               * Input is side-effect only.
               *
               * The reducer changes nothing on it - what comes back is
               * `terminal/data`, once the shell has actually said something.
               * Echoing it here would print every keystroke twice on the
               * client that typed it and once on the ones that did not.
               */
              case 'terminal/input':
                terminal.write(String(action.data ?? ''));
                break;
              case 'terminal/resized':
                terminal.resize(Number(action.cols ?? 80), Number(action.rows ?? 24));
                break;
              case 'terminal/titleChanged':
                terminal.setTitle(String(action.title ?? ''));
                break;
              case 'terminal/claimed':
                terminal.setClaim((typeof action.claim === 'object' && action.claim !== null
                  ? action.claim
                  : {}) as Record<string, unknown>);
                break;
              default:
                log(`dispatchAction ${type} is not served on a terminal`);
            }
            return;
          }
          /*
           * Which chat a client action is about.
           *
           * A chat channel names one; a session channel names the default,
           * because that is what a client talking to a session without having
           * asked for a chat means.
           */
          const holding = sessions.get(channel);
          const held = byChat.get(channel)?.chat ?? (holding ? leadOf(holding) : undefined);
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
              const session = spawn(owner, uri, `ahp-chat:/${id}`, chosen.get(uri) ?? {}, { resume: id, seed }, ran);
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
              // Config belongs to the session, so it is remembered there: a
              // chat opened after this one is answered starts on it too.
              const owning = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
              if (owning) {
                for (const [key, value] of Object.entries(config)) owning.config[key] = String(value);
              }
              for (const [key, value] of Object.entries(config)) {
                const everywhere: Session[] = owning ? [...owning.chats.values()] : [session];
                if (key === 'permissionMode') {
                  for (const chat of everywhere) {
                    if (chat !== session) chat.setPermissionMode(String(value));
                  }
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
                if (key === 'outputStyle') {
                  // Every chat in the session, like the permission mode: they
                  // are peers on one config, and a voice set on one of them is
                  // a session where two conversations answer differently.
                  for (const chat of everywhere) {
                    if (chat !== session) chat.setOutputStyle(String(value));
                  }
                  if (session.setOutputStyle(String(value))) {
                    dispatch(session.uri, { type: 'session/configChanged', config: { outputStyle: String(value) } });
                  }
                  else {
                    log(`the CLI has no output style called ${String(value)}`);
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
            case 'chat/draftChanged':
              session.setDraft(String(action.draft ?? ''));
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
          const was = [...connection.watching];
          connections.delete(connection);
          // Before anything else looks: a watch this client owned and never
          // subscribed to has nobody left to subscribe to it.
          for (const channel of [...watches.keys()]) releaseWatch(channel);
          // Gone without reconnecting, which is the second of the three ways.
          // Said after the connection is out of the set, so `leaves` does not
          // find this one still holding the session.
          for (const channel of was) leaves(channel, connection.clientId || 'anonymous');
          log(`${connection.clientId || 'a client'} went away`);
        },
      };
    },
  };
}
export { ROOT, type Summary };
