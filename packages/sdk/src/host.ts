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

import { annotationsReducer, IS_CLIENT_DISPATCHABLE, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { AnnotationsAction, AnnotationsState, ChangesetFile, TerminalInfo, ToolDefinition } from '@microsoft/agent-host-protocol';
import type { OnWire } from './types/wire.js';
import { RpcError, INTERNAL_ERROR, METHOD_NOT_FOUND } from './rpc.js';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { worktreeFor, worktreesOf } from './worktrees.js';
import { idFor, idOf, uriFor, Status } from './catalog.js';
import { tail, older } from './paging.js';
import { memorySessions } from './sessions.js';
import { ARTIFACTS_META, artifactsIn, isGitHubLink, recordArtifact } from './artifacttools.js';
import { debugLogs, hostLogPath } from './debuglogs.js';
import type { LogFile } from './debuglogs.js';
import { lookup } from 'node:dns/promises';
import type { Claim, StartTerminals, Terminal, TerminalStore } from './types/terminals.js';
import type { Ran } from './types/session.js';
import type { WriteMode } from './types/resources.js';
import type { ChangesetOperationContext, ChangesetState } from './types/changes.js';
import type { Clients, Connection, Credential, Host, HostOptions, HostTool, TitleStrategy, ToolCall } from './types/host.js';
import type { EventName, HostEvent } from './types/events.js';
import type { PluginContext } from './types/plugin.js';
import type { Summary } from './types/catalog.js';
import type { Agent, BoundTool } from './types/agent.js';
import type { Bag } from './types/common.js';
import type { Session } from './types/session.js';
import type { RunEnding, StartSession } from './types/automations.js';
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

/**
 * The three methods a connection may send before it has been introduced.
 *
 * `initialize` and `reconnect` are the two ways in. `ping` is neither: the
 * spec says a server MUST answer it whether or not the client has completed
 * `initialize`, because it is how a client tells a live socket from one an
 * idle proxy has quietly dropped.
 */
/**
 * The character that turns a message into a command.
 *
 * The protocol standardises the convention rather than the behaviour: a host
 * advertises what it recognises, and `"!"` is what every implementation uses.
 * A lone `!`, or one followed only by spaces, is not a command - it is
 * somebody typing an exclamation mark, and it goes to the agent.
 */
const BANG = '!';

/**
 * Where a write may be placed, as the protocol's `ResourceWriteMode` has them.
 *
 * Written out here because this is the one place a *client's* string has to be
 * checked against the vocabulary rather than assigned to it - and the list is
 * held to the protocol's by the type on the next line, so it cannot drift.
 */
const WRITE_MODES: string[] = ['truncate', 'append', 'insert'] satisfies WriteMode[];

/** What a session's annotations channel is called, under the session's own URI. */
const MARKS = '/annotations';

/** The proxy variables the network diagnostics report, when set. */
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'] as const;
/** How long a network probe waits, and how much of the body it keeps. */
const PROBE_TIMEOUT = 10_000;
const MAX_BODY = 64 * 1024;

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One address lookup for the network diagnostics, timed and never thrown. */
const resolved = async (host: string, family: 4 | 6): Promise<{ address?: string; durationMs: number; error?: string }> => {
  const began = Date.now();
  try {
    const { address } = await Promise.race([
      lookup(host, { family }),
      new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error(`Timed out after ${PROBE_TIMEOUT / 1000}s`)); }, PROBE_TIMEOUT).unref?.(); }),
    ]);
    return { address, durationMs: Date.now() - began };
  }
  catch (error) {
    return { durationMs: Date.now() - began, error: reason(error) };
  }
};

const GREETINGS = new Set(['initialize', 'reconnect', 'ping']);

/**
 * The most rows this host will serve in one page, however many were asked for.
 *
 * The protocol says a server MAY impose its own cap, and one exists so that a
 * client asking for a million does not turn a page into the whole catalogue
 * plus the work of slicing it.
 */
const PAGE_CAP = 500;

/**
 * The most rows a client that asked for no page size is handed at once.
 *
 * Deliberately far above any real catalogue rather than at a page's size:
 * neither client that connects to this host reads `nextCursor`, so anything
 * smaller would be a catalogue silently cut down to it. This is not a page
 * size - it is the point past which a single frame stops being servable at
 * all, and reaching it is written to the log because the client cannot see it.
 */
const PAGE_MOST = 1_000;

/**
 * A pagination cursor, which is opaque by contract.
 *
 * It is the resource of the last row served, encoded - so it says nothing a
 * client is invited to read, parse or keep. The protocol says cursors are
 * server-defined and MUST be treated as opaque; encoding is what makes that
 * true rather than merely asked for.
 */
const sealed = (resource: string): string => Buffer.from(resource, 'utf8').toString('base64url');

/** The resource a cursor named, or nothing a row will match. */
const opened = (cursor: string): string => {
  try { return Buffer.from(cursor, 'base64url').toString('utf8'); }
  catch { return ''; }
};

/**
 * The protocol's own answer to "may a client send this?", by action type.
 *
 * Widened from the generated exhaustive map, which is keyed by the action
 * types the package knows: a type read off the wire is a string and may be
 * none of them, and `undefined` there means "no such action" rather than
 * "host-only".
 */
const dispatchable = IS_CLIENT_DISPATCHABLE as Record<string, boolean | undefined>;

/**
 * A claim off the wire, or nothing.
 *
 * Parsed rather than cast, which the types are what forced: a claim used to be
 * a `Bag` and anything at all was accepted, so a client could take a terminal
 * with `{}` and the state went out saying so. The two kinds carry different
 * fields and each is checked for its own.
 */
function claimOf(value: unknown): Claim | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as Record<string, unknown>;
  if (held.kind === 'client') {
    return typeof held.clientId === 'string'
      ? { kind: 'client', clientId: held.clientId }
      : undefined;
  }
  if (held.kind === 'session') {
    if (typeof held.session !== 'string' || typeof held.chat !== 'string') return undefined;
    return {
      kind: 'session',
      session: held.session,
      chat: held.chat,
      ...(typeof held.turnId === 'string' ? { turnId: held.turnId } : {}),
      ...(typeof held.toolCallId === 'string' ? { toolCallId: held.toolCallId } : {}),
    };
  }
  return undefined;
}


/**
 * A channel URI a client named, checked for being one at all.
 *
 * Not for its *scheme*: the client chooses that. VS Code names a session after
 * its provider (`claude:/<uuid>`) and a terminal `agenthost-terminal:/<uuid>`,
 * and this host demanded `ahp-session:/` and `ahp-terminal:` - so every session
 * and every terminal an editor opened came back `is not a session URI`. The
 * protocol's own `ahp-session:/<uuid>` is an example in a doc comment, and the
 * host's job is to echo what it was given, not to rename it.
 */
const named = (uri: string, what: string): string => {
  const colon = uri.indexOf(':');
  if (colon <= 0 || idOf(uri) === '') throw new RpcError(-32602, `${uri} is not a ${what} URI`);
  return uri;
};

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
   * Every directory any backend catalogues, plus the host's own.
   *
   * Where past sessions and branches are looked for; not what a client may
   * read, which is anything. Asked each time rather than captured, because a
   * backend may learn about a directory after this host started.
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
   * The ten `resource*` methods, which run in both directions.
   *
   * `CommandMap` and `ServerCommandMap` carry the same ten entries with the
   * same params and the same results, so a request naming a URI a client
   * published is the same request sent back the other way.
   */
  /**
   * The commands whose `channel` the protocol declares as one literal.
   *
   * Read off the params declarations, which spell it as a string literal type
   * rather than as `URI`: these are the host's own commands, and the channel
   * on them is a constant a client copies rather than a thing it chooses.
   *
   * `initialize` and `ping` are left out deliberately, though they declare one
   * too. They are how a client finds out it can talk at all, and refusing
   * either turns a wrong constant into a connection that never opens - which
   * is a worse thing to debug than the command that would have been refused.
   */
  const DECLARED: Record<string, string | undefined> = {
    authenticate: ROOT,
    createResourceWatch: ROOT,
    listSessions: ROOT,
    reconnect: ROOT,
    resolveSessionConfig: ROOT,
    resourceCopy: ROOT,
    resourceDelete: ROOT,
    resourceList: ROOT,
    resourceMkdir: ROOT,
    resourceMove: ROOT,
    resourceRead: ROOT,
    resourceRequest: ROOT,
    resourceResolve: ROOT,
    resourceWrite: ROOT,
    sessionConfigCompletions: ROOT,
    listAutomationTriggerDefinitions: ROOT,
    runAutomation: AUTOMATIONS,
    fetchAutomationRuns: AUTOMATIONS,
  };
  const REVERSE = new Set([
    'resourceRead', 'resourceWrite', 'resourceList', 'resourceCopy', 'resourceDelete',
    'resourceMove', 'resourceResolve', 'resourceMkdir', 'resourceRequest', 'createResourceWatch',
  ]);
  /**
   * Which client published a URI, if a connected one did.
   *
   * `<scheme>://<clientId>/…` is how the reference host addresses a
   * client-served resource, and reading the authority is the whole of the
   * routing. `file:` is never one - it is this machine's, and this host has a
   * filesystem for it - and neither is an `ahp-` channel, whose authority is
   * part of a channel name and not a client id.
   */
  const ownerOf = (uri: string): Connection | undefined => {
    const found = /^([a-zA-Z][\w+.-]*):\/\/([^/]+)/.exec(uri);
    const scheme = found?.[1];
    const who = found?.[2];
    if (scheme === undefined || who === undefined || scheme === 'file' || scheme.startsWith('ahp-')) return undefined;
    return [...connections].find((one) => one.clientId === who);
  };
  /** Ask one client one of the ten, in its own words. */
  const ask = async (client: string, method: string, params: Record<string, unknown>): Promise<unknown> => {
    const held = [...connections].find((one) => one.clientId === client);
    if (held === undefined) throw new RpcError(-32008, `${client} is not a client this host has seen`);
    // The channel last, not first: every one of the ten declares it as the
    // literal `ahp-root://`, and this host refuses a client that names another
    // - so a caller here cannot be the thing that gets it wrong either.
    return await held.peer.request(method, { ...params, channel: ROOT });
  };
  /**
   * The connected clients, as places a resource can come from.
   *
   * Ten named methods over one `peer.request`, so a caller writes what it
   * means rather than a method name and a bag - and so the params each takes
   * are checked here rather than at the other end.
   */
  const clients: Clients = {
    ids: () => [...connections].map((one) => one.clientId).filter((one) => one !== ''),
    owner: (uri) => ownerOf(uri)?.clientId,
    read: async (client, uri, encoding) => await ask(client, 'resourceRead', {
      uri, ...(encoding !== undefined ? { encoding } : {}),
    }),
    list: async (client, uri) => await ask(client, 'resourceList', { uri }),
    resolve: async (client, uri) => await ask(client, 'resourceResolve', { uri }),
    write: async (client, uri, content) => await ask(client, 'resourceWrite', { uri, ...content }),
    remove: async (client, uri, recursive) => await ask(client, 'resourceDelete', {
      uri, ...(recursive !== undefined ? { recursive } : {}),
    }),
    move: async (client, source, destination, failIfExists) => await ask(client, 'resourceMove', {
      source, destination, ...(failIfExists !== undefined ? { failIfExists } : {}),
    }),
    copy: async (client, source, destination, failIfExists) => await ask(client, 'resourceCopy', {
      source, destination, ...(failIfExists !== undefined ? { failIfExists } : {}),
    }),
    mkdir: async (client, uri) => await ask(client, 'resourceMkdir', { uri }),
    watch: async (client, uri, watching) => await ask(client, 'createResourceWatch', { uri, ...watching }),
    request: async (client, uri, access) => await ask(client, 'resourceRequest', { uri, ...access }),
  };
  /**
   * A watch channel a client minted, and the client that minted it.
   *
   * `createResourceWatch` on a URI another client publishes is answered by
   * that client, and what comes back is a channel *it* will report changes
   * on. So the channel is remembered here: its owner is allowed to dispatch
   * `resourceWatch/changed` onto it, which this host then relays to whoever
   * subscribed - and nobody else is, because a change to somebody else's
   * files is not a thing a third client may claim happened.
   */
  const relayed = new Map<string, { owner: Connection; state: Record<string, unknown> }>();
  /**
   * One `resource*` request, answered by the client that published its URI.
   *
   * `undefined` means nobody else's: the URI is this machine's, or the client
   * that published it has hung up - and then the host's own handler answers as
   * it always did. Wrapped in an object so an owner answering `undefined` is
   * still an answer.
   *
   * Called only for the ten, and only from there: every other request must
   * reach its handler in the same turn of the event loop it arrived in, and
   * an `await` here would put a microtask between the two - which is enough
   * to lose an action dispatched while a `subscribe` is in flight.
   */
  const elsewhere = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ result: unknown } | undefined> => {
    const uri = String(params.uri ?? params.source ?? '');
    const owner = ownerOf(uri);
    if (owner === undefined) return undefined;
    /*
     * Both ends of a move or a copy, or neither.
     *
     * The two methods that name two URIs are the two that could ask one
     * client to write into another's files, and neither peer could carry
     * that out: the owner of the source cannot reach the destination. Said
     * rather than half-done.
     */
    const to = params.destination === undefined ? undefined : ownerOf(String(params.destination));
    if (params.destination !== undefined && to?.clientId !== owner.clientId) {
      throw new RpcError(-32602, `${uri} and ${String(params.destination)} are not the same client's`);
    }
    /*
     * The owner's refusal is the owner's, and it is written down here.
     *
     * What goes back to the asking client is whatever the owner said, code
     * and all - this host has no standing to soften somebody else's refusal.
     * But a refusal that crossed a connection is one the asking client cannot
     * attribute: `-32009` from a client that published a directory read-only
     * and `-32009` from one that has not finished working out who is asking
     * are the same three digits, and the only place both are visible at once
     * is this log.
     */
    const answer = await owner.peer.request(method, params).catch((error: unknown) => {
      const code = (error as { code?: unknown }).code;
      const said = error instanceof Error ? error.message : String(error);
      log(`${owner.clientId} refused ${method} for ${uri}${typeof code === 'number' ? ` (${String(code)})` : ''}: ${said}`);
      throw error;
    });
    /*
     * A watch the owner minted, remembered so its reports can be relayed.
     *
     * The asking client subscribes to the channel that comes back, and the
     * owner dispatches `resourceWatch/changed` onto it - which this host
     * would otherwise refuse, because that action is a host's to say.
     */
    if (method === 'createResourceWatch') {
      const channel = String((answer as { channel?: unknown } | undefined)?.channel ?? '');
      // The same `ResourceWatchState` a watch of this host's own reports: what
      // the watch *is*, which is the params it was made with. The owner keeps
      // no state this host could ask for, and the protocol's reducer keeps no
      // history - a client arriving later has missed what it was not there for.
      if (channel !== '') {
        relayed.set(channel, {
          owner,
          state: {
            root: uri,
            recursive: params.recursive === true,
            ...(params.excludes !== undefined ? { excludes: params.excludes } : {}),
            ...(params.includes !== undefined ? { includes: params.includes } : {}),
          },
        });
      }
    }
    log(`${owner.clientId} answered ${method} for ${uri}`);
    return { result: answer };
  };
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
      *
   * By the id inside a session's URI, as the session store is: a client
   * announces itself on the way in, which can be before this host has listed
   * anything and so before it knows the name it will publish that session
   * under.
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
   * `IsRead` and `IsArchived`, per session - by the **id** inside its URI.
   *
   * Keyed by the id and not the URI because a client may set a flag on a row
   * before this host has listed anything, and until it has, the name it will
   * publish that session under is not yet known. The id is the identity; the
   * scheme is only whose it is.
   *
   * The client flags, and unlike the in-process host these genuinely belong
   * here: a flag one client sets is a flag every other client has to see, and
   * that is exactly what having a host buys.
   *
   * The store also holds the configuration chosen for a session that has no
   * agent running: a row read from its transcript is configurable before it is
   * resumed, and most of what the schema offers is fixed when the query is
   * built, so a session resumed without those answers is one that can never be
   * given them.
   *
   * Held by the store rather than in maps here, so a host given one that
   * writes them down still has them after a restart. The default forgets,
   * which is what an embedded host wants; see `SessionStore`.
   */
  const kept = options.sessions ?? memorySessions();
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
    config: Record<string, unknown>;
    /** Where they work, when the client named a directory. */
    workingDirectory: string | undefined;
    /**
     * The peers of that directory, which the agent may also work in.
     *
     * Held here as well as inside each chat because a restart rebuilds the
     * chats and has to hand them back what they had.
     */
    additional: string[] | undefined;
    /**
     * ISO 8601, when the session was first started.
     *
     * Not when it last moved. `createdAt` is an identity field - the protocol
     * says it never changes, and that it MUST be left out of a summary
     * *change* - and this used to be answered with the modification time, so a
     * row's age moved every time somebody said something to it. A resumed
     * session takes the catalogue's value rather than the moment it was
     * resumed, because it was not created then either.
     */
    createdAt: string;
  }
  /** Live sessions, by their own uri. */
  const sessions = new Map<string, Held>();
  /**
   * What started a session, for the ones nothing did.
   *
   * Only automations put anything here. A session somebody opened has no
   * origin, which is what the protocol says absent means.
   */
  const origins = new Map<string, { kind: 'automation'; automation: string; run: string }>();
  /**
   * The sessions each run was last announced as having, by run URI.
   *
   * Kept because the two actions that move the list carry one session each:
   * telling a client what changed means knowing what it was told before.
   */
  const linked = new Map<string, string[]>();
  /**
   * Move the run a session belongs to, when that session stops working.
   *
   * Only when nothing else of the run is still busy: the protocol says a run
   * stays `running` while any linked session executes or awaits a person, so
   * one session finishing is not the run finishing.
   */
  const settleRun = (uri: string, ending: RunEnding): void => {
    const from = origins.get(uri);
    if (from === undefined) return;
    const run = options.automations?.runOf?.(from.run);
    if (run === undefined) return;
    const busy = run.sessions.some((one) => one !== uri && sessions.has(one)
      && (statusOf(one) & (Status.InProgress | Status.InputNeeded)) !== 0);
    if (busy) return;
    options.automations?.settle?.(from.run, ending);
  };
  /** Every chat, back to the session holding it. */
  const byChat = new Map<string, { uri: string; chat: Session }>();
  /**
   * The peer directories each chat was given, when they are not its session's.
   *
   * A chat may hold a subset: the protocol says every entry of a chat's set
   * MUST be in its session's, and which of them a particular conversation is
   * about is that conversation's business. Kept here because restarting one
   * chat has to hand it back what it had.
   */
  const beside = new Map<string, string[]>();
  /**
   * How a chat came to exist.
   *
   * `ChatOrigin` has four kinds - `user`, `fork`, `sideChat` and `tool` - and
   * this host only ever makes the first: a chat here is one somebody opened,
   * or one read back from a transcript somebody typed. There is no kind for a
   * session an automation started, so that one gets none rather than a wrong
   * one, and absent is what the protocol says when a host has nothing to say.
   */
  const startedBy = (session: string): Bag =>
    (origins.has(session) ? {} : { origin: { kind: 'user' } });
  /**
   * One chat, as its session's catalogue lists it.
   *
   * A `ChatSummary` and not a name and a URI: `status` and `modifiedAt` are
   * required of one, and a client reducing its list against a partial row
   * gets one it cannot sort or draw a state for.
   */
  const chatSummary = (session: string, uri: string, chat: Session) => ({
    resource: uri,
    ...startedBy(session),
    title: chat.title(),
    status: chat.status(),
    modifiedAt: chat.modifiedAt(),
    ...(chat.activity() !== undefined ? { activity: chat.activity() } : {}),
    // The same answer the chat's own state gives. A summary that left it out
    // while the state carried it would be two answers to one question.
    interactivity: 'full',
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
   * The name this host holds a session under, given any name a client used.
   *
   * A session URI is the client's to name and this host's to echo, and only
   * the id inside one is ever read - so `claude:/<uuid>`, which is what VS
   * Code computes from a session's *provider*, and `ahp-session:/<uuid>`,
   * which is what this host listed that same session as, are one session.
   *
   * They were not one key. Everything this host keys by a session - who owns
   * it, where it ran, the bits a client set on it, the settings chosen for it
   * before it starts - is stored under the name in the catalogue, and a lookup
   * under the client's name found nothing: a row marked read that came back
   * unread, and a browsed session that could not be continued because no
   * backend owned a name nobody had stored.
   *
   * The held name, then, and the name as given when no session here has that
   * id at all - which is how a client still names a session it is creating.
   */
  const heldAs = (uri: string): string => {
    if (sessions.has(uri) || owners.has(uri)) return uri;
    /*
     * Only a session URI is read for its id.
     *
     * A session is addressable under any scheme a client chooses, so the id
     * inside it is the identity - but that is true of sessions and of nothing
     * else. `ahp-terminal:/x` and a session whose id is `x` are two channels,
     * and reading the id out of both made a terminal answer with the
     * session's state. Every other `ahp-` channel this host serves is already
     * its own name.
     */
    if (/^ahp-(?!session:)[a-z-]+:/.test(uri)) return uri;
    const named = nameOf(idOf(uri));
    return sessions.has(named) || owners.has(named) ? named : uri;
  };
  /**
   * The name this host publishes a session under, by the id inside it.
   *
   * A session URI is the client's to name, and the only implementation there
   * is builds one as `<provider>:/<id>` - the provider as the *scheme* - both
   * when it creates a session and when it reopens one it listed. Publishing
   * `ahp-session:/<id>` instead gave it two strings for one session, and which
   * one it reached for came out of its own stored state: addressed as
   * `claude:/<id>` the conversation drew, addressed as `ahp-session:/<id>` the
   * same session with the same bytes behind it drew nothing.
   *
   * So this host names them the way that client will: the id is the identity,
   * and the scheme is whose it is. The old spelling still resolves - see
   * `heldAs` - because it is only ever read through the id.
   */
  const names = new Map<string, string>();
  const nameOf = (id: string): string => names.get(id) ?? uriFor(id);
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
   * When a browsed session was started, as its own catalogue reported it.
   *
   * Kept for the same reason `wheres` is: a session resumed from a transcript
   * was created when its backend created it, and this host was not there. The
   * alternative is a row whose age is the moment somebody happened to open it.
   */
  const births = new Map<string, string>();
  /**
   * When a browsed session was last written to, as its own catalogue reported
   * it.
   *
   * The companion to `births`, and wanted for the same reason: a session this
   * host is not running was last touched whenever its transcript was, and
   * answering with the current time makes every read of a cold session look
   * like an edit.
   */
  const moves = new Map<string, string>();
  /**
   * Every client this host has handshaken with, by the id it gave.
   *
   * What `reconnect` is answerable *against*. A client comes back saying "I am
   * this id and I had seen up to here", and both halves are meaningless to a
   * host that has never met it: this one's sequence numbers are its own, so
   * "everything after 419" means nothing if 419 was another process's.
   *
   * Per host and for its lifetime, because that is the span the sequence
   * covers. A daemon that restarts has genuinely forgotten every client, and
   * saying so is the point - see the refusal in `reconnect`.
   */
  const known = new Set<string>();
  /**
   * What one backend turned out to offer.
   *
   * Advertised on the *root* channel, but only a live backend can enumerate
   * it - so it is empty until its probe answers, and that emptiness is a real
   * answer rather than a loading state. When it fills, every client watching
   * the root is told with `root/agentsChanged`.
   */
  interface Learned {
    /** Models a turn can run on, and what each can be told to do differently. */
    models: { id: string; name: string; configSchema?: Record<string, unknown> }[];
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
  const replayable: { channel: string; action: Record<string, unknown>; serverSeq: number; origin: Origin | undefined }[] = [];
  /**
   * The host's own log, as OTLP.
   *
   * `ahp-otlp://logs/{level}` is a template rather than a channel: the
   * variable is severity, so a client that only wants warnings subscribes to
   * one and is not sent the rest. Everything this host logs already goes
   * through `log`, so this is the same lines with a second destination rather
   * than a new source of them.
   *
   * Stateless and ephemeral, as the protocol says: nothing is replayed on
   * reconnect, and a subscriber gets only what was emitted after it arrived.
   * There is no state to snapshot either, which is why `subscribe` answers an
   * empty one rather than refusing.
   */
  const LOGS = 'ahp-otlp://logs';
  /**
   * The other two OTLP signals, as literal channels.
   *
   * Literal rather than templates: the protocol defines template variables for
   * `logs` only - severity - and says a client MUST ignore any variable it does
   * not know, so a variable of this host's invention on either of these would
   * be a channel nobody can expand.
   */
  const TRACES = 'ahp-otlp://traces';
  const METRICS = 'ahp-otlp://metrics';

  /** Tell whoever is watching an OTLP channel. Never replayed: these are streams. */
  const telling = (method: string, channel: string, payload: Bag): void => {
    for (const connection of connections) {
      if (connection.watching.has(channel)) connection.peer.notify(method, { channel, payload });
    }
  };

  /** Random hex, the width an OTLP id is: 16 bytes for a trace, 8 for a span. */
  const hex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((one) => one.toString(16).padStart(2, '0')).join('');

  /** The resource every signal this host emits is attributed to. */
  const attributed = (): Bag => ({
    attributes: [
      { key: 'service.name', value: { stringValue: 'ahpd' } },
      { key: 'service.start_time', value: { stringValue: startedAt } },
    ],
  });
  const startedAt = new Date().toISOString();
  /**
   * Call every listener of one event, in the order they were registered.
   *
   * Each is awaited before the next, so two plugins that both watch a moment
   * see it in the order the configuration listed them. A handler that throws
   * is reported against its plugin through `onEvent` directly and not through
   * `log`, because `log` is itself an event and reporting a failed `log`
   * listener through `log` is a recursion. The return value is ignored: a
   * handler observes and cannot change what the host does.
   *
   * The listener carries the read-only context its plugin's `apply` was
   * handed, so a handler reads the same directories and the same log.
   */
  const fire = async (name: EventName, event: HostEvent): Promise<void> => {
    const listeners = options.events?.[name];
    if (listeners === undefined || listeners.length === 0) return;
    for (const listener of listeners) {
      try {
        await (listener.handle as (one: HostEvent, context: PluginContext) => void | Promise<void>)(event, listener.context);
      }
      catch (error) {
        options.onEvent?.(`${listener.by} failed at ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  /**
   * Whether a `log` raise is already on the stack.
   *
   * `log` is itself an event, so a listener that calls this host's `log` from
   * inside its own synchronous start would raise `log` again from within the
   * raise. The flag covers exactly that window - the synchronous part of
   * `fire`, where a handler's first segment runs - and is cleared the moment
   * `fire` suspends, so a host line written while a listener is awaiting is
   * still an event rather than being swallowed by a flag held across the whole
   * chain.
   */
  let logging = false;
  const log = (message: string): void => {
    options.onEvent?.(message);
    // The line is also an event, raised from the one place every notable line
    // already passes through, so a plugin reads the log without a second
    // mechanism and without having to be the embedder.
    if (options.events?.log !== undefined && !logging) {
      logging = true;
      try {
        void fire('log', { type: 'log', line: message });
      }
      finally {
        logging = false;
      }
    }
    /*
     * OTLP/JSON, verbatim, because the protocol says so: the payload is an
     * `ExportLogsServiceRequest` and AHP deliberately does not redeclare the
     * OpenTelemetry type system, so a client parses it with an OTel schema.
     * Building it by hand here is a dozen lines and saves a dependency that
     * would exist only to serialise one shape.
     */
    const at = String(Date.now() * 1_000_000);
    const payload = {
      resourceLogs: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'ahpd' } },
            { key: 'service.start_time', value: { stringValue: startedAt } },
          ],
        },
        scopeLogs: [{
          scope: { name: 'ahpd' },
          logRecords: [{
            timeUnixNano: at,
            observedTimeUnixNano: at,
            // One severity, because this host has one kind of line. A `log`
            // that took a level would be a second thing to keep in step with
            // every call site, and every call site here is an event.
            severityNumber: 9,
            severityText: 'INFO',
            body: { stringValue: message },
          }],
        }],
      }],
    };
    for (const level of ['info', '']) {
      const channel = level === '' ? LOGS : `${LOGS}/${level}`;
      for (const connection of connections) {
        // A notification, not an action: it carries no `serverSeq` and moves
        // no state, so it does not belong in the replay buffer.
        if (connection.watching.has(channel)) connection.peer.notify('otlp/exportLogs', { channel, payload });
      }
    }
  };
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
      return Status.Idle | kept.flags(idOf(uri));
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
    return activity | kept.flags(idOf(uri));
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
  /**
   * How this host names a session's first chat.
   *
   * `ahp-chat://default/<base64url(sessionUri)>`, which is the reference
   * implementation's shape and not the one the specification illustrates. That
   * is a deliberate retreat, and it was forced.
   *
   * The specification documents `ahp-chat:/<uuid>` and says the owning session
   * is "**not** encoded in the chat URI - the relationship is expressed via the
   * session's `chats` catalogue". This host published exactly that. VS Code's
   * client computes the other shape from the session instead of reading the
   * catalogue, and subscribes to what it computed - so it asked about a channel
   * that did not exist while the conversation sat on the one it had been told
   * about.
   *
   * Answering *both* was tried first and is not enough, because the disagreement
   * is not only about which channel to open. `defaultChat`, every entry in
   * `chats`, and `ChatState.resource` all name a chat too, and a client that
   * subscribed to one string and is then told the chat is at another cannot pair
   * them up: it holds a subscription nothing refers to and a reference nothing
   * is subscribed to. One name has to win everywhere, and it has to be the one
   * the only other implementation computes.
   *
   * The other spelling is still answered - see `chatOf` - so nothing holding an
   * older URI is broken by this.
   */
  const chatUriFor = (session: string): string =>
    `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

  /**
   * The session a chat URI belongs to, in either spelling.
   *
   * The new shape carries it; the old one is named after it. Undefined for
   * anything that is not a chat URI at all.
   */
  const sessionOfChat = (uri: string): string | undefined => {
    if (uri.startsWith('ahp-chat://')) {
      const [chatId, ...rest] = uri.slice('ahp-chat://'.length).split('/');
      const encoded = rest.join('/');
      if (chatId !== 'default' || encoded === '') return undefined;
      try {
        const session = Buffer.from(encoded, 'base64url').toString('utf8');
        return session.includes(':') ? session : undefined;
      }
      catch { return undefined; }
    }
    if (uri.startsWith('ahp-chat:/')) return nameOf(idOf(uri));
    return undefined;
  };

  /**
   * The chat a URI means, whichever spelling it was written in.
   *
   * A chat this host is actually holding under that exact name answers for
   * itself - a second chat's URI is the client's own and is not derived from
   * anything. Everything else is a first chat, named either way.
   */
  const sessionFor = (channel: string): string => heldAs(sessionOfChat(channel) ?? channel);

  /**
   * What somebody is part-way through typing in a chat with nothing running.
   *
   * A live chat holds its own draft, because two people on one session are
   * meant to see each other's. A session browsed out of the catalogue has no
   * process to hold one - and typing into it is exactly what somebody does
   * first, before there is any reason to start an agent. Refusing it made the
   * client revert the character it had already drawn, which is a composer that
   * empties itself as it is typed into.
   *
   * Kept here until the session is started, and handed to the chat when it is.
   */
  const drafts = new Map<string, Bag>();

  const chatOf = (uri: string): string => {
    if (byChat.has(uri)) return uri;
    const session = sessionOfChat(uri);
    if (session === undefined) return uri;
    return sessions.get(heldAs(session))?.defaultChat ?? chatUriFor(session);
  };

  /**
   * The channel a client's URI means here, in either family.
   *
   * A chat is resolved as a chat and a session as a session; anything else -
   * the root, a terminal, a watch - is already its own name. What comes back
   * is the name this host dispatches under, which is what a subscription has
   * to be keyed by; the name the client used is remembered as an alias so it
   * is also what the client is told.
   */
  const meantBy = (channel: string): string => {
    // Nested under a session, so it is resolved the way the session it hangs
    // off is: a client that opened the row under its own spelling dispatches
    // annotations under that spelling too.
    if (channel.endsWith(MARKS)) return `${heldAs(channel.slice(0, -MARKS.length))}${MARKS}`;
    if (isAutomations(channel)) return AUTOMATIONS;
    return sessionOfChat(channel) !== undefined ? chatOf(channel) : heldAs(channel);
  };
  /**
   * Whether a URI names the automations catalogue, under any spelling.
   *
   * There is one catalogue and the protocol names it `ahp-automations://`.
   * For two weeks the reference host spelt it `ahp-automations://catalog` -
   * an authority added so the URI survived a round trip through its own URI
   * class - and Insiders builds from that window still subscribe under it,
   * and were refused `-32001` here about a session nobody had named. The
   * reference host now takes anything on the scheme, and so does this one:
   * a client is answered under the spelling it used, the way a chat is.
   */
  const isAutomations = (channel: string): boolean => channel.startsWith('ahp-automations:');
  /**
   * What a client has marked on a session, by that session's id.
   *
   * Kept, not computed. Annotations are the one channel whose state is
   * entirely a client's: nothing here produces a mark, and what this host
   * contributes is that a mark one client made is a mark every other client
   * in the session can see. Keyed by id rather than by URI for the reason the
   * flags are - a session is addressable under more than one spelling and
   * there is only one set of marks.
   */
  const marks = new Map<string, AnnotationsState>();

  /**
   * The worktree each isolated session runs in, by session URI.
   *
   * Only the ones this host made. A directory somebody pointed a session at is
   * theirs, and removing it because a session ended would be this daemon
   * deleting a project.
   */
  const worktrees = new Map<string, { repository: string; path: string; branch?: string; base?: string }>();
  /**
   * The worktrees the reference window holds a handle on.
   *
   * Its dev container flow (`vscode/createAgentHostDetachedWorktree` and the
   * four beside it): a tree it asked for by handle before the session spoke,
   * claimed once the session started in it, taken down and put back with the
   * session's archived bit, deleted with it, and reconciled against the set
   * the window still knows about. Here a session's tree is made when the
   * session is, so a handle names a tree that already exists; what the
   * handle adds is the window's bookkeeping - claimed, archived, seen - and
   * its say over when the tree goes.
   */
  const detached = new Map<string, {
    session: string;
    repository: string;
    path: string;
    branch?: string;
    claimed: boolean;
    archived: boolean;
    createdAt: number;
    lastSeenAt: number;
  }>();
  /** How long an unclaimed handle, or a claimed one nobody has seen, is kept before a reconcile may reap it. */
  const DETACHED_GRACE = 24 * 60 * 60 * 1000;

  /**
   * The config keys this host answered for a session, by session URI.
   *
   * Kept because nothing else can say them back. `isolation` and its two
   * companions are stripped before the backend is handed anything, and a
   * session's channel reports the *backend's* settings - so a session created
   * as a worktree said nothing anywhere about why its directory was where it
   * was, and a client had to infer it from the path.
   */
  const decided = new Map<string, Record<string, string>>();
  /**
   * The isolation schema each session was offered when it was created.
   *
   * Kept because a session reports its own config schema and a client draws
   * its controls from that one rather than from `resolveSessionConfig`. Without
   * it a session could only describe the answer it already had - a row to read
   * - and the pre-send phase, where the answer is still somebody's to give, had
   * nothing to draw.
   */
  const offered = new Map<string, Bag>();
  /** The marks on a session, empty until somebody makes one. */
  const marksOf = (id: string): AnnotationsState => marks.get(id) ?? { annotations: [] };

  /**
   * A *session's* snapshot, answered under the name the client asked about.
   *
   * The resource is the easy half. The hard half is that a chat URI contains
   * its session's URI, so a session answered under a name other than the one
   * this host holds it by offers chat names built from the held name - while
   * the client subscribed to the ones it computed from its own. It then holds
   * a subscription nothing refers to and a `defaultChat` nothing is subscribed
   * to, and draws an empty conversation with no error at all, which is the
   * worst way for this to fail.
   *
   * For sessions only. A chat asked for under an alias may resolve to a
   * *different* chat - `default` is a role, and the default moves - and there
   * the client is told the name of the chat it actually landed on.
   */
  const spelledFor = (asked: string, snapshot: Record<string, unknown>): void => {
    // Read before it is overwritten: it is the name this host holds the
    // session under, and the prefix every URI built from it carries.
    const meant = typeof snapshot.resource === 'string' ? snapshot.resource : asked;
    snapshot.resource = asked;
    const state = snapshot.state;
    if (typeof state !== 'object' || state === null) return;
    const bag = state as Record<string, unknown>;
    if (typeof bag.resource === 'string') bag.resource = asked;
    /*
     * A changeset's URI is built from the session's, so a template is the
     * other name in disguise.
     *
     * This is how the held spelling escaped. A client resolves a changeset
     * channel back to the session that owns it, so a template naming
     * `ahp-session:/x` teaches a client that asked about `claude:/x` a second
     * name for the same session - and it then addresses the session, its chat
     * and its annotations under *that* one. Which of the two the renderer
     * ends up on is whichever subscription landed first, which is why the
     * conversation drew sometimes and not others.
     */
    if (Array.isArray(bag.changesets))
      bag.changesets = bag.changesets.map((one) => {
        if (typeof one !== 'object' || one === null) return one;
        const template = (one as Record<string, unknown>).uriTemplate;
        return typeof template === 'string' && template.startsWith(`${meant}/`)
          ? { ...(one as Record<string, unknown>), uriTemplate: `${asked}${template.slice(meant.length)}` }
          : one;
      });
    // Only the chats derived from this session are renamed. A chat a client
    // named itself is that client's name and stays as it was written.
    const mine = (uri: unknown): boolean => {
      if (typeof uri !== 'string') return false;
      const owning = sessionOfChat(uri);
      return owning !== undefined && owning !== uri && idOf(owning) === idOf(asked);
    };
    if (mine(bag.defaultChat)) bag.defaultChat = chatUriFor(asked);
    if (Array.isArray(bag.chats))
      bag.chats = bag.chats.map((chat) => (typeof chat === 'object' && chat !== null && mine((chat as Record<string, unknown>).resource)
        ? { ...(chat as Record<string, unknown>), resource: chatUriFor(asked) }
        : chat));
  };

  /**
   * One message, to everyone watching that channel.
   *
   * Addressed to each connection the way that connection asked: a client
   * watching an alias of this channel is sent the same payload under the name
   * it used, because its subscription is keyed by that name and it would drop
   * anything else.
   */
  const broadcast = (channel: string, method: string, params: unknown): void => {
    for (const connection of connections) {
      if (connection.watching.has(channel)) connection.peer.notify(method, params);
      // And under the older spelling, for a client still watching by that one.
      const alias = connection.aliases.get(channel);
      if (alias !== undefined && connection.watching.has(alias)) {
        connection.peer.notify(method, { ...(params as Record<string, unknown>), channel: alias });
      }
    }
  };
  /** Which client's dispatch an action is the echo of. */
  interface Origin {
    clientId: string;
    clientSeq: number;
  }
  /**
   * Whose dispatch is being applied right now.
   *
   * The protocol's write-ahead loop is: a client applies an action to its own
   * state, sends it with a `clientSeq`, and waits for this host to echo it
   * back carrying that number. Without the echo a client cannot tell its own
   * write from somebody else's, and cannot do the optimistic half at all.
   *
   * A variable rather than an argument threaded through everything, because
   * the echo is usually several layers down: a client's `chat/turnStarted`
   * arrives here as a notification, is handed to `Session.begin`, and is
   * emitted from inside the session as the turn opens. Carrying an origin
   * through that would be a parameter on every method a client action reaches.
   *
   * It is only ever held across *synchronous* work - `dispatchAction` sets it,
   * applies, and clears it in a `finally` with nothing awaited in between - so
   * nothing else can run while it is set and no action can be attributed to a
   * client that did not cause it. Anything that answers in a later turn of the
   * event loop, like a config key the backend has to be asked about, reads
   * nothing from here and is passed an origin of its own.
   */
  let applying: Origin | undefined;
  /**
   * One state action, to everyone watching that channel.
   *
   * `serverSeq` moves here and only here. A snapshot is taken *at* a sequence
   * number and every action after it carries a greater one, which is how a
   * client knows it missed nothing - so the counter has to advance with state,
   * never with messages.
   */
  /**
   * A resource that needs signing into, said as the protocol's own notification.
   *
   * `auth/required` is connection-level rather than a state action: a client
   * reads it and pushes a token back with `authenticate`. Sent off the same
   * state change that carries the requirement - an MCP server saying
   * `authRequired` - so there is one source for the fact and no second thing
   * to keep in step.
   *
   * Only to connections watching that session, because that is the channel
   * the notification names and the only place the requirement is visible.
   */
  const asked = new Set<string>();
  const asking = (channel: string, action: Record<string, unknown>): void => {
    if (String(action.type ?? '') !== 'session/mcpServerStateChanged') return;
    const state = (typeof action.state === 'object' && action.state !== null ? action.state : {}) as Bag;
    if (state.kind !== 'authRequired') return;
    const resource = (typeof state.resource === 'object' && state.resource !== null ? state.resource : {}) as Bag;
    const named = typeof resource.resource === 'string' ? resource.resource : undefined;
    // Once per resource: the state is re-read on every refresh, and a client
    // asked to sign in on a loop is one that never finishes signing in.
    if (named === undefined || asked.has(named)) return;
    asked.add(named);
    for (const connection of connections) {
      if (connection.watching.has(channel)) {
        connection.peer.notify('auth/required', { channel, resource, reason: 'required' });
      }
    }
  };

  /**
   * Turns and tool calls, as OTLP spans and counters.
   *
   * Built from the actions this host already dispatches rather than from the
   * backend: a turn is a span because it starts, ends and has a duration, and
   * every tool call inside it is a child of that span. Nothing here asks the
   * backend for anything, so a second backend gets the same telemetry without
   * knowing this exists.
   *
   * Each span is sent as it ends, which is what `ExportTraceServiceRequest`
   * is for - a collector joins them by `traceId`, and holding a turn's
   * children until the turn finished would lose them all if the daemon went.
   */
  const turning = new Map<string, { trace: string; span: string; at: number; text: string }>();
  const calling = new Map<string, { span: string; at: number; name: string; turn: string }>();
  let turnsRun = 0;
  let toolsRun = 0;

  /** One span, on the wire, with the resource it belongs to. */
  const spanned = (span: Bag): void => {
    telling('otlp/exportTraces', TRACES, {
      resourceSpans: [{ resource: attributed(), scopeSpans: [{ scope: { name: 'ahpd' }, spans: [span] }] }],
    });
  };

  /**
   * What is true of this host right now, as OTLP metrics.
   *
   * Cumulative sums with the process start as their reference point, which is
   * what `aggregationTemporality: 2` means - a collector restarted mid-run
   * reads the totals rather than a difference it missed the start of.
   */
  const measured = (extra: Bag[] = []): void => {
    const at = String(Date.now() * 1_000_000);
    const sum = (name: string, count: number, unit: string): Bag => ({
      name,
      unit,
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: [{ asInt: String(count), startTimeUnixNano: String(Date.parse(startedAt) * 1_000_000), timeUnixNano: at }],
      },
    });
    telling('otlp/exportMetrics', METRICS, {
      resourceMetrics: [{
        resource: attributed(),
        scopeMetrics: [{
          scope: { name: 'ahpd' },
          metrics: [
            sum('ahpd.turns', turnsRun, '{turn}'),
            sum('ahpd.tool_calls', toolsRun, '{call}'),
            ...extra,
          ],
        }],
      }],
    });
  };

  /** A turn or a tool call moving, as far as telemetry is concerned. */
  const telemetered = (channel: string, action: Record<string, unknown>): void => {
    const type = String(action.type ?? '');
    if (!type.startsWith('chat/')) return;
    const turnId = String(action.turnId ?? '');
    const at = String(Date.now() * 1_000_000);
    if (type === 'chat/turnStarted') {
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as { text?: unknown };
      turning.set(turnId, {
        trace: hex(16),
        span: hex(8),
        at: Date.now(),
        text: typeof message.text === 'string' ? message.text : '',
      });
      return;
    }
    const turn = turning.get(turnId);
    if (turn === undefined) return;
    if (type === 'chat/toolCallStart') {
      calling.set(String(action.toolCallId ?? ''), {
        span: hex(8),
        at: Date.now(),
        name: String(action.toolName ?? 'tool'),
        turn: turnId,
      });
      return;
    }
    if (type === 'chat/toolCallComplete') {
      const call = calling.get(String(action.toolCallId ?? ''));
      if (call === undefined) return;
      calling.delete(String(action.toolCallId ?? ''));
      toolsRun += 1;
      spanned({
        traceId: turn.trace,
        spanId: call.span,
        parentSpanId: turn.span,
        name: call.name,
        // A tool call is work this host asked something else to do, which is
        // what `SPAN_KIND_CLIENT` is.
        kind: 3,
        startTimeUnixNano: String(call.at * 1_000_000),
        endTimeUnixNano: at,
        attributes: [
          { key: 'ahp.chat', value: { stringValue: channel } },
          { key: 'ahp.tool', value: { stringValue: call.name } },
        ],
      });
      return;
    }
    if (type !== 'chat/turnComplete' && type !== 'chat/turnCancelled') return;
    turning.delete(turnId);
    turnsRun += 1;
    spanned({
      traceId: turn.trace,
      spanId: turn.span,
      name: 'turn',
      // The turn is work this host is doing on somebody's behalf, which is
      // `SPAN_KIND_SERVER`.
      kind: 2,
      startTimeUnixNano: String(turn.at * 1_000_000),
      endTimeUnixNano: at,
      attributes: [
        { key: 'ahp.chat', value: { stringValue: channel } },
        { key: 'ahp.turn', value: { stringValue: turnId } },
      ],
      // Cancelled is not an error - somebody asked - so the only status this
      // sets is the one the protocol's own action names.
      ...(type === 'chat/turnCancelled' ? { status: { code: 2, message: 'cancelled' } } : {}),
    });
    measured();
  };

  const dispatch = (channel: string, action: Record<string, unknown>, origin = applying): void => {
    serverSeq += 1;
    const envelope = { channel, action, serverSeq, origin };
    // Kept whether or not anyone was listening: a client that dropped is by
    // definition not listening, and it is the one that will ask for these.
    //
    // Kept as a *value*, for the reason a snapshot is one. These actions are
    // built out of the host's live structures - the `part` a
    // `chat/responsePart` announces is the object the deltas after it are
    // still writing into - and an envelope held for replay is serialised long
    // after it was made. By reference, a response part replayed to a client
    // that arrived late already carries the text of every delta that
    // followed, and the client then applies those deltas too: the word
    // written twice. The live broadcast below is serialised in this same
    // tick, so it is the copy in the buffer that has to be frozen.
    telemetered(channel, action);
    asking(channel, action);
    replayable.push({ ...envelope, action: structuredClone(action) });
    if (replayable.length > REPLAY) replayable.shift();
    broadcast(channel, 'action', envelope);
  };
  /**
   * A client's action, refused in that client's hearing.
   *
   * The other half of the write-ahead loop. A client applies an action before
   * sending it, so a host that decides not to apply one has to *say so*: an
   * envelope carrying `rejectionReason` is what tells the client to put its own
   * state back. Dropping it - which is what every one of these sites used to do
   * - leaves the client holding a change this host never made, with nothing
   * anywhere to correct it. The log line goes to the daemon's stdout, where no
   * client is looking.
   *
   * Three things it deliberately does not do.
   *
   * `serverSeq` does not move, because no state did. The counter's whole job is
   * to let a client tell what it has already seen from what is still to come,
   * and a refusal is neither: it carries the sequence this host is *still* at.
   *
   * It is not buffered for replay, for the same reason. A client that comes
   * back is asking what it missed of the state, and this changed none of it.
   *
   * It goes to the one connection that sent it rather than to everyone watching
   * the channel. A refusal answers one client's dispatch; nobody else applied
   * it optimistically, so nobody else has anything to put back - and a client
   * that reduced a rejected envelope would apply the very change this host
   * refused.
   */
  const refuse = (
    peer: Peer,
    channel: string,
    action: Record<string, unknown>,
    origin: Origin | undefined,
    reason: string,
  ): void => {
    log(`${channel}: ${reason}`);
    peer.notify('action', { channel, action, serverSeq, origin, rejectionReason: reason });
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
  const activeClientsOf = (uri: string): Bag[] => [...(presence.get(idOf(uri))?.values() ?? [])];

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
    const held = presence.get(idOf(uri));
    if (!held?.has(clientId)) return;
    for (const connection of connections) {
      if (connection.clientId === clientId && connection.watching.has(uri)) return;
    }
    held.delete(clientId);
    if (held.size === 0) presence.delete(idOf(uri));
    dispatch(uri, { type: 'session/activeClientRemoved', clientId });
    /*
     * And the tools it was providing, which leave with it.
     *
     * Both halves matter. The model is offered a smaller list from here on -
     * a tool whose client has gone is one every call to would fail - and any
     * call already out with that client is failed now rather than left as a
     * turn waiting on a promise nothing can settle.
     */
    for (const chat of sessions.get(uri)?.chats.values() ?? []) chat.clientGone?.(clientId);
    retool(uri);
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

  /**
   * One live session, as a catalogue row.
   *
   * Undefined for a session this host is not running, which is not an error: a
   * row read from a transcript is in the catalogue and has no `Held`.
   */
  /** The diff stat a catalogue row carries, which a session's own state does not. */
  const changesOf = (uri: string): Bag => {
    const dir = dirOf(uri);
    const summary = dir === undefined ? undefined : options.changes?.summary(dir);
    return summary?.files ? { changes: summary } : {};
  };
  const summaryOf = (uri: string): Bag | undefined => {
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    if (!held || !lead) return undefined;
    return {
      resource: uri,
      provider: held.agent.provider,
      title: lead.title(),
      status: statusOf(uri),
      ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
      createdAt: held.createdAt,
      modifiedAt: modifiedOf(held),
      workingDirectories: lead.workingDirectories(),
      // A row's own field, and a row's alone: `SessionState` does not declare
      // it, so it is added here rather than in `describes`.
      ...changesOf(uri),
      ...describes(uri),
    };
  };
  /** A session appeared. Carries the whole row, because no client has one yet. */
  const sessionAdded = (uri: string): void => {
    const summary = summaryOf(uri);
    if (!summary) return;
    broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary });
  };
  /**
   * A session already in the catalogue moved.
   *
   * `session` and `changes`, which are the names the protocol gives these. This
   * carried `resource` and a whole `summary` under names of its own, so a
   * client read `undefined` for both and its cached list never moved.
   *
   * `changes` is a *partial*: only fields that can change belong in it, and the
   * three identity fields - `resource`, `provider`, `createdAt` - MUST be left
   * out. Every mutable field goes rather than a computed diff, because they are
   * all read off live objects in one pass anyway and a client applying a field
   * to the value it already had is a no-op.
   *
   * A session with no agent running still has a status - read and archived are
   * this host's bits and belong to the row rather than to any process - so the
   * fallback is that one field rather than silence. Silence is what this did
   * before, and it was exactly the case that needed saying: marking a row read
   * is something somebody does from the catalogue, to a session nobody has
   * opened.
   */
  const summaryMoved = (uri: string): void => {
    const summary = summaryOf(uri);
    let changes: Bag = { status: statusOf(uri) };
    if (summary !== undefined) {
      const { resource: _resource, provider: _provider, createdAt: _createdAt, ...mutable } = summary;
      /*
       * `activity: null` when there is none, rather than no key.
       *
       * A partial is applied by spreading it over the row a client holds,
       * so a key that is not there is a field that did not change - and a
       * session that has gone idle has no activity to carry, which left
       * every row in the reference client saying what its last tool was
       * doing until something else about it moved. That client reads
       * `null` as "cleared" and its host sends it; the type says `string`,
       * and this is the one place the wire carries what the type does not,
       * because a row that never goes quiet is worse than a field that is
       * off-schema by one value.
       */
      changes = { ...mutable, activity: mutable.activity ?? null };
    }
    broadcast(ROOT, 'root/sessionSummaryChanged', { channel: ROOT, session: uri, changes });
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
    void (options.directories?.refresh?.(dir_) ?? Promise.resolve(false))
      .then(() => refreshPullRequests(dir_))
      .catch(() => {});
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
      /*
       * Which sessions it has, as the difference rather than the list.
       *
       * `automationRun/sessionSet` appends one and `sessionRemoved` takes one
       * away - there is no action carrying the whole set - so what is sent is
       * what moved since the last time this looked. A run that started one
       * session says so once; one whose session was disposed says that too,
       * and a client watching the run channel is not left pointing at a
       * channel nobody can open.
       */
      const before = linked.get(event.run) ?? [];
      for (const gone of before.filter((one) => !run.sessions.includes(one)))
        dispatch(event.run, { type: 'automationRun/sessionRemoved', session: gone });
      for (const added of run.sessions.filter((one) => !before.includes(one)))
        dispatch(event.run, { type: 'automationRun/sessionSet', session: added });
      linked.set(event.run, [...run.sessions]);
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
    const named = heldAs(uri);
    const held = sessions.get(named);
    const lead = held && leadOf(held);
    const where = lead?.workingDirectories()[0] ?? wheres.get(named)?.[0];
    return where?.replace(/^file:\/\//, '');
  };

  /** What the window's "collect logs" gets, and reads back. */
  const logs = debugLogs();

  /**
   * The backend's own file for a session, or for one chat of it.
   *
   * A chat here is its own backend session with an id of its own, so a chat
   * named is that id; a session named is its lead's. A row that is not
   * running has the id in its URI, which is what the catalogue listed it by.
   */
  const stateFileOf = (session: string, chat?: string): string | undefined => {
    const uri = sessions.has(session) ? session : sessionFor(session);
    const held = sessions.get(uri);
    const agent = held?.agent ?? owners.get(uri);
    const dir = dirOf(uri);
    const chosen = chat === undefined ? undefined : byChat.get(chat);
    if (chat !== undefined && chosen?.uri !== uri) throw new RpcError(-32602, 'chat must belong to the requested Agent Session');
    if (agent?.stateFile === undefined || dir === undefined) return undefined;
    const live = chosen?.chat ?? (held ? leadOf(held) : undefined);
    return agent.stateFile(live?.agentId() ?? idOf(uri), dir);
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
  /**
   * What the host knows that bears on a changeset's verbs.
   *
   * The base branch it chose for a worktree; GitHub, when there is a way to
   * ask it and the directory's remote is there, with the token a client lent;
   * whether the branch already has a pull request; and whether the session
   * has said anything yet. Read at the moment of asking, since every one of
   * them moves.
   */
  const operationContext = (uri: string, dir: string): ChangesetOperationContext => {
    const base = worktrees.get(uri)?.base;
    const git = (options.directories?.meta(dir) as { git?: Record<string, unknown> } | undefined)?.git;
    const facts = githubFacts.get(dir) as { pullRequestUrls?: string[]; pullRequestBranchName?: string } | undefined;
    const owner = git?.githubOwner;
    const repo = git?.githubRepo;
    const token = options.github === undefined ? undefined : lent(String(options.github.resource.resource ?? ''));
    const github = options.github !== undefined && typeof owner === 'string' && typeof repo === 'string'
      ? { ask: options.github, owner, repo, ...(token === undefined ? {} : { token }) }
      : undefined;
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    return {
      ...(base !== undefined && base !== 'HEAD' ? { base } : {}),
      ...(github !== undefined ? { github } : {}),
      ...(facts?.pullRequestUrls !== undefined && facts.pullRequestBranchName === git?.branchName ? { pullRequest: true } : {}),
      ...(lead !== undefined && lead.allTurns().length === 0 ? { unused: true } : {}),
    };
  };
  const operationsOf = (channel: string): Bag[] => {
    const at = changesetAt(channel);
    if (!at) return [];
    const busy = (statusOf(at.owner) & Status.InProgress) !== 0;
    return (options.changes?.operations?.(at.dir, at.owner, at.scope, operationContext(at.owner, at.dir)) ?? []).map((operation) => {
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
   * What every client watching a changeset was last told it holds.
   *
   * Kept per channel and not per connection, because it is the same for all
   * of them: a snapshot is taken at a `serverSeq` and every action after it
   * goes to everyone, so what one subscriber has is what all of them have.
   */
  const shown = new Map<string, { files: ChangesetFile[]; status: string }>();

  /** Two file lists, same order-independent contents. */
  const sameFiles = (a: ChangesetFile[], b: ChangesetFile[]): boolean => {
    if (a.length !== b.length) return false;
    const was = new Map(a.map((file) => [file.id, JSON.stringify(file)]));
    return b.every((file) => was.get(file.id) === JSON.stringify(file));
  };

  /**
   * A changeset's new contents, said in whichever form is smaller.
   *
   * The incremental actions when a handful of files moved, and the whole set
   * when more moved than there are files to send: a changeset of four hundred
   * files re-sent because one of them changed is the case these exist for, and
   * one of four files sent as five actions is the case they are worse at.
   *
   * The two reduce to the same state, which is what makes choosing between
   * them safe - `changesetReducer` applies `fileSet` and `fileRemoved` to the
   * same list `contentChanged` replaces wholesale.
   */
  const told = (channel: string, state: ChangesetState, operations: Bag[]): void => {
    const files = state.files;
    const status = typeof state.status === 'string' ? state.status : 'idle';
    const was = shown.get(channel);
    const whole = (): void => {
      dispatch(channel, {
        type: 'changeset/contentChanged',
        files,
        ...(operations.length > 0 ? { operations } : {}),
      });
    };
    shown.set(channel, { files, status });
    // Nothing to diff against: this client's first word about the channel is
    // the whole of it, which is what a snapshot would have been.
    if (!was) { whole(); return; }
    if (was.status !== status) dispatch(channel, { type: 'changeset/statusChanged', status });
    if (sameFiles(was.files, files)) {
      // The status moved and the files did not, which is the ordinary shape of
      // a changeset being recomputed. Re-sending the list would be the whole
      // set to say nothing.
      if (operations.length > 0) dispatch(channel, { type: 'changeset/operationsChanged', operations });
      return;
    }
    // Everything gone is one action rather than one per file, which is what
    // the protocol has `cleared` for.
    if (files.length === 0) {
      dispatch(channel, { type: 'changeset/cleared' });
      if (operations.length > 0) dispatch(channel, { type: 'changeset/operationsChanged', operations });
      return;
    }
    const before = new Map(was.files.map((file) => [file.id, JSON.stringify(file)]));
    const now = new Set(files.map((file) => file.id));
    const gone = was.files.filter((file) => !now.has(file.id));
    const moved = files.filter((file) => before.get(file.id) !== JSON.stringify(file));
    if (gone.length + moved.length >= files.length) { whole(); return; }
    for (const file of gone) dispatch(channel, { type: 'changeset/fileRemoved', fileId: file.id });
    for (const file of moved) dispatch(channel, { type: 'changeset/fileSet', file });
    if (operations.length > 0) dispatch(channel, { type: 'changeset/operationsChanged', operations });
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
        told(channel, state, operations);
      }
    }
  };

  /**
   * The changesets this session can be asked about, as URIs a client
   * subscribes to.
   *
   * A field of `SessionState`, and of nothing else. It used to be part of
   * `describes`, which is spread into a `SessionSummary` as well - so every
   * catalogue row and every `root/sessionSummaryChanged` carried a key the
   * protocol does not declare on a summary, and carried it once per row. A
   * receiver ignores what it does not understand, so nothing broke; what it
   * cost was weight on the busiest notification this host sends, and a second
   * place to read an answer the session channel already gives.
   *
   * A template with no variables in it is the whole scope; the ones with
   * `{turnId}` are not served yet.
   */
  const changesetsOf = (uri: string): Bag => {
    const dir = dirOf(uri);
    if (dir === undefined) return {};
    const changesets = catalogueOf(uri, dir);
    return changesets.length > 0 ? { changesets } : {};
  };
  /**
   * What a backend may be handed a token for: its own, and GitHub's.
   *
   * The reference host lists its GitHub repository resource on every agent,
   * because the token is the host's to use - for the pull request beside a
   * branch - whichever backend the session runs on. So it is listed here the
   * same way, when there is a lookup to spend it on.
   */
  const resourcesOf = (agent: Agent): Bag[] => [
    ...(agent.protectedResources ?? []) as Bag[],
    ...(options.github ? [options.github.resource] : []),
  ];
  /** A token any connected client lent for a resource, and has not run out. */
  const lent = (resource: string): string | undefined => {
    for (const connection of connections) {
      const held = connection.tokens.get(resource);
      if (held !== undefined && !(held.expiresAt !== undefined && held.expiresAt <= Date.now())) return held.token;
    }
    return undefined;
  };
  /**
   * What GitHub said about each served directory's branch, under the
   * reference host's key and field names (`ISessionGitHubState`).
   *
   * Per directory, like the git facts, since a pull request is a branch's
   * and the branch is the directory's. `pullRequestBranchName` says which
   * branch the URLs were found on, so a row on another branch does not draw
   * them; `pullRequestStateUrl` says which URL the state is of.
   */
  const githubFacts = new Map<string, Bag>();
  /**
   * The session's `_meta`, whole.
   *
   * `git` is the port's answer plus the one fact only this host knows - the
   * branch a worktree was cut from - and `github` is what was last heard from
   * GitHub. Composed in one place because `session/metaChanged` replaces the
   * map entirely: a producer that dispatched its own part would erase the
   * other's.
   */
  const metaOf = (uri: string): Bag | undefined => {
    const dir = dirOf(uri);
    if (dir === undefined) return undefined;
    const meta = options.directories?.meta(dir);
    const base = worktrees.get(uri)?.base;
    const git = typeof (meta as { git?: unknown } | undefined)?.git === 'object'
      ? (meta as { git: Record<string, unknown> }).git
      : undefined;
    const told = base !== undefined && base !== 'HEAD' && git !== undefined
      ? { ...meta, git: { ...git, baseBranchName: base } }
      : meta;
    const github = githubFacts.get(dir);
    const artifacts = kept.artifacts(idOf(uri));
    const baseline = kept.pullRequests(idOf(uri));
    if (told === undefined && github === undefined && artifacts === undefined && baseline === undefined) return undefined;
    return {
      ...told,
      // The directory's facts and the session's baseline meet here: the
      // baseline is one session's and the facts are every session's in the
      // directory, and `session/metaChanged` carries the whole map.
      ...(github !== undefined || baseline !== undefined
        ? {
          github: {
            ...github,
            ...(baseline === undefined ? {} : {
              initialPullRequestUrls: baseline.initialPullRequestUrls,
              associatedPullRequestUrls: baseline.associatedPullRequestUrls,
            }),
          },
        }
        : {}),
      // The session's own, beside the directory's: what the agent recorded
      // as worth coming back to, under the key the reference client reads.
      ...(artifacts !== undefined && artifacts.length > 0 ? { [ARTIFACTS_META]: artifacts } : {}),
    };
  };
  /**
   * Capture a session's pull request baseline, once.
   *
   * Called the first time GitHub answers for the directory and again when a
   * session opens onto facts already held. The first answer wins: an empty
   * array is a captured baseline, and a later answer says what the branch
   * has now rather than what it had when the session began.
   */
  const captureBaseline = (uri: string, urls: string[]): void => {
    if (kept.pullRequests(idOf(uri)) !== undefined) return;
    kept.setPullRequests(idOf(uri), { initialPullRequestUrls: [...urls], associatedPullRequestUrls: [] });
  };
  /** The comparison the reference makes, so a URL with a trailing slash is the same one. */
  const urlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();
  /**
   * Move a pull request out of the baseline and into the session's own.
   *
   * Called when the pull request becomes the session's, which is the
   * `create-pr` association. The URL leads the associated list, leaves the
   * initial one whatever spelling it arrived with, and `pullRequestUrls` is
   * left alone: that is the directory's whole set and `refreshPullRequests`
   * is its writer.
   */
  const promotePullRequest = (uri: string, url: string): void => {
    const held = kept.pullRequests(idOf(uri));
    const seen = new Set<string>();
    const associatedPullRequestUrls: string[] = [];
    for (const one of [url, ...(held?.associatedPullRequestUrls ?? [])]) {
      const key = urlKey(one);
      if (seen.has(key)) continue;
      seen.add(key);
      associatedPullRequestUrls.push(one);
    }
    const promoted = urlKey(url);
    kept.setPullRequests(idOf(uri), {
      initialPullRequestUrls: (held?.initialPullRequestUrls ?? []).filter((one) => urlKey(one) !== promoted),
      associatedPullRequestUrls,
    });
  };
  /**
   * Replace what a session recorded, and say so.
   *
   * `session/metaChanged` carries the whole map, which `metaOf` composes; the
   * row moves with it, since the window draws the pills from the row.
   */
  const setArtifacts = (uri: string, list: Bag[]): void => {
    kept.setArtifacts(idOf(uri), list);
    const meta = metaOf(uri);
    dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
    summaryMoved(uri);
  };
  /**
   * What is true of a session because of where it is.
   *
   * Spread into a `SessionState` and into a `SessionSummary` alike, so only
   * fields both declare belong here - see `changesetsOf` for the one that had
   * to come out.
   */
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
    const told = metaOf(uri);
    const summary = options.changes?.summary(dir);
    return {
      project,
      ...(told ? { _meta: told } : {}),
      // Not `changes`: `SessionSummary` declares it and `SessionState` does
      // not, so it goes on the row rather than in both - which is the rule
      // this helper states and had broken.

    };
  };

  /** Every session in a directory, since a fact is the directory's. */
  const inThere = (dir: string): string[] => [...sessions.keys()].filter((uri) => dirOf(uri) === dir);
  /** `_meta` moved: every session in the directory says so, and its row. */
  const metaMoved = (dir: string): void => {
    for (const uri of inThere(dir)) {
      const meta = metaOf(uri);
      dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
      summaryMoved(uri);
      // And the verbs, since a branch that gained a pull request offers
      // different ones from a branch that lacks it.
      operationsMoved(uri);
    }
  };
  /**
   * Ask GitHub about the branch a directory is on, answering whether what it
   * said differs from what was held.
   *
   * Only where the git facts name a GitHub remote and a branch. Asked with a
   * token a client lent when one has, and otherwise however the port can;
   * an answer that fails keeps what was held rather than erasing it, since
   * the network being down is not the pull request being gone. The state is
   * of the newest request, which is the one the row draws.
   */
  const refreshPullRequests = async (dir: string): Promise<boolean> => {
    if (options.github === undefined) return false;
    const git = (options.directories?.meta(dir) as { git?: Record<string, unknown> } | undefined)?.git;
    const owner = git?.githubOwner;
    const repo = git?.githubRepo;
    const branch = git?.branchName;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof branch !== 'string') {
      return githubFacts.delete(dir);
    }
    const resource = String(options.github.resource.resource ?? '');
    let found;
    try {
      found = await options.github.forBranch({ owner, repo }, branch, lent(resource), dir);
    }
    catch (error) {
      log(`${dir}: GitHub did not answer for ${branch}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const newest = found[0];
    const now: Bag = {
      owner,
      repo,
      ...(newest === undefined ? {} : {
        pullRequestUrls: found.map((one) => one.url),
        pullRequestBranchName: branch,
        pullRequestState: newest.state,
        pullRequestStateUrl: newest.url,
      }),
    };
    const before = githubFacts.get(dir);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(now)) return false;
    githubFacts.set(dir, now);
    // Every session in the directory that has no baseline yet began before
    // this answer, so this is the branch it started on.
    const urls = Array.isArray(now.pullRequestUrls)
      ? now.pullRequestUrls.filter((one): one is string => typeof one === 'string')
      : [];
    for (const uri of inThere(dir)) captureBaseline(uri, urls);
    return true;
  };

  /**
   * Record the pull request an operation opened or found again, and say so.
   *
   * The same promotion the add tool runs, since a reference to the same URL is
   * upgraded rather than duplicated. The association is written before
   * `refreshFacts` asks GitHub, so the operation's own answer is already there
   * and GitHub's later answer is the one that survives.
   */
  const recordPullRequest = (uri: string, dir: string, pullRequest: { url: string; title: string; branch: string }): void => {
    const recorded = recordArtifact(artifactsIn(kept.artifacts(idOf(uri))), {
      type: 'pullRequest',
      label: pullRequest.title,
      isArtifact: true,
      link: pullRequest.url,
      isGitHub: isGitHubLink(pullRequest.url),
    }, () => crypto.randomUUID());
    setArtifacts(uri, recorded.held as unknown as Bag[]);
    // In the same write as the artifact, so one `_meta` move says both and a
    // client never sees the artifact without the promotion that came with it.
    promotePullRequest(uri, pullRequest.url);

    const held = githubFacts.get(dir) ?? {};
    const urls = Array.isArray(held.pullRequestUrls)
      ? held.pullRequestUrls.filter((one): one is string => typeof one === 'string')
      : [];
    const now: Bag = {
      ...held,
      pullRequestUrls: [pullRequest.url, ...urls.filter((one) => one !== pullRequest.url)],
      pullRequestBranchName: pullRequest.branch,
    };
    // The state is kept only while it names the URL being associated.
    delete now.pullRequestState;
    delete now.pullRequestStateUrl;
    if (held.pullRequestStateUrl === pullRequest.url) {
      now.pullRequestState = held.pullRequestState;
      now.pullRequestStateUrl = held.pullRequestStateUrl;
    }
    githubFacts.set(dir, now);
    metaMoved(dir);
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
    void (options.directories?.refresh?.(dir) ?? Promise.resolve(false)).then(async (moved) => {
      if (moved) metaMoved(dir);
      if (await refreshPullRequests(dir)) metaMoved(dir);
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
      for (const uri of inThere(dir)) {
        // Asked per session, because two of the scopes are the session's own.
        dispatch(uri, { type: 'session/changesetsChanged', changesets: catalogueOf(uri, dir) });
        summaryMoved(uri);
      }
    }).catch(() => {});
  };

  const spawn = (
    agent: Agent,
    uri: string,
    chatUri: string,
    config: Record<string, unknown>,
    resuming?: { resume?: string; seed?: Bag[]; forkAt?: string; rewindAt?: string; context?: string },
    workingDirectory?: string,
    credentials?: Record<string, string>,
    additional?: string[],
  ): Session => {
    const session = agent.create({
      uri,
      chatUri,
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
      ...(boundTools(uri, chatUri).length > 0 ? { tools: boundTools(uri, chatUri) } : {}),
      ...(instructions(uri).length > 0 ? { instructions: instructions(uri) } : {}),
      /*
       * The stores a backend may need for itself, handed down only when the
       * host holds them. Files are this host's own store, so a backend reads
       * what a client reads. `terminals` is not that store but the factory
       * over it: the host owns the URI, the root registration and the emit,
       * and a backend given the raw port would get none of the three.
       */
      ...(options.resources !== undefined ? { resources: options.resources } : {}),
      ...(options.terminals !== undefined ? { terminals: heldTerminals(options.terminals, uri, chatUri) } : {}),
      ...(credentials && Object.keys(credentials).length > 0 ? { credentials } : {}),
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(additional !== undefined && additional.length > 0 ? { additional } : {}),
      ...(resuming?.resume !== undefined ? { resume: resuming.resume } : {}),
      ...(resuming?.seed !== undefined ? { seed: resuming.seed } : {}),
      ...(resuming?.forkAt !== undefined ? { forkAt: resuming.forkAt } : {}),
      ...(resuming?.rewindAt !== undefined ? { rewindAt: resuming.rewindAt } : {}),
      ...(resuming?.context !== undefined ? { context: resuming.context } : {}),
      settings: { ...agent.defaults(), ...config },
      schema: () => published(agent.schema()),
      // What the boot probe already learned: the commands behind a slash, the
      // skills, the subagents and the MCP servers. A session that answered
      // `[]` until its own agent replied was empty for the first several
      // seconds - and a client that asks once and caches never found out
      // otherwise.
      seedCustomizations: about(agent.provider).seeds,
      emit: (channel, action) => {
        dispatch(channel === 'chat' ? chatUri : uri, action);
        // The two ends of a turn, as the host sees them: the backend saying it
        // began, and saying it finished or was stopped. A per-token delta is
        // not an event, because a plugin that wants the stream is a client.
        if (action.type === 'chat/turnStarted') {
          void fire('turn_start', { type: 'turn_start', session: uri, chat: chatUri, turn: String(action.turnId ?? '') });
        }
        else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          void fire('turn_end', {
            type: 'turn_end',
            session: uri,
            chat: chatUri,
            turn: String(action.turnId ?? ''),
            status: action.type === 'chat/turnCancelled' ? 'cancelled' : 'complete',
          });
        }
        /*
         * And the run this session was started for, when the turn that was it
         * ends. One call per action, so a run is never settled twice for one
         * event.
         */
        if (action.type === 'chat/turnComplete') settleRun(uri, { status: 'completed' });
        else if (action.type === 'chat/turnCancelled') settleRun(uri, { status: 'cancelled' });
        else if (action.type === 'chat/error') {
          // `ChatErrorAction.part` is `{ kind: 'error', error: { errorType,
          // message } }`, and only the message is worth carrying into a run.
          const part = (action.part ?? {}) as Bag;
          const failure = (part.error ?? {}) as Bag;
          settleRun(uri, {
            status: 'failed',
            error: { message: typeof failure.message === 'string' ? failure.message : 'The run failed' },
          });
        }
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
            dispatch(uri, { type: 'session/chatUpdated', chat: chatUri, changes: chatSummary(uri, chatUri, moved) });
          }
        }
        // A turn starting or finishing moves the catalogue too, and a client
        // watching only the list is the one that most needs telling.
        summaryMoved(uri);
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
        // And a move the agent asked for is made now, once its turn is over:
        // the one moment the backend can be started again without losing
        // anything.
        if ((action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error')
          && moving.get(uri)?.chat === chatUri) {
          const move = moving.get(uri) as { chat: string; directory: string; isolation: boolean };
          moving.delete(uri);
          void moveSession(uri, move).catch((error: unknown) => {
            log(`${uri} could not move to ${move.directory}: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
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
     * The name it had before, when it is being created again.
     *
     * A chat's title is its own and the catalogue's is derived, so the store
     * is what remembers it across a restart. Applied here, before the chat is
     * announced or handed to a backend, so a client never sees the derived
     * name first and then a correction.
     */
    const named_ = kept.chatTitle(idOf(uri), chatUri);
    if (named_ !== undefined) session.setTitle?.(named_);
    // Named by whoever created it, which is the client. Recorded so every
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
    /*
     * With the provider on each, which `SessionModelInfo` requires.
     *
     * The backend answers `{ id, name }` because a backend has one provider
     * and naming it on every row would be the same word repeated; the wire
     * type wants it on each model, and this is the only place that knows it.
     * It was simply absent before, which is a required field never sent.
     */
    models: about(agent.provider).models.map((model) => ({ ...model, provider: agent.provider })),
    /*
     * What a client may send a token for.
     *
     * The protocol says `authenticate`'s `resource` MUST match one the server
     * has itself advertised, so this list is not decoration - it is the whole
     * door. A host advertising none can be handed no credential at all, which
     * is what this one used to be.
     */
    ...(resourcesOf(agent).length > 0
      ? { protectedResources: resourcesOf(agent) }
      : {}),
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
      multipleChats: {
        ...(agent.chats?.fork ? { fork: true } : {}),
        ...(agent.chats?.sideChat ? { sideChat: true } : {}),
      },
      /*
       * More than one directory, with the first of them fixed.
       *
       * `immutablePrimary` because the backend's process is rooted at index 0
       * and that root cannot move while it runs. `primaryReplacement` beside
       * it because this host *can* replace that slot - it starts the backend
       * again in the new directory - and the protocol says a backend MAY
       * advertise both, so a client that knows only the older capability keeps
       * the safe reading and a newer one gets the action.
       */
      ...(agent.multipleDirectories
        ? { multipleWorkingDirectories: { immutablePrimary: true, primaryReplacement: true } }
        : {}),
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
        const resource = `${agent.provider}:/${row.id}`;
        // Remembered as it is listed: opening a row asks its backend for the
        // transcript, and the URI says neither whose it is nor where it ran.
        names.set(row.id, resource);
        owners.set(resource, agent);
        wheres.set(resource, row.workingDirectories);
        births.set(resource, row.createdAt);
        moves.set(resource, row.modifiedAt);
        found.push({
          resource,
          provider: agent.provider,
          title: row.title,
          // Nothing this host started is running yet, so activity is idle and
          // the only bits set are the client's own.
          status: Status.Idle | kept.flags(row.id),
          createdAt: row.createdAt,
          modifiedAt: row.modifiedAt,
          workingDirectories: row.workingDirectories,
          ...changesOf(resource),
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
      const started = origins.get(uri);
      found.unshift({
        resource: uri,
        provider: held.agent.provider,
        title: lead.title(),
        status: statusOf(uri),
        // What it is doing, so a list of twenty sessions says which one is
        // busy with what rather than only which one is busy.
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
        createdAt: held.createdAt,
        modifiedAt: modifiedOf(held),
        workingDirectories: lead.workingDirectories(),
        ...(started !== undefined ? { origin: started } : {}),
        ...changesOf(uri),
        ...describes(uri),
      });
    }
    return found;
  };
  /**
   * The config properties this host owns, rather than the backend.
   *
   * The protocol's schema is deliberately generic - a backend advertises
   * whatever names it likes - and these six are the conventional ones the
   * *host* answers, named in the reference client's `sessionConfigKeys.ts` as
   * host-owned and "not passed to agents". So they are merged over what the
   * backend said and stripped back out before it is handed anything.
   *
   * Offered at all only when there is a `worktrees` port and the directory is
   * a repository: `isolation` with one value is a control a client draws and
   * nobody can move.
   */
  /**
   * How many branches ride along in the schema before a client has to ask.
   *
   * The list is ordered by most recent commit, so the first few are the ones
   * somebody means. The rest arrive through `sessionConfigCompletions` as they
   * are typed for.
   */
  const SEEDS = 20;
  const isolating = async (where: string | undefined, chosen?: string): Promise<{
    schema: Bag;
    defaults: Record<string, string>;
    repository?: string;
  }> => {
    const port = options.worktrees;
    if (!port || where === undefined) return { schema: {}, defaults: {} };
    const repository = await port.repository(where).catch(() => undefined);
    if (repository === undefined) return { schema: {}, defaults: {} };
    // Most useful first, which the port defines: the checked-out branch is
    // what "work from here" means, and it is what somebody who does not open
    // the picker gets.
    const offered = await port.branches(repository).catch(() => [] as string[]);
    const base = offered[0];
    return {
      repository,
      defaults: {
        // `folder` and not `worktree`, which is where the reference host
        // starts. Every session this daemon has ever run has been a folder
        // session, and a default that quietly moved them all into worktrees
        // would be this host changing where somebody's agent works without
        // being asked.
        isolation: 'folder',
        ...(base !== undefined ? { branch: base } : {}),
        worktreeIncludeFiles: '',
        worktreeBranchPrefix: '',
        worktreeCreateNewBranch: 'true',
        worktreeBranchTrack: 'false',
      },
      schema: {
        properties: {
          isolation: {
            type: 'string',
            title: 'Isolation',
            description: 'Where the agent should make changes',
            enum: ['folder', 'worktree'],
            enumLabels: ['Folder', 'Worktree'],
            enumDescriptions: [
              'Work directly in the folder',
              'Work in a git worktree of its own, so two sessions in one repository do not edit under each other',
            ],
            default: 'folder',
            // Decided once. A session that changed isolation halfway would be
            // an agent whose files moved out from under a conversation.
            sessionMutable: false,
          },
          /*
           * The branches, as seeds rather than as the whole list.
           *
           * `enumDynamic` is the protocol's word for "there are more of these
           * than a picker can hold": the `enum` becomes the rows shown before
           * anybody types, and `sessionConfigCompletions` answers what they
           * type. A repository with four hundred branches used to send four
           * hundred, on every resolve, to fill a list nobody can read.
           *
           * Dynamic only while a worktree is being made, which is the one time
           * the choice means anything - the reference host does the same, and
           * marks the row read-only otherwise, because a folder session works
           * on the branch that is checked out and choosing another would be a
           * control that changes nothing.
           */
          ...(offered.length > 0 ? {
            branch: {
              type: 'string',
              title: 'Branch',
              description: 'Base branch the worktree starts from',
              enum: offered.slice(0, SEEDS),
              enumLabels: offered.slice(0, SEEDS),
              ...(base !== undefined ? { default: base } : {}),
              ...(chosen === 'worktree'
                ? { enumDynamic: true }
                : { enumDynamic: false, readOnly: true }),
              sessionMutable: false,
            },
          } : {}),
          /*
           * The files a checkout does not carry, and the session needs.
           *
           * Load-bearing rather than a refinement: a worktree has what git
           * tracks, so an ordinary project arrives without its `.env` and
           * without `node_modules`, and the agent inside it cannot run
           * anything. Offering `isolation` without this is offering a feature
           * that fails after the person chose it.
           *
           * A string of comma-separated patterns rather than an array,
           * because every other value in this bag is a string and a client
           * draws what the type says.
           */
          worktreeIncludeFiles: {
            type: 'string',
            title: 'Files to bring along',
            description: 'Comma-separated patterns for git-ignored files to copy into the worktree, such as .env',
            default: '',
            sessionMutable: false,
          },
          /*
           * Three a client seeds rather than a person picks.
           *
           * `readOnly` in the reference too: they carry a preference the
           * client already holds - somebody's `git.branchPrefix`, and how they
           * want a branch made - rather than a question to put in front of
           * them. Declared so the value rides in the config bag at all; a key
           * a host does not advertise is one a client has no reason to send.
           */
          worktreeBranchPrefix: {
            type: 'string',
            title: 'Branch prefix',
            description: 'Prepended to the branch created for the worktree.',
            default: '',
            readOnly: true,
            sessionMutable: false,
          },
          worktreeCreateNewBranch: {
            type: 'string',
            title: 'Create a branch',
            description: 'Make a branch for the worktree, or check out the chosen one as it is.',
            enum: ['true', 'false'],
            enumLabels: ['Create one', 'Continue the chosen branch'],
            default: 'true',
            readOnly: true,
            sessionMutable: false,
          },
          worktreeBranchTrack: {
            type: 'string',
            title: 'Track upstream',
            description: 'Whether the created branch tracks the upstream of the one it started from.',
            enum: ['true', 'false'],
            enumLabels: ['Track it', 'Leave it untracked'],
            default: 'false',
            readOnly: true,
            sessionMutable: false,
          },
        },
      },
    };
  };

  /**
   * A session's config with this host's own answers folded in.
   *
   * The schema as well as the values: a client draws a control from the
   * schema, so reporting `isolation: 'worktree'` against a schema that never
   * mentions `isolation` is a value with nothing to draw it. Every one of them
   * is `sessionMutable: false`, which is what stops the control once the
   * session has started rather than before it has.
   */
  const mergedConfig = (uri: string, theirs: unknown, mine: Record<string, string>): Bag => {
    const held = (typeof theirs === 'object' && theirs !== null ? theirs : {}) as Bag;
    const schema = (typeof held.schema === 'object' && held.schema !== null ? held.schema : {}) as Bag;
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    const values = (typeof held.values === 'object' && held.values !== null ? held.values : {}) as Bag;
    return {
      ...held,
      schema: { ...schema, properties: { ...properties, ...hostSchema(uri, mine) } },
      values: { ...values, ...mine },
    };
  };

  /**
   * This host's own half of the schema a session reports.
   *
   * The same properties `resolveSessionConfig` offered, not a stripped copy of
   * them. A client creates a backend session before anything is sent - it needs
   * somewhere to write the answers its controls collect - and it draws those
   * controls from the session's schema. A row with no `enum`, or one marked
   * `readOnly`, is a control that cannot be opened, so describing the answer
   * here instead of offering it made isolation unsettable in exactly the phase
   * it is meant to be settable in.
   *
   * `sessionMutable: false` is what closes it afterwards, and it is the
   * protocol's own field for this: a client hides such a control once the
   * session has started, and this host refuses the change.
   */
  const hostSchema = (uri: string, mine: Record<string, string>): Bag => {
    const properties = ((offered.get(uri)?.properties ?? {}) as Bag);
    return Object.fromEntries(
      Object.entries(mine)
        // Everything offered, and anything else that was answered: a key the
        // offer never had is worth a row only when it says something.
        .filter(([key, value]) => properties[key] !== undefined || (value !== undefined && value !== ''))
        .map(([key]) => [
          key,
          // A session created before this host could ask - an automation on a
          // directory that is not a repository - has no offer to repeat, and
          // says what it settled on instead.
          properties[key] ?? { type: 'string', title: key, readOnly: true, sessionMutable: false },
        ]),
    );
  };

  /**
   * What a new session settled on, as this host's half of its config.
   *
   * The offer is made against the directory that was asked for - the
   * repository, not a worktree's own, which has one branch and is not where
   * the choice is made. The values are the host's defaults under what the
   * client chose: a session created with `{}` still reads back `isolation`
   * and `branch`, the way one does on the reference host, whose
   * `createSession` resolves the whole config rather than echoing the keys
   * it was sent. A window draws its isolation and branch chips from the
   * session's schema once a provisional session exists, and it sends
   * `{ isolation: 'folder' }` or nothing at all.
   */
  const settle = async (uri: string, where: string | undefined, config: Record<string, unknown>): Promise<void> => {
    const mine = await isolating(where, typeof config.isolation === 'string' ? config.isolation : undefined);
    offered.set(uri, mine.schema);
    decided.set(uri, { ...mine.defaults, ...mineOf(config) });
  };

  /**
   * One property of a backend's config schema, as this host reads it.
   *
   * Two fields and no more: `sessionMutable`, which the protocol already
   * declares, and `scope`, which it does not - the protocol's schema is
   * deliberately generic and says nothing about whether a key belongs to a
   * session or to one chat inside it. A backend that says neither gets the
   * safe answers: mutable, and the session's.
   */
  const propertyOf = (agent: Agent | undefined, key: string): { sessionMutable?: boolean; scope?: string } | undefined => {
    if (!agent) return undefined;
    const schema = agent.schema();
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    const held = properties[key];
    return typeof held === 'object' && held !== null
      ? held as { sessionMutable?: boolean; scope?: string }
      : undefined;
  };

  /**
   * A backend's config schema, as it goes on the wire.
   *
   * `scope` is this host's own: it says whether a key belongs to the session
   * or to one chat inside it, which is what decides how far a
   * `session/configChanged` reaches - and `ConfigPropertySchema` does not
   * declare it. A field the protocol has no place for is one a client cannot
   * read and a strict validator calls a defect, so it is read here and left
   * off what is published. The same rule `HOSTS_OWN` applies to values.
   */
  const published = (schema: Bag): Bag => {
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : undefined) as Bag | undefined;
    if (properties === undefined) return schema;
    return {
      ...schema,
      properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => {
        if (typeof value !== 'object' || value === null) return [key, value];
        const { scope: _scope, ...rest } = value as Bag & { scope?: unknown };
        return [key, rest];
      })),
    };
  };

  /** What this host answered, as strings, for saying back on the session. */
  const mineOf = (config: Record<string, unknown>): Record<string, string> => Object.fromEntries(
    Object.entries(config)
      .filter(([key, value]) => HOSTS_OWN.includes(key) && typeof value === 'string')
      .map(([key, value]) => [key, value as string]),
  );

  /**
   * Start a session again, in the directory its config now names.
   *
   * The window this exists for is the one a client opens before anything is
   * sent: a chat exists, a backend session exists because the controls need
   * somewhere to write their answers, and no turn has run. Isolation is decided
   * when a session is created, so changing it then is the session being created
   * differently rather than moved - the backend is closed and started again
   * where the new answer says, and the worktree the old answer made goes with
   * it. Once a turn has run there is a conversation about files in a place, and
   * the answer is fixed for good.
   */
  /**
   * A session gone, with everything it held.
   *
   * What `disposeSession` does, and what the `delete_session` tool does from
   * inside another session: the chats closed, the terminals they claimed
   * killed, the worktree removed if clean, the run that started it unlinked,
   * and every client told.
   */
  const removeSession = (uri: string): void => {
    const held = sessions.get(uri);
    if (!held)
      throw new RpcError(-32001, `No agent for session ${uri}`);
    for (const [chatUri, chat] of held.chats) {
      chat.close();
      byChat.delete(chatUri);
      drafts.delete(chatUri);
    }
    /*
     * And the shells the session was holding.
     *
     * A terminal claimed by a session outlives nothing: the chat it
     * belongs to is gone, so the transcript that pointed at it is gone
     * too, and what is left is a channel in the root catalogue that
     * nobody can reach. `!` commands are the ordinary way these
     * accumulate - one terminal each, kept so the finished tool call
     * points somewhere real.
     */
    for (const [terminalUri, terminal] of [...terminals]) {
      const claim = terminal.claim();
      if (claim.kind !== 'session' || claim.session !== uri) continue;
      terminal.close();
      terminals.delete(terminalUri);
    }
    dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
    /*
     * And the worktree, unless somebody's work is still in it.
     *
     * The decision this feature turns on. A worktree with uncommitted
     * changes is the one thing here a daemon cannot judge the value of:
     * it may be an experiment nobody wanted, or the only copy of an
     * afternoon. So a clean one goes and a dirty one stays exactly where
     * it is, on the branch it was made on, findable with `git worktree
     * list` - and the path is logged, because the session it belonged to
     * is about to stop being a place to say it.
     *
     * Not refusing the dispose instead: a session somebody cannot close
     * because of a file they forgot about is a session they close by
     * killing the daemon.
     */
    const tree = worktrees.get(uri);
    if (tree) {
      worktrees.delete(uri);
      const port = options.worktrees;
      void (async () => {
        if (await port?.dirty(tree.path).catch(() => true) !== false) {
          log(`kept ${tree.path}: it has changes nobody committed`);
          return;
        }
        await port?.remove(tree.repository, tree.path, tree.branch)
          .then(() => { log(`removed ${tree.path}`); })
          .catch((error: unknown) => {
            log(`kept ${tree.path}: ${error instanceof Error ? error.message : String(error)}`);
          });
      })();
    }
    sessions.delete(uri);
    // Gone from the map first, so a handler asking about it is told the truth.
    void fire('session_end', { type: 'session_end', session: uri, reason: 'disposed' });
    /*
     * And the run that started it, which is now holding a URI that
     * opens onto nothing.
     *
     * The store answers whether the set actually moved and says so
     * through `onChanged`, which is where the action comes from - so a
     * store that keeps its runs immutable simply changes nothing here.
     */
    const from = origins.get(uri);
    if (from !== undefined) options.automations?.unlink?.(from.run, uri);
    /*
     * And the run itself, when this was the last session of it still busy. A
     * run already finished by its turn is left alone by the store, so a
     * disposal after a completed turn changes nothing.
     */
    if (from !== undefined) settleRun(uri, { status: 'cancelled' });
    origins.delete(uri);
    presence.delete(idOf(uri));
    // And what was kept *about* it. All of these are keyed by a session
    // that no longer exists, so anything left here is held for nobody -
    // a daemon that runs for weeks would accumulate one of each per
    // session anybody ever opened, and a store that writes them down
    // would keep them for ever.
    marks.delete(idOf(uri));
    decided.delete(uri);
    kept.forget(idOf(uri));
    offered.delete(uri);
    for (const channel of [...shown.keys()]) {
      if (channel.startsWith(`${uri}/changeset/`)) shown.delete(channel);
    }
    activeSessionsMoved();
    // Every other client is told, because the session was theirs too.
    // `session`, which is the name the protocol gives it. Under
    // `resource` a client reads `undefined` and takes nothing out, so a
    // disposed session stayed in every catalogue until something else
    // made that client re-read the list.
    broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: uri });
    log(`disposed ${uri}`);
    
  };

  const restart = async (
    uri: string,
    credentials: Record<string, string>,
    keeping?: { additional?: string[]; directory?: string },
  ): Promise<void> => {
    const held = sessions.get(uri);
    if (!held) return;
    const mine = decided.get(uri) ?? {};
    // The repository rather than the worktree: the choice is made against the
    // directory somebody asked for, and a worktree is only where a previous
    // answer put it. Or the directory a move asked for, which is neither.
    const from = keeping?.directory ?? worktrees.get(uri)?.repository ?? held.workingDirectory;
    const was = worktrees.get(uri);
    if (was) {
      worktrees.delete(uri);
      // Removed without asking whether it is dirty, unlike a disposed session:
      // nothing has ever run in this one, so there is nothing in it to keep.
      await options.worktrees?.remove(was.repository, was.path, was.branch)
        .then(() => { log(`removed ${was.path}`); })
        .catch((error: unknown) => {
          log(`kept ${was.path}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    const to = await isolated(uri, mine, from);
    const before = held.workingDirectory;
    for (const [chatUri, chat] of held.chats) {
      chat.close();
      byChat.delete(chatUri);
    }
    /*
     * The conversation, when this is a restart rather than a re-creation.
     *
     * Adding a directory to a session somebody is in the middle of using is a
     * new CLI with a wider set - the SDK takes its directories at startup and
     * exposes no way to add one after - so the backend is started again and
     * *resumed*, which is what makes it the same conversation rather than a
     * new one in the same place.
     */
    const lead = leadOf(held);
    const talking = keeping !== undefined && lead !== undefined && lead.agentId() !== undefined
      ? { resume: lead.agentId() as string, seed: lead.allTurns() }
      : undefined;
    sessions.delete(uri);
    try {
      spawn(
        held.agent,
        uri,
        held.defaultChat,
        held.config,
        talking,
        to,
        credentials,
        keeping?.additional ?? held.additional,
      );
    }
    catch (error) {
      /*
       * A session that existed and now does not.
       *
       * `createSession` fails inside its own request and there is nothing to
       * announce, but this is the other case: clients are subscribed, the old
       * backend is gone, and the new one would not start. `creationFailed` is
       * the action for exactly that, and saying nothing would leave every one
       * of them watching a channel that will never speak again.
       */
      dispatch(uri, {
        type: 'session/creationFailed',
        error: {
          errorType: 'sessionStartFailed',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
    log(`restarted ${uri}${to === undefined ? '' : ` in ${to}`}`);
    if (before === to) return;
    /*
     * Replaced, not removed and re-added.
     *
     * Index 0 is the process root, and the protocol has one action for a root
     * that moves: `workingDirectoryReplaced`. Saying it as a removal followed
     * by an addition would be a client briefly holding a session with no
     * directory at all.
     */
    if (to !== undefined) dispatch(uri, { type: 'session/workingDirectoryReplaced', directory: `file://${to}` });
  };

  /**
   * The move `set_workspace` asked for, once the turn that asked is over.
   *
   * The session is restarted where it was asked to go, resumed so it is the
   * same conversation, with a worktree made from the directory when isolation
   * was asked for. Then a continuation turn tells the agent where it now is
   * and to carry on, marked the way the reference host marks its own: the
   * request hidden so the window draws the answer and not the prompt, the
   * label a person reads wherever the turn is listed, and the continuation
   * key that keeps the turn owning the file changes made in it.
   */
  const moveSession = async (uri: string, move: { chat: string; directory: string; isolation: boolean }): Promise<void> => {
    const held = sessions.get(uri);
    if (!held) return;
    decided.set(uri, { ...decided.get(uri), isolation: move.isolation ? 'worktree' : 'folder' });
    offered.set(uri, (await isolating(move.directory, move.isolation ? 'worktree' : 'folder')).schema);
    await restart(uri, {}, { additional: [], directory: move.directory });
    const lead = byChat.get(chatUriFor(uri));
    const now = sessions.get(uri)?.workingDirectory ?? move.directory;
    lead?.chat.begin(
      crypto.randomUUID(),
      `The workspace is now ${now}${move.isolation ? ', an isolated worktree' : ''}. Continue the task you were working on there.`,
      undefined,
      {
        origin: { kind: 'systemNotification' },
        _meta: {
          'vscode.chat.requestHiddenFromTranscript': true,
          'vscode.chat.systemInitiatedLabel': 'Continue in Requested Workspace',
          'vscode.chat.workspaceContinuation': true,
        },
      },
    );
  };

  /**
   * Start one chat again, in the directories it now has.
   *
   * The session's own `restart` rebuilds every chat; this rebuilds one, and
   * for the same reason: the SDK takes its directories when the CLI starts
   * and offers no way to add one after. Resumed, so it is the same
   * conversation - a chat that lost its history because a directory was added
   * to it would be a worse answer than refusing.
   */
  const restartChat = (uri: string, chatUri: string, credentials: Record<string, string>): void => {
    const held = sessions.get(uri);
    const chat = held?.chats.get(chatUri);
    if (held === undefined || chat === undefined) return;
    const talking = chat.agentId() !== undefined
      ? { resume: chat.agentId() as string, seed: chat.allTurns() }
      : undefined;
    chat.close();
    held.chats.delete(chatUri);
    byChat.delete(chatUri);
    spawn(
      held.agent,
      uri,
      chatUri,
      held.config,
      talking,
      held.workingDirectory,
      credentials,
      beside.get(chatUri) ?? held.additional,
    );
    log(`restarted ${chatUri}`);
  };

  /** The host's own keys, which a backend has never heard of. */
  const HOSTS_OWN = [
    'isolation', 'branch', 'worktreeIncludeFiles',
    'worktreeBranchPrefix', 'worktreeCreateNewBranch', 'worktreeBranchTrack',
  ];

  /** What the backend is given: everything except what this host answered. */
  const backendsOwn = (config: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(config).filter(([key]) => !HOSTS_OWN.includes(key)));

  /**
   * Where a session actually runs, once isolation has been answered.
   *
   * Answered here rather than in the backend because the tree is the host's:
   * a backend is handed a directory and told to work in it, and which
   * directory that is - the folder, or a worktree made for this session - is
   * exactly the decision the client made with `isolation`.
   */
  const isolated = async (uri: string, config: Record<string, unknown>, where: string | undefined): Promise<string | undefined> => {
    const port = options.worktrees;
    if (!port || config.isolation !== 'worktree' || where === undefined) return where;
    const repository = await port.repository(where);
    if (repository === undefined) {
      throw new RpcError(-32602, `${where} is not a git repository, so it has no worktrees`);
    }
    const said = (key: string): string => (typeof config[key] === 'string' ? config[key] : '');
    /*
     * The branch this session runs on, and whether there is a new one at all.
     *
     * `agents/` is the built-in prefix the reference uses too, and a client's
     * own goes in front of it: somebody whose `git.branchPrefix` is `softov/`
     * gets `softov/agents/1a2b3c4d`, which is what their other tools already
     * sort and filter by. `worktreeCreateNewBranch: 'false'` means there is no
     * new branch - the session continues the one that was chosen.
     */
    const making = said('worktreeCreateNewBranch') !== 'false';
    const branch = making
      ? `${said('worktreeBranchPrefix')}agents/${idOf(uri).slice(0, 8)}`
      : undefined;
    const base = typeof config.branch === 'string' ? config.branch : 'HEAD';
    const path = join(worktreesOf(repository), worktreeFor(branch ?? base));
    // Read as a string, because that is what the schema for it says. A config
    // value is `unknown` on the wire - the protocol declares the bag
    // `Record<string, unknown>` and `permissions` is an object - so a key
    // this host declared a string is narrowed where it is used rather than
    // assumed everywhere.
    const patterns = typeof config.worktreeIncludeFiles === 'string' ? config.worktreeIncludeFiles : '';
    const include = patterns.split(',').map((one) => one.trim()).filter((one) => one !== '');
    await port.create({
      repository,
      base,
      ...(branch !== undefined ? { branch } : {}),
      ...(said('worktreeBranchTrack') === 'true' ? { track: true } : {}),
      path,
      ...(include.length > 0 ? { include } : {}),
    });
    // The branch is remembered rather than derived from the directory later:
    // a prefix a client asked for changes the name, and guessing it wrong at
    // removal time either deletes nothing or names somebody else's.
    worktrees.set(uri, { repository, path, base, ...(branch !== undefined ? { branch } : {}) });
    log(`made ${path} on ${branch ?? base} for ${uri}`);
    return path;
  };

  /**
   * One command, in a terminal of its own, and what it did.
   *
   * The composer's `!` shorthand runs here rather than in the session,
   * because the shell is the host's: a backend has no port to spawn one
   * through, and the terminal has to be a real channel so the client can
   * watch the output arrive instead of waiting for the whole of it.
   *
   * The terminal is kept after the command exits. It is what the finished
   * tool call points at, and disposing it would leave a transcript naming a
   * channel that answers nothing - so it stays, exited, until the session
   * that ran it goes.
   */
  const commanded = async (command: string, cwd: string, claim: Claim): Promise<Ran> => {
    const shells = options.terminals;
    if (!shells) return { success: false, said: 'There is no shell here to run it in', output: '' };
    const uri = `ahp-terminal:/${crypto.randomUUID()}`;
    return await new Promise<Ran>((resolve) => {
      const terminal = shells.create({
        uri,
        cwd,
        claim,
        command,
        name: 'Terminal',
        ...(typeof rootConfig.defaultShell === 'string' ? { shell: rootConfig.defaultShell } : {}),
        emit: (_channel, action) => {
          dispatch(uri, action);
          if ((action as Bag).type !== 'terminal/exited') return;
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
          const code = terminal.exitCode() ?? 0;
          /*
           * Read off the terminal rather than accumulated here.
           *
           * The store already keeps the output for a client that subscribes
           * late, capped, and a second copy in this closure would be the same
           * bytes held twice and the cap applied to only one of them.
           */
          const printed = terminal.state().content
            .map((part) => ('value' in part && typeof part.value === 'string' ? part.value : ''))
            .join('');
          resolve({
            success: code === 0,
            said: code === 0 ? 'Ran the command' : `The command exited with code ${String(code)}`,
            output: printed,
            terminal: uri,
            code,
          });
        },
      });
      terminals.set(uri, terminal);
      log(`ran ${command} in ${uri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
    });
  };
  /** Every terminal, as the root channel lists them. */
  const terminalInfo = (): OnWire<TerminalInfo>[] =>
    [...terminals.values()].map((held) => ({
      resource: held.uri,
      title: held.title(),
      claim: held.claim(),
      /*
       * The exit code is in here, and only here.
       *
       * `TerminalInfo` declares these four keys and nothing else; the code
       * belongs to `TerminalExitedLifecycleState`, which this returns once the
       * process has gone. A flat one beside it is a key the protocol does not
       * have, and it only appeared on the wire when a terminal happened to
       * exit before the list was taken.
       */
      lifecycle: held.lifecycle(),
    }));
  /**
   * The terminal factory a backend is handed on `Start`.
   *
   * The host owns everything a terminal channel needs, so this is where the
   * backend's request is turned into one: a URI the root list can name, the
   * session's own claim, the registration that makes the channel reachable
   * and the emit that routes an action to the terminal instead of the
   * session. It is the same machinery `commanded` uses for a `!` command,
   * with the options the backend gave and a handle to read the result through.
   *
   * `release` ends a process that has not already gone. Dropping the row
   * without ending the process would leave a shell running that the root list
   * no longer names and no client can reach, which is a leak wearing the
   * clothes of tidiness.
   */
  const heldTerminals = (shells: TerminalStore, sessionUri: string, chatUri: string): StartTerminals => ({
    open: (asked) => {
      const uri = `ahp-terminal:/${crypto.randomUUID()}`;
      const terminal = shells.create({
        uri,
        cwd: asked.cwd,
        claim: { kind: 'session', session: sessionUri, chat: chatUri },
        command: asked.command,
        ...(asked.args !== undefined ? { args: asked.args } : {}),
        ...(asked.env !== undefined ? { env: asked.env } : {}),
        ...(asked.name !== undefined ? { name: asked.name } : {}),
        // The configured shell, the way the client path opens one: a backend
        // asking for a shell means the one this host was told to use.
        ...(typeof rootConfig.defaultShell === 'string' ? { shell: rootConfig.defaultShell } : {}),
        emit: (_channel, action) => {
          dispatch(uri, action);
          // The root list says whether a terminal is still running, so it is
          // stale the moment one exits and reaches nobody unless it moves.
          if ((action as Bag).type === 'terminal/exited') {
            dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
          }
        },
      });
      terminals.set(uri, terminal);
      // The same observation the client path makes, so a plugin watching for a
      // shell cannot tell which half of the host opened it.
      void fire('terminal_open', { type: 'terminal_open', terminal: uri, cwd: asked.cwd });
      log(`opened ${uri} for ${sessionUri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
      return {
        uri,
        output: () => {
          /*
           * The protocol's own recipe for turning typed parts back into the
           * stream they came from: a command's output, or an unclassified
           * part's value.
           */
          const output = terminal.state().content
            .map((part) => (part.type === 'command' ? part.output : part.value))
            .join('');
          const code = terminal.exitCode();
          return {
            output,
            ...(code !== undefined ? { exitCode: code } : {}),
          };
        },
        waitForExit: () => terminal.waitForExit(),
        write: (data) => { terminal.write(data); },
        resize: (cols, rows) => { terminal.resize(cols, rows); },
        // Ends the process and leaves the row, the way `commanded` does: the
        // channel may still be what something points at.
        kill: () => { terminal.close(); },
        release: () => {
          if (terminal.exitCode() === undefined) terminal.close();
          terminals.delete(uri);
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
        },
      };
    },
  });
  /**
   * The tools this host contributes, which `setTools` replaces.
   *
   * The protocol's `serverTools`: reported on every session's state, offered
   * to every backend that can take tools, and replaced whole - which is what
   * `session/serverToolsChanged` means.
   */
  let contributing: HostTool[] = [...(options.tools ?? [])];
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
  const toolDefinitions = (uri: string): ToolDefinition[] => contributing.flatMap((one) => {
    const shaped = shapedDefinition(one, uri);
    return shaped === undefined ? [] : [shaped];
  });
  /**
   * The tools as one session runs them, with the host's own view bound in.
   *
   * A backend is handed something it can call and nothing else: which session
   * asked, and what this host knows about the sessions and terminals beside
   * it, are answered here because they are the host's to answer.
   */
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
    kept.setChatTitle(idOf(uri), chatUri, title);
    if (chatUri === held.defaultChat) dispatch(uri, { type: 'session/titleChanged', title });
    else dispatch(uri, { type: 'session/chatUpdated', chat: chatUri, changes: { title } });
    summaryMoved(uri);
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
      const made = `ahp-session:/${crypto.randomUUID()}`;
      const config: Record<string, unknown> = {
        ...(asked.isolation !== undefined ? { isolation: asked.isolation } : {}),
        ...(asked.model !== undefined ? { model: asked.model } : {}),
      };
      // The same steps `createSession` takes for a client, in the same order:
      // the tree before anything runs in it, the host's keys kept apart from
      // the backend's.
      const where = await isolated(made, config, asked.workingDirectory);
      await settle(made, asked.workingDirectory, config);
      openSession(made, provider, backendsOwn(config), where, undefined, undefined, undefined, asked.title);
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
      const chat = spawn(held.agent, at, chatUri, held.config, undefined, held.workingDirectory, undefined, held.additional);
      log(`opened ${chatUri} in ${at}`);
      if (asked.title !== undefined) { chat.setTitle?.(asked.title); kept.setChatTitle(idOf(at), chatUri, asked.title); }
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

  const boundTools = (uri: string, chatUri: string): BoundTool[] => [
    ...clientTools(uri),
    ...contributing.flatMap((one): BoundTool[] => {
      const definition = shapedDefinition(one, uri);
      return definition === undefined ? [] : [{
        definition,
        // The call and its outcome are one event, raised after the tool is
        // done, so a handler knows whether it answered and not only that it
        // ran. Raising it before would report an attempt as a result.
        run: async (input: Record<string, unknown>): Promise<string> => {
          try {
            const answer = await one.run(input, toolContext(uri, chatUri));
            void fire('tool_call', { type: 'tool_call', session: uri, chat: chatUri, tool: definition.name, ok: true });
            return answer;
          }
          catch (error) {
            void fire('tool_call', {
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
  const instructions = (uri: string): string[] => contributing.flatMap((one) => {
    if (one.forSession?.({ titleStrategy: strategyOf(uri) })?.offered === false) return [];
    const said = compactPrompts() && one.compact?.instruction !== undefined ? one.compact.instruction : one.instruction;
    return said === undefined ? [] : [said];
  });

  /**
   * Host-wide configuration, which a connected client pushes.
   *
   * Not this host's own settings - those are argv and `config.json`, and a
   * client has no business in them. These are the preferences a *client* holds
   * about how the host should behave for it: VS Code sends `defaultShell` out
   * of `terminal.integrated.agentHostProfile.<os>` the moment it connects,
   * because which shell a host-managed terminal opens is a preference of the
   * person's rather than a fact about the machine.
   *
   * Everything pushed is kept, and only what is in the schema below is acted
   * on. Keeping the rest is not indulgence: `values` is state a client reads
   * back, and a host that dropped what it did not understand would report
   * settings that silently reverted.
   */
  const rootConfig: Record<string, unknown> = {};
  /**
   * The keys this host honours, which is what a client draws a control from.
   *
   * A key here is a promise that pushing it changes something. That is why
   * the two below have behaviour behind them in `artifactTools` and the
   * session tools rather than being kept and ignored.
   */
  const ROOT_CONFIG_SCHEMA = {
    // `type` is required of a `ConfigSchema` and is always `object`. Left out,
    // it was a schema a strict reader refuses and a lenient one guesses at.
    type: 'object',
    properties: {
      defaultShell: {
        type: 'string',
        title: 'Default Shell',
        description: 'Absolute path to the shell host-managed terminals open. The system shell when unset.',
      },
      artifactToolsCompactPrompts: {
        type: 'boolean',
        title: 'Compact Artifact Prompts',
        description: 'Use the short artifact instruction and tool description. It changes the wording only, never whether a tool is offered.',
      },
      deferredTitleGeneration: {
        type: 'boolean',
        title: 'Deferred Title Generation',
        description: 'Give a session a deferred title strategy, under which renaming a chat is only done when the user asks and the automatic argument is dropped.',
      },
    },
  };
  const rootState = async () => ({
    agents: descriptors(),
    // What this host is running, not what is on disk beside it.
    activeSessions: sessions.size,
    ...(terminals.size > 0 ? { terminals: terminalInfo() } : {}),
    /*
     * Always present, and present even when empty.
     *
     * A client's root reducer returns the state *unchanged* when there is no
     * `config` on it, so a host that left this out made every
     * `root/configChanged` a no-op on every client - including the one that
     * had just pushed it.
     */
    config: { schema: ROOT_CONFIG_SCHEMA, values: { ...rootConfig } },
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
   * Transcripts being read right now, so two callers share one read.
   *
   * Not a second cache: an entry lives only for the length of the read and is
   * dropped whether it answered or threw. `history` is what remembers.
   */
  const reading = new Map<string, Promise<Bag[] | undefined>>();
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
    /*
     * One read per transcript, however many callers arrive together.
     *
     * A client opens a session by subscribing to three channels in one breath
     * - the session, its chat and its annotations - and all three ask for the
     * same turns. Without this each of them missed the cache, because none had
     * finished filling it, and the file was read three times *concurrently*.
     * The turns that come out are small; the read is not. A 35MB transcript
     * costs about 120MB of resident memory while it is being parsed, so a
     * session opened this way cost 360MB of it at once, and several sessions
     * opened together multiplied that again.
     */
    const already = reading.get(id);
    if (already) return await already;
    const asked = (async (): Promise<Bag[] | undefined> => {
      // The listing is what says whose session this is, so it is asked first.
      const found = await listing();
      const row = found.find((item) => idFor(item.resource) === id);
      const owner = owners.get(nameOf(id));
      if (!row || !owner?.transcript)
        return undefined;
      titles.set(id, row.title);
      const built = await owner.transcript(id);
      if (!built)
        return undefined;
      /*
       * Kept only when it has turns.
       *
       * An empty answer is what a read that failed and a session with nothing
       * in it both look like from this port, and keeping it turns one bad read
       * into a session that draws nothing for the life of this process. The
       * answer is served either way, so a row the catalogue vouches for still
       * opens; what it is not is remembered. A read that did have turns is the
       * large one this cache exists for, and is kept.
       */
      if (built.length > 0)
        history.set(id, built);
      return built;
    })();
    reading.set(id, asked);
    try { return await asked; }
    finally { reading.delete(id); }
  };
  /**
   * A snapshot is a value, not a view of one.
   *
   * The state assembled below is built out of the host's own live objects -
   * the turn being written into, the array a delta appends to - and the
   * response carrying it is serialised after this function returns, not
   * inside it. Handed back by reference it is therefore a promise about the
   * present that is kept in the future: the client receives whatever those
   * objects had become by the time the socket got to them, under a `fromSeq`
   * naming the moment they were read. That number is the whole basis on which
   * a client decides what it has already seen, so a snapshot newer than its
   * own sequence is one that gets a turn applied to it twice - once from the
   * state, once from the action that produced it.
   *
   * `structuredClone` rather than a JSON round-trip, because a key that is
   * present and undefined is not the same as an absent one here - `usage` is
   * required and means "not measured" - and JSON cannot tell those apart.
   */
  const value = (snapshot: Record<string, unknown>): Record<string, unknown> =>
    structuredClone(snapshot);

  const snapshotOf = async (channel: string): Promise<Record<string, unknown>> => {
    if (channel === ROOT) {
      return value({ resource: ROOT, state: await rootState(), fromSeq: serverSeq });
    }
    const terminal = terminals.get(channel);
    if (terminal)
      return value({ resource: channel, state: terminal.state(), fromSeq: serverSeq });
    /*
     * A changeset, which lives under the session it belongs to.
     *
     * `<sessionUri>/changeset/<scope>`. Nested on purpose: disposing a session
     * tears down every changeset it had by string-prefix scan, and the reverse
     * lookup - which session is this - is the same scan.
     */
    if (channel === LOGS || channel.startsWith(`${LOGS}/`) || channel === TRACES || channel === METRICS) {
      // Nothing to snapshot: the channel is a stream, and the protocol says a
      // subscriber receives only what was emitted after it arrived. Answering
      // with an empty state is how a client is told it is subscribed rather
      // than refused.
      return value({ resource: channel, state: {}, fromSeq: serverSeq });
    }
    if (channel === AUTOMATIONS) {
      return value({
        resource: channel,
        state: { entries: need(options.automations, 'the automations channel').list() },
        fromSeq: serverSeq,
      });
    }
    if (channel.startsWith('ahp-automation-run:/')) {
      const found = options.automations?.runOf(channel);
      if (!found) throw new RpcError(-32001, `No automation run at ${channel}`);
      return value({ resource: channel, state: found, fromSeq: serverSeq });
    }
    /*
     * A session's annotations, nested under the session the way a changeset
     * is: `<sessionUri>/annotations`, one per session.
     *
     * Held rather than produced. Nothing here makes a mark - they arrive
     * through the `addComment` server tool, which no backend here advertises -
     * and what this host contributes is that a mark one client made is one
     * every other client in the session can see. The channel is served rather
     * than refused even when it is empty, because a client subscribes to it as
     * part of opening a session, alongside the session and its chat: a refusal
     * there is a failed open, and a client that treats the three as one
     * hydration renders nothing at all.
     */
    if (channel.endsWith(MARKS)) {
      const owning = channel.slice(0, -MARKS.length);
      // Asked of `past`, which consults the catalogue itself, rather than of
      // the maps a listing fills: a client sends the three subscriptions that
      // open a session in one breath, before its own `listSessions` has come
      // back, and a test against those maps refuses on the race.
      if (sessions.has(heldAs(owning)) || (await past(idOf(owning))) !== undefined)
        return value({ resource: channel, state: marksOf(idOf(owning)), fromSeq: serverSeq });
    }
    /*
     * A watch another client is keeping, which this host only relays.
     *
     * Its state is the params it was made with, the same as one of this
     * host's own - and a snapshot has to be served here or the client that
     * asked for the watch cannot subscribe to what it was given.
     */
    const away = relayed.get(channel);
    if (away) return value({ resource: channel, state: away.state, fromSeq: serverSeq });
    const watching = watches.get(channel);
    if (watching) {
      // The state is what the watch *is*, not what it has seen. The protocol's
      // reducer keeps no history: `resourceWatch/changed` exists to deliver
      // events to whoever is subscribed, and a client that arrives later has
      // missed them the way it misses anything it was not there for.
      return value({ resource: channel, state: watching.state, fromSeq: serverSeq });
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
      /*
       * What this subscriber now holds, which is what the next change is
       * against.
       *
       * Without this the first change after anybody subscribed had nothing to
       * diff from and went out as the whole set - so the incremental actions
       * only ever applied from the second change onwards, which is not what
       * "the diff is smaller" means.
       */
      shown.set(channel, { files: state.files, status: state.status });
      return value({
        resource: channel,
        state: { ...state, ...(operations.length > 0 ? { operations } : {}) },
        fromSeq: serverSeq,
      });
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
      const theirs = lead.sessionState();
      const mine = decided.get(channel);
      const state = {
        ...theirs,
        // What this host answered, beside what the backend did. Its own keys
        // never reached the backend, so this is the only place they can be
        // read back from.
        ...(mine === undefined ? {} : { config: mergedConfig(channel, theirs.config, mine) }),
        ...describes(channel),
        ...changesetsOf(channel),
        // Required by the protocol and empty until somebody announces
        // themselves, which is a real answer: a session nobody has opened has
        // nobody in it.
        activeClients: activeClientsOf(channel),
        // What this host contributes, which is nothing unless it was given
        // any - and then the field is absent rather than an empty list.
        ...(contributing.length > 0 ? { serverTools: toolDefinitions(channel) } : {}),
        status: statusOf(channel),
        // No `modifiedAt`: `SessionSummary` declares it and `SessionState`
        // does not, and the catalogue row is where a client reads it.
        defaultChat: held.defaultChat,
        chats: [...held.chats].map(([uri_, chat_]) => chatSummary(channel, uri_, chat_)),
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
      };
      return value({ resource: channel, state, fromSeq: serverSeq });
    }
    const talking = byChat.get(channel);
    if (talking)
      return value({
        resource: channel,
        state: { ...talking.chat.chatState(), ...startedBy(talking.uri) },
        fromSeq: serverSeq,
      });
    /*
     * A session in the catalogue that this host is not running.
     *
     * Served read-only from its transcript. No agent process is started until
     * somebody sends a turn to it.
     */
    // A chat URI carries its session; a session URI is one. Either way the
    // transcript is the session's, and the id is what reads it.
    const owning = sessionOfChat(channel) ?? channel;
    const id = idOf(owning);
    const turns = await past(id);
    const owner = owners.get(nameOf(id)) ?? first;
    if (turns) {
      const title = titles.get(id) ?? 'Session';
      if (sessionOfChat(channel) !== undefined) {
        return value({
          resource: channel,
          state: {
            resource: channel,
            title,
            status: Status.Idle,
            modifiedAt: moves.get(owning) ?? new Date().toISOString(),
            ...startedBy(nameOf(id)),
            ...tail(turns),
            queuedMessages: [],
            // Held here rather than by a chat, because there is no chat. A
            // client that typed into this row and came back finds what it
            // typed, which is what a draft is for.
            ...(drafts.get(channel) !== undefined ? { draft: drafts.get(channel) } : {}),
          },
          fromSeq: serverSeq,
        });
      }
      return value({
        resource: channel,
        state: {
          resource: channel,
          provider: owner.provider,
          title,
          status: Status.Idle | kept.flags(id),
          lifecycle: 'ready',
          defaultChat: chatUriFor(nameOf(id)),
          // A whole `ChatSummary`, and not a name and a URI: a client reads a
          // chat row's `status` and `modifiedAt` by name, and a live session
          // answers with both.
          chats: [
            {
              resource: chatUriFor(nameOf(id)),
              title,
              status: Status.Idle,
              modifiedAt: moves.get(nameOf(id)) ?? new Date().toISOString(),
              ...startedBy(nameOf(id)),
            },
          ],
          workingDirectories: wheres.get(`ahp-session:/${id}`) ?? [`file://${dir}`],
          activeClients: activeClientsOf(nameOf(id)),
          ...(contributing.length > 0 ? { serverTools: toolDefinitions(nameOf(id)) } : {}),
          ...describes(nameOf(id)),
          ...changesetsOf(nameOf(id)),
          // What its backend offers, since nothing is running to say what this
          // session in particular was given.
          customizations: about(owner.provider).seeds,
          // The same schema a live session reports. Leaving it out drew no
          // controls at all on a browsed row - no permission mode, no effort -
          // which are the settings somebody wants *before* continuing one.
          config: {
            schema: published(owner.schema()),
            values: { ...owner.defaults(), ...(kept.config(id) ?? {}) },
          },
        },
        fromSeq: serverSeq,
      });
    }
    // Not running and not in the catalogue. Refusing is the honest answer and
    // the one a client already knows how to render - it is what a real host
    // says about a session whose agent has gone.
    throw new RpcError(-32001, `No agent for session ${channel}`);
  };
  /**
   * The model a message names, or nothing when it names none.
   *
   * `TurnMessage.model` is a `ModelSelection` - `{ id, config }` - and reading
   * it as a string is how a client's choice was accepted and dropped. The
   * `config` is the form that model advertised, and its values are primitives
   * because that is what the protocol carries; anything else reached this host
   * by not being what it says it is, and is left out.
   */
  const modelIn = (value: unknown): { id: string; config?: Record<string, string | number | boolean | null> } | undefined => {
    const held = (typeof value === 'object' && value !== null ? value : {}) as Bag;
    if (typeof held.id !== 'string') return undefined;
    const values = typeof held.config === 'object' && held.config !== null ? held.config as Bag : undefined;
    if (values === undefined) return { id: held.id };
    const config: Record<string, string | number | boolean | null> = {};
    for (const [key, one] of Object.entries(values)) {
      if (one === null || ['string', 'number', 'boolean'].includes(typeof one))
        config[key] = one as string | number | boolean | null;
    }
    return Object.keys(config).length === 0 ? { id: held.id } : { id: held.id, config };
  };

  /** Every resource identifier any agent here advertised. */
  const advertised = (): Set<string> => {
    const out = new Set<string>();
    for (const agent of agents.values()) {
      for (const one of resourcesOf(agent)) {
        const id = (one as { resource?: unknown }).resource;
        if (typeof id === 'string') out.add(id);
      }
    }
    return out;
  };
  /**
   * The whole RFC 9728 record for a resource, as a backend advertised it.
   *
   * `auth/required` carries the record rather than the identifier, so a
   * client knows where to go and sign in. One this host never advertised -
   * an MCP server's, named on a session's own state - is answered with the
   * identifier alone, which is the record's one required field.
   */
  const metadataFor = (resource: string): Bag => {
    for (const agent of agents.values()) {
      for (const one of resourcesOf(agent)) {
        if ((one as { resource?: unknown }).resource === resource) return one as Bag;
      }
    }
    return { resource };
  };
  /**
   * Where a requirement for that resource is visible.
   *
   * A backend's own resource is the root's business; an MCP server's is the
   * session that server belongs to, which is where its `authRequired` state
   * is drawn.
   */
  const channelAwaiting = (resource: string): string => {
    for (const [uri, held] of sessions) {
      for (const chat of held.chats.values()) {
        if (chat.awaiting?.().includes(resource) === true) return uri;
      }
    }
    return ROOT;
  };

  /**
   * Start a session.
   *
   * At host scope rather than inside a connection because there are two ways
   * in and only one of them has a client: `createSession` is a request
   * somebody made, and an automation coming round at nine in the morning is
   * not. Both need the same eight steps, and a second copy of them would be a
   * second answer to what creating a session means.
   */
  const openSession = (
    uri: string,
    provider: string,
    config: Record<string, unknown>,
    where: string | undefined,
    origin?: { kind: 'automation'; automation: string; run: string },
    credentials?: Record<string, string>,
    additional?: string[],
    title?: string,
  ): void => {
    named(uri, 'session');
    if (sessions.has(uri))
      throw new RpcError(-32003, `${uri} already exists`);
    const agent = agents.get(provider);
    if (!agent)
      throw new RpcError(-32002, `No provider called ${provider}`);
    // Snapshotted before the backend is handed its tools, so this session's
    // whole life runs under the strategy the root config named at this
    // moment and a later root change waits for the next session.
    strategies.set(uri, strategyOf(uri));
    try {
      const lead = spawn(agent, uri, chatUriFor(uri), config, undefined, where, credentials, additional);
      // Named before it is announced, when the maker had a name for it: a
      // row that appears as "New session" and is renamed a moment later is
      // two rows to a client that lists once. Written down for the same
      // reason a rename is: a first name outlives a restart too.
      if (title !== undefined) { lead.setTitle?.(title); kept.setChatTitle(idOf(uri), chatUriFor(uri), title); }
    }
    catch (error) {
      // The backend's own words. It is the thing that knows which
      // directories it serves, and a refusal a client can read beats an
      // internal error it cannot.
      throw new RpcError(-32602, error instanceof Error ? error.message : String(error));
    }
    /*
     * The branch it started on, when that is already known.
     *
     * A directory whose facts have answered holds the pull requests the
     * branch had, and this session began after that answer, so they are its
     * baseline. Where nothing has answered yet the capture waits for the
     * first answer, which is the same moment one turn later.
     */
    const facts = dirOf(uri) === undefined ? undefined : githubFacts.get(dirOf(uri) as string);
    if (facts !== undefined) {
      const urls = Array.isArray(facts.pullRequestUrls)
        ? facts.pullRequestUrls.filter((one): one is string => typeof one === 'string')
        : [];
      captureBaseline(uri, urls);
    }
    if (origin !== undefined) origins.set(uri, origin);
    log(`created ${uri}${where ? ` in ${where}` : ''}`);
    // Ready, then announced. A client that hears about a session before
    // it can be subscribed to has been told about something that is not
    // there yet.
    dispatch(uri, { type: 'session/ready' });
    sessionAdded(uri);
    activeSessionsMoved();
    // Named and in the map, which is the moment a handler can act on it.
    void fire('session_start', { type: 'session_start', session: uri, provider });
  };

  /**
   * What a store is handed when a run starts, however it started.
   *
   * The session *and* the first message: a session created and never spoken to
   * is a session that does nothing, and the whole point of an automation is
   * that nobody is at the keyboard to say the first thing.
   */
  const startForAutomation = async (wanted: StartSession): Promise<string> => {
    const uri = `ahp-session:/${crypto.randomUUID()}`;
    const config = wanted.config ?? {};
    // The same two steps a client's `createSession` takes: the tree is made
    // before anything runs in it, and the host's own keys are not the
    // backend's to read. An automation asking for isolation is the case this
    // exists for - nobody is at the keyboard to notice two of them colliding.
    const where = await isolated(uri, config, wanted.workingDirectory);
    await settle(uri, wanted.workingDirectory, config);
    openSession(
      uri,
      wanted.provider ?? first.provider,
      backendsOwn(config),
      where,
      wanted.origin,
    );
    // The only place that knows a session was started by a clock rather than a
    // person, and the run it belongs to.
    if (wanted.origin !== undefined) {
      void fire('automation_fire', { type: 'automation_fire', automation: wanted.origin.automation, run: wanted.origin.run });
    }
    const chatUri = chatUriFor(uri);
    byChat.get(chatUri)?.chat.begin(crypto.randomUUID(), wanted.text);
    return uri;
  };

  /**
   * The clock, wired to the only thing that can act on it.
   *
   * A store holding one says an automation is due and this starts the run,
   * which is what makes a schedule fire with nobody connected. Wired here,
   * after `startForAutomation` exists, because a store may report what it
   * missed while this daemon was down the moment it is asked.
   *
   * A run that will not start is logged and not thrown: there is no client to
   * answer, and a daemon that died because nine o'clock came round would be
   * worse than one that says so.
   */
  options.automations?.onDue?.(({ automation, origin }) => {
    void (async () => {
      try {
        const run = await options.automations?.run(automation, origin, startForAutomation);
        log(run
          ? `${automation} was due and started ${run.primarySession ?? run.resource}`
          : `${automation} was due and is switched off or gone`);
      }
      catch (error) {
        log(`${automation} was due and failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  });

  return {
    clients,
    /*
     * Replaced whole, and every running session told.
     *
     * `session/serverToolsChanged` has full-replacement semantics, so the
     * action carries the new set rather than the difference. A session
     * already running keeps offering the old set to its model until its
     * process starts again - the tools are handed over at startup - and what
     * moves immediately is what a client is told the session has.
     */
    setTools: (tools) => {
      contributing = [...tools];
      for (const uri of sessions.keys())
        dispatch(uri, { type: 'session/serverToolsChanged', tools: toolDefinitions(uri) });
    },
    connections: () => connections.size,
    accept(peer: Peer) {
      const connection: Connection = {
        peer, clientId: '', watching: new Set<string>(),
        tokens: new Map<string, Credential>(), aliases: new Map<string, string>(),
      };
      /**
       * Whether this connection has been introduced.
       *
       * The protocol opens with `initialize`, or with `reconnect` for a client
       * coming back to a host it has met. Until one of them has been answered
       * there is no negotiated version, no `clientId` and nothing to key a
       * subscription by - so serving anything else means serving a client
       * this host has agreed on nothing with.
       */
      let handshook = false;

      /**
       * What this client pushed, narrowed to what that backend asked for.
       *
       * Narrowed rather than handed over whole: a token for one resource is
       * not a token for another, and a backend has no business seeing a
       * credential meant for something it does not speak to.
       */
      const tokensFor = (provider: string): Record<string, string> => {
        const agent = agents.get(provider);
        const out: Record<string, string> = {};
        for (const one of agent?.protectedResources ?? []) {
          const id = (one as { resource?: unknown }).resource;
          if (typeof id !== 'string') continue;
          const held = connection.tokens.get(id);
          // Not one that has run out. The timer below takes it away at the
          // moment it expires, but a session asked for in the same tick would
          // still find it here, and would start on a credential the client
          // was about to be told is gone.
          if (held !== undefined && !(held.expiresAt !== undefined && held.expiresAt <= Date.now())) out[id] = held.token;
        }
        return out;
      };
      /**
       * When each token runs out, so the client that pushed it is told.
       *
       * The protocol has a word for this - `auth/required` with
       * `reason: 'expired'` - and until `expiresIn` arrived on `authenticate`
       * this host had no way to earn it: nothing here verifies a token, so it
       * never learned that one had gone stale. Now the client says how long
       * it has, and the moment it runs out is a fact this host holds alone.
       * Said to that connection and no other, because the token was theirs.
       *
       * `setTimeout` takes at most 2^31-1 milliseconds, a little under
       * twenty-five days; a token good for longer is checked again at that
       * boundary rather than fired early.
       */
      const expiring = new Map<string, ReturnType<typeof setTimeout>>();
      const LONGEST = 2 ** 31 - 1;
      const expire = (resource: string): void => {
        const held = connection.tokens.get(resource);
        if (held?.expiresAt === undefined) return;
        const left = held.expiresAt - Date.now();
        if (left > 0) {
          expiring.set(resource, setTimeout(() => expire(resource), Math.min(left, LONGEST)));
          expiring.get(resource)?.unref?.();
          return;
        }
        expiring.delete(resource);
        connection.tokens.delete(resource);
        log(`${connection.clientId || 'a client'}'s token for ${resource} expired`);
        connection.peer.notify('auth/required', {
          channel: channelAwaiting(resource),
          resource: metadataFor(resource),
          reason: 'expired',
        });
      };
      /** Stop watching a token's clock: it was replaced, revoked, or the client left. */
      const forgetExpiry = (resource: string): void => {
        const timer = expiring.get(resource);
        if (timer !== undefined) clearTimeout(timer);
        expiring.delete(resource);
      };
      connections.add(connection);

      /**
       * Which store serves a URI.
       *
       * `file:` is the store the host was given, and anything else is a scheme
       * a plugin registered under `resourceProviders`. A scheme nobody serves
       * falls through to that same store, which is where the sentence about a
       * foreign scheme is written - so an unserved URI reads as somebody
       * else's rather than as a host that forgot it.
       *
       * A URI a connected client published never reaches here: the relay in
       * `handle` answers it before any handler, which is the order that keeps
       * a plugin from shadowing a client's own resources.
       */
      const storeFor = (uri: string) => {
        const scheme = (/^([a-zA-Z][\w+.-]*):/.exec(uri)?.[1] ?? '').toLowerCase();
        if (scheme === '' || scheme === 'file') return options.resources;
        return options.resourceProviders?.[scheme] ?? options.resources;
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
            // `supportedVersions`, which is the name the protocol gives this
            // field and the only reason the error is recoverable: it is what a
            // client reads to pick a version to retry with. Under any other
            // spelling, the one way out of a version mismatch reads
            // `undefined`.
            throw new RpcError(-32005, 'No protocol version in common', { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
          }
          connection.clientId = typeof params.clientId === 'string' ? params.clientId : 'anonymous';
          // Met, so a later `reconnect` under this id is answerable.
          known.add(connection.clientId);
          void fire('client_connect', { type: 'client_connect', client: connection.clientId });
          // Introduced. Said after the version is agreed, so a client this
          // host cannot speak to is not one it has shaken hands with.
          handshook = true;
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
            serverInfo: { name: 'ahpd', version: options.diagnostics?.version ?? '0.0.1' },
            snapshots,
            defaultDirectory: `file://${dir}`,
            // What the client should ask about rather than send. A slash is a
            // skill or a prompt the host contributed; an at-sign is a file.
            // Without this the client has no reason to believe either means
            // anything here, and types them into the chat as text.
            completionTriggerCharacters: ['/', '@'],
            // What this host emits, so a client knows there is a log to watch.
            // A template, because the variable is the severity a subscriber
            // wants rather than something the host fills in.
            telemetry: { logs: `${LOGS}/{level}`, traces: TRACES, metrics: METRICS },
            /*
             * Whether there are automations here at all.
             *
             * Presence is what *permits* the feature: the protocol says a
             * client may subscribe to `ahp-automations://` and dispatch the
             * automation actions when this is here, and that the host has
             * neither when it is not. So a host serving the channel and the
             * three commands while advertising nothing is a host whose
             * automations no correct client will ever touch - which is what
             * this was, and it worked only against a client that subscribed
             * regardless and caught the refusal.
             *
             * `create` because every store writes one. `schedules` with no
             * `minIntervalMinutes` because the cron grammar is the protocol's
             * own and this host restricts nothing beyond its one-minute
             * resolution. `runCancellation` is absent because it is not served
             * - a run here is a session, and disposing it is how it stops - and
             * `runHistoryLimit` because retention is the store's, which is what
             * an absent one means.
             */
            ...(options.automations ? { automations: { create: {}, schedules: {} } } : {}),
            /*
             * `!` at the start of a message means "run this", not "answer this".
             *
             * Advertised only when there is a shell to run it in. Absence is
             * the protocol's own way of saying the shorthand is unsupported,
             * so a host with no `terminals` port says nothing here and a
             * client types `!ls` into the conversation as text - which is the
             * right outcome for a host that cannot run it.
             */
            ...(options.terminals ? { terminalCommandPrefix: BANG } : {}),
            /*
             * What the reference client may ask beyond the protocol.
             *
             * Its window reads these flags off `initialize` and offers the
             * feature only where the host said so: `vscode/removeSessionArtifact`
             * is the close button on an artifact pill, and the detached
             * worktree five are its dev container flow.
             */
            _meta: { 'vscode.removeSessionArtifact': true, 'vscode.detachedWorktrees': true, 'vscode.getAgentHostSessionStateFile.chat': true },
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
          /*
           * A client this host has never met, refused - and refused with this
           * code in particular.
           *
           * `reconnect` resumes a conversation about *this* host's sequence
           * numbers. To a client it has never seen, the honest answer is not an
           * empty replay - "you have missed nothing" - because that is a claim
           * about a stream the client was never reading. It answered exactly
           * that to a VS Code returning after a daemon restart, saying up to
           * 419 to a host that had issued nine, and was believed: the client
           * concluded its state was current and never subscribed to anything
           * again, so every pane it had stayed empty against a host that was
           * working perfectly.
           *
           * `-32008` is what the reference host answers here, and its client
           * reads that one code as "the server forgot me" and falls back to a
           * fresh `initialize` - which is the only path on which it restores
           * its subscriptions. Any other error is rethrown and the connection
           * fails, so this is not a detail: it is the whole recovery.
           */
          if (!known.has(clientId)) {
            throw new RpcError(-32008, `${clientId || 'That client'} is not a client this host has seen`);
          }
          connection.clientId = clientId;
          void fire('client_connect', { type: 'client_connect', client: connection.clientId });
          // The other way in. A client that dropped resumes with this rather
          // than a fresh `initialize`, and it is as much an introduction.
          handshook = true;
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
              // Resolved the way `subscribe` resolves it, so a client coming
              // back under its own spelling of a chat, a session, or the
              // automations catalogue is resumed rather than told the channel
              // has gone - and is replayed, which is keyed by the name this
              // host dispatches under rather than the one the client used.
              const meant = meantBy(channel);
              await snapshotOf(meant);
              if (meant !== channel) connection.aliases.set(meant, channel);
              connection.watching.add(channel);
              resumed.push(meant);
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
          // replay of nothing rather than a reason to re-snapshot. A client
          // ahead of this host is the other way round and cannot be replayed to
          // at all - whatever it counted, it was not this stream - so it is
          // sent state rather than a difference.
          const replayable_ = since <= serverSeq && (oldest === undefined || since >= oldest - 1);
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
        /**
         * A snapshot, and everything that happened while it was being taken.
         *
         * `snapshotOf` is asynchronous, and until it returns this connection
         * is not on the watch list - so an action dispatched in that window
         * goes to nobody, and is in no snapshot taken before it happened. It
         * is a small window and it is wide enough: a client that subscribes
         * and sends in the same breath - which is what opening a session from
         * a composer *is* - loses the `chat/turnStarted` its own message
         * caused. What follows is worse than one missing action, because
         * every delta after it names a turn the client was never told about
         * and the reducer drops each one in turn: the transcript stays empty
         * for the rest of the session, and nothing anywhere reports an error.
         *
         * Replayed from the buffer rather than closed by joining the watch
         * list first, because that order has a hole of its own - the client
         * would be sent actions the snapshot already contains, and a
         * `chat/delta` applied twice is the word written twice. The sequence
         * number is what tells "already in the snapshot" from "after it", and
         * this host keeps one for exactly this reason.
         */
        /**
         * Watch a channel, and answer with what it holds now.
         *
         * Subscribing twice to one channel answers twice. Nothing here marks a
         * subscription pending while its snapshot is taken, so a second
         * request that arrives during the first is an ordinary second request
         * rather than a replacement - the reference host cancels the earlier
         * one and answers it `-32001` naming a channel it is actively serving,
         * which reads like a session that does not exist.
         */
        subscribe: async (params) => {
          const channel = String(params.channel ?? '');
          // What it means here, and what it was called there. The snapshot is
          // taken of the channel and returned under the name the client used -
          // a client that asked about one URI and was answered about another
          // has been answered about something it is not watching.
          const snapshot = await snapshotOf(meantBy(channel));
          /*
           * Resolved again, after the snapshot rather than before it.
           *
           * Opening a browsed row is what makes this host ask its backend for
           * a catalogue, and until it has asked there is no name for the row
           * to be an alias *of* - so a name resolved beforehand came back
           * unchanged, no alias was recorded, and every action about that
           * session afterwards went out under a name this client was not
           * watching.
           */
          const meant = meantBy(channel);
          if (meant !== channel) {
            connection.aliases.set(meant, channel);
            if (sessionOfChat(channel) === undefined) spelledFor(channel, snapshot);
            else snapshot.resource = channel;
          }
          connection.watching.add(channel);
          // From here on, an unsubscribe means something: a watch nobody has
          // subscribed to yet is not one everybody has finished with.
          const held = watches.get(channel);
          if (held) held.opened = true;
          // Nothing is awaited between the line above and this one, so
          // nothing can be dispatched in between: what the filter finds is
          // the whole of what was missed, and what it leaves is already in
          // the snapshot or still to come by the ordinary route.
          const at = typeof snapshot.fromSeq === 'number' ? snapshot.fromSeq : 0;
          for (const envelope of replayable) {
            if (envelope.channel === meant && envelope.serverSeq > at) {
              connection.peer.notify('action', meant === channel
                ? envelope
                : { ...envelope, channel });
            }
          }
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
          // Under whatever spelling the client used: a chat may be addressed
          // by a URI this host did not mint, and a page of turns asked for
          // under that name is the same chat.
          const channel = meantBy(String(params.channel ?? ''));
          const live = byChat.get(channel);
          const all = live ? live.chat.allTurns() : await past(idOf(sessionFor(channel)));
          if (!all)
            throw new RpcError(-32001, `No agent for session ${channel}`);
          const asked = typeof params.cursor === 'string' ? params.cursor : undefined;
          // No cursor means "load whatever is next", which is the page before
          // the one the snapshot carried.
          const from = asked ?? tail(all).turnsNextCursor;
          if (from === undefined) {
            // A session whose state holds every retained turn has no older
            // page and no cursor to carry. The protocol asks for that page
            // "if any", so there being none is an answer and not a refusal.
            return {};
          }
          const page = older(all, from);
          if (!page) {
            // An omitted cursor can only fail here on a transcript that moved
            // under the read, which is still an answer of "nothing older".
            if (asked === undefined) return {};
            // Guessing at a cursor this host did not issue would answer a
            // question about old turns with new ones, and the client would
            // page for ever without noticing.
            throw new RpcError(-32602, `Unrecognised cursor ${String(asked)}`);
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
            const paths = await options.resources.complete(typed_, base);
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
          /*
           * Inside the containers, because that is where a leaf lives.
           *
           * A top-level customization is a plugin or a directory and a skill
           * or a prompt is one of its `children` - so a filter that looked
           * only at the top level found nothing, every time, and this fell
           * back to the backend-wide list on every keystroke. Which answered
           * correctly and by accident: the whole point of `own` is that two
           * sessions in one directory can be handed different things.
           */
          const leaves = (session?.customizations() ?? []).flatMap((entry) => {
            const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
            return children.length > 0 ? children : [entry];
          });
          const own = leaves
            // Skills as well as prompts, and not the ones the CLI keeps for
            // the agent: offering one it will refuse is worse than not
            // offering it.
            .filter((entry) => (entry.type === 'prompt' || entry.type === 'skill')
              && entry.disableUserInvocation !== true)
            .map((entry) => ({
            name: String(entry.name),
            description: typeof entry.description === 'string' ? entry.description : undefined,
            argumentHint: typeof entry.argumentHint === 'string' ? entry.argumentHint : undefined,
            isSkill: entry.type === 'skill',
          }));
          /*
           * Which of the backend-wide commands are skills.
           *
           * The probe's flat command list cannot say - the CLI reports a
           * skill behind a slash as a command like any other - but its
           * customizations can, and a skill is a leaf of one of them. Read
           * once per answer rather than per item.
           */
          const skillsOf = (provider: string): Set<string> => {
            const out = new Set<string>();
            for (const entry of about(provider).seeds) {
              const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
              for (const leaf of children.length > 0 ? children : [entry]) {
                if (leaf.type === 'skill' && typeof leaf.name === 'string') out.add(leaf.name);
              }
            }
            return out;
          };
          const skilled = (provider: string) => {
            const skills = skillsOf(provider);
            return about(provider).commands.map((command) => ({ ...command, isSkill: skills.has(command.name) }));
          };
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
            ? skilled(named)
            : [...agents.keys()].flatMap((provider) => skilled(provider));
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
                /*
                 * What makes it a *command* rather than a line of text.
                 *
                 * The protocol declares `SimpleMessageAttachment` with a label
                 * and no notion of a slash command, so the reference client
                 * reads one out of `_meta`: a bag carrying `command` is a
                 * slash command, one carrying `uri` is a skill, and a bag
                 * carrying neither is dropped without a word. That is the
                 * whole reason a menu can come back full and draw empty -
                 * every item was answered and none was a command.
                 *
                 * `description` is the second column and `argumentHint` is
                 * the ghost text after an accepted one.
                 */
                _meta: {
                  command: command.name,
                  // A skill, said so: the reference client keeps a runtime
                  // skill in an automation's text only when the flag is
                  // there, and drops it as a command it cannot find a file
                  // for otherwise. `true` or absent, the way it is read.
                  ...(command.isSkill ? { isSkill: true } : {}),
                  ...(command.description ? { description: command.description } : {}),
                  ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
                },
              },
            })),
          };
        },
        /**
         * The catalogue, in pages when a client asks for one.
         *
         * Only when it asks. `limit` omitted is the protocol's own "let the
         * server choose the page size", and the size this host chooses is all
         * of them - because neither client that connects to it reads
         * `nextCursor`: VS Code's `listSessions` sends `{ channel }` and takes
         * `items`, and so does ahpc. A default page would silently be the
         * whole catalogue to both of them.
         */
        listSessions: async (params) => {
          const rows = await listing();
          const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
          const after = cursor === undefined
            ? 0
            : rows.findIndex((row) => row.resource === opened(cursor)) + 1;
          // Refused rather than guessed at, the way an unrecognised turn
          // cursor is: a cursor whose row has been disposed would otherwise
          // resume from the top, and the client would page for ever.
          if (cursor !== undefined && after === 0)
            throw new RpcError(-32602, `Unrecognised cursor ${cursor}`);
          const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
            ? Math.max(1, Math.min(Math.floor(params.limit), PAGE_CAP))
            : PAGE_MOST;
          const items = rows.slice(after, after + limit);
          // Said out loud, because it is the one case a client cannot see: a
          // catalogue past the bound is one this host can no longer hand over
          // whole, and neither client that connects to it reads `nextCursor`.
          if (limit === PAGE_MOST && rows.length - after > PAGE_MOST) {
            log(`${String(rows.length)} sessions is past ${String(PAGE_MOST)}: paging, which no client here asks for`);
          }
          const last = items[items.length - 1];
          return {
            items,
            ...(last && after + items.length < rows.length ? { nextCursor: sealed(last.resource) } : {}),
          };
        },
        /*
         * The host's filesystem, as far as a client is allowed to see it.
         *
         * Both halves are served. The read half answers any connection, and
         * the write half - `resourceWrite`, `resourceDelete`, `resourceMkdir`,
         * `resourceMove` and `resourceCopy` - does too, because the connection
         * token has already decided who may be here and `resourceRequest`
         * grants any `file:` URI to anyone who asks. What decides a write is
         * the store's own rule about the path, not a grant this connection
         * holds; only a host with no store that writes answers `-32601`.
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
          const uri = named(String(params.channel ?? ''), 'terminal');
          if (terminals.has(uri))
            throw new RpcError(-32003, `${uri} already exists`);
          const asked = typeof params.cwd === 'string' ? params.cwd.replace(/^file:\/\//, '') : dir;
          /*
           * Whose terminal this is, checked rather than taken.
           *
           * A claim used to be a `Bag` and anything at all was accepted, so a
           * client could take a terminal with `{}` and the channel then said
           * so to everyone watching. Absent is this connection, which is the
           * ordinary case; present and malformed is a refusal, because a
           * client that meant to name a session and got it wrong should hear
           * about it rather than quietly become the owner.
           */
          const claim = params.claim === undefined
            ? { kind: 'client' as const, clientId: connection.clientId }
            : claimOf(params.claim);
          if (!claim) throw new RpcError(-32602, 'That is not a terminal claim');
          const terminal = shells.create({
            uri,
            cwd: asked,
            claim,
            // What a client asked this host to open, if one did.
            ...(typeof rootConfig.defaultShell === 'string' ? { shell: rootConfig.defaultShell } : {}),
            ...(typeof params.name === 'string' ? { name: params.name } : {}),
            ...(typeof params.cols === 'number' ? { cols: params.cols } : {}),
            ...(typeof params.rows === 'number' ? { rows: params.rows } : {}),
            emit: (_channel, action) => {
              dispatch(uri, action);
              /*
               * A terminal that exited is a different row on the root channel
               * as well, and that list only moved when one was created or
               * disposed - so the catalogue went on describing a dead shell as
               * running until somebody closed it.
               *
               * Worse since 0.9.0 rather than new: the old shape said nothing
               * about a terminal that had not exited, and this one says
               * `{ status: 'running' }` out loud. A stale silence is a client
               * with less to go on; a stale assertion is a client that has
               * been told something untrue.
               */
              if ((action as Bag).type === 'terminal/exited') {
                dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
              }
            },
          });
          terminals.set(uri, terminal);
          void fire('terminal_open', { type: 'terminal_open', terminal: uri, cwd: asked });
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
        resourceList: async (params) => {
          const uri = String(params.uri ?? '');
          const store = storeFor(uri);
          return { entries: await need(need(store, 'resourceList').list, 'resourceList')(uri) };
        },
        resourceRead: async (params) => {
          const uri = String(params.uri ?? '');
          // The `before` side of an edit is not a file on disk - it is what a
          // file used to be - so the changeset source is asked before the
          // scheme is: it answers only for the URIs it minted, and a scheme a
          // plugin registered is asked after it.
          const own = await options.changes?.read?.(uri);
          if (own) return own;
          return await need(need(storeFor(uri), 'resourceRead').read, 'resourceRead')(
            uri,
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
         *
         * The origin is `{ kind: 'manual' }` and nothing else, because that is
         * the whole of `AutomationManualRunOrigin` - it carries no room for
         * who asked, and a run's origin goes on the wire in every catalogue
         * row the automation appears in.
         */
        runAutomation: async (params) => {
          const store = need(options.automations, 'runAutomation');
          const automation = String(params.automation ?? '');
          const run = await store.run(automation, { kind: 'manual' }, startForAutomation);
          if (!run) throw new RpcError(-32001, `No automation at ${automation}, or it is switched off`);
          return { resource: run.resource };
        },
        /**
         * A token for something this host advertised.
         *
         * Held against this connection and nowhere else: the specification is
         * explicit that authentication status is per connection, each client
         * authenticating independently, which is also why it is a command and
         * a notification rather than anything in root state.
         *
         * The resource is checked against what was advertised because the
         * protocol requires it to match, and because the alternative is a host
         * that accepts credentials for things it has never heard of. An
         * unknown one is `-32602`: it is a bad parameter, not a demand to
         * authenticate, and answering `-32007` would send a client round a
         * loop it cannot get out of.
         *
         * The token itself is not verified. This host has no way to ask
         * Anthropic whether a key is good without spending a request on the
         * question, and a session started with a bad one fails saying so.
         */
        authenticate: async (params) => {
          const resource = String(params.resource ?? '');
          const token = String(params.token ?? '');
          /*
           * A backend's own resource, or one of its MCP servers'.
           *
           * The second kind is advertised on a server's `authRequired` state
           * rather than on the agent, and is just as much a resource this host
           * named - the protocol's rule is that a client's `resource` matches
           * one the server advertised, and both of these are.
           */
          const waiting = [...sessions.values()]
            .flatMap((held) => [...held.chats.values()])
            .filter((chat) => chat.awaiting?.().includes(resource) === true);
          if (waiting.length === 0 && !advertised().has(resource)) {
            throw new RpcError(-32602, `${resource || 'That'} is not a resource this host advertises`);
          }
          /*
           * An empty token takes the credential back.
           *
           * The protocol says so beside `expiresIn` - "when `token` is empty
           * to revoke authentication" - and the reference host deletes what
           * it held on one. This answered `-32602`, which left a client that
           * had signed out with no way to say so: its next session here would
           * have started on a credential it no longer meant to lend. Nothing
           * running is told; a token is spent at start, and what is already
           * running has it in its environment and no way to give it back.
           */
          if (token === '') {
            const had = connection.tokens.delete(resource);
            forgetExpiry(resource);
            log(`${connection.clientId || 'a client'} ${had ? 'revoked' : 'had no'} token for ${resource}`);
            return {};
          }
          /*
           * How long it is good for, if the client knows.
           *
           * Seconds, a positive integer, already less the time since the
           * authorization server answered - the protocol puts the subtraction
           * on the client. Anything else is a bad parameter rather than a
           * token with no expiry: a client that sent `0` or `-1` meant
           * something, and taking it as "forever" is the opposite of it.
           */
          const expiresIn = params.expiresIn;
          if (expiresIn !== undefined && !(typeof expiresIn === 'number' && Number.isInteger(expiresIn) && expiresIn > 0)) {
            throw new RpcError(-32602, 'expiresIn must be a positive integer of seconds');
          }
          /*
           * Applied where it belongs, rather than only remembered.
           *
           * A token for an MCP server is that server's `Authorization` header
           * and nothing else's; a token for a backend is a credential its next
           * session starts with. The first takes effect now, on the sessions
           * that were waiting for it.
           */
          for (const chat of waiting) void chat.authenticated?.(resource, token);
          forgetExpiry(resource);
          connection.tokens.set(resource, {
            token,
            ...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
          });
          void fire('authenticated', { type: 'authenticated', client: connection.clientId || 'anonymous', resource });
          if (expiresIn !== undefined) expire(resource);
          log(`${connection.clientId || 'a client'} authenticated for ${resource}${expiresIn !== undefined ? `, for ${expiresIn}s` : ''}`);
          // A GitHub token is a reason to ask GitHub again: a lookup that
          // answered nothing as nobody may answer as this person.
          if (resource === String(options.github?.resource.resource ?? '')) {
            for (const dir of browsable()) {
              void refreshPullRequests(dir).then((moved) => { if (moved) metaMoved(dir); }).catch(() => {});
            }
          }
          return {};
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
          const store = need(storeFor(uri), 'createResourceWatch');
          const start = need(store.watch, 'createResourceWatch');
          const items = (value: unknown): string[] => {
            const held = (typeof value === 'object' && value !== null ? value : {}) as { items?: unknown };
            return Array.isArray(held.items) ? held.items.filter((one): one is string => typeof one === 'string') : [];
          };
          const recursive = params.recursive === true;
          const excludes = items(params.excludes);
          const includes = items(params.includes);
          const channel = `ahp-resource-watch:/${crypto.randomUUID()}`;
          const watcher = await start.call(store, uri, { recursive, excludes, includes }, (changes) => {
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
         * Every one takes the same gate, and it is the store's: the path is
         * checked there, because only it knows what a path means - and it
         * resolves the parent rather than the target, so a symlink pointing
         * out of the served set cannot be written through.
         *
         * `need` twice, because there are two ways not to have this: a host
         * given no `resources` port at all, and one given a store that only
         * reads. Both answer `-32601`, which is what the protocol has for a
         * method that is not here, and neither is a refusal about a path.
         */
        resourceWrite: async (params) => {
          const uri = String(params.uri ?? '');
          const encoding = params.encoding === 'base64' ? 'base64' as const : 'utf-8' as const;
          await need(need(storeFor(uri), 'resourceWrite').write, 'resourceWrite')(uri, {
            data: String(params.data ?? ''),
            encoding,
            /*
             * Checked rather than cast, and it changes no behaviour.
             *
             * A client's string used to go straight into a field the rest of
             * this codebase reads as one of three words, so `mode: 'overwrite'`
             * reached the store typed as something it was not. The store's
             * fallback happens to be `truncate`, so nothing was ever visibly
             * wrong - which is the whole reason it survived. This is the same
             * defect as a hand-copied vocabulary, one layer in: a value the
             * compiler believes is a `WriteMode` and is not.
             */
            ...(WRITE_MODES.includes(String(params.mode)) ? { mode: String(params.mode) as WriteMode } : {}),
            ...(typeof params.position === 'number' ? { position: params.position } : {}),
            ...(params.createOnly === true ? { createOnly: true } : {}),
            ...(typeof params.ifMatch === 'string' ? { ifMatch: params.ifMatch } : {}),
          });
          void fire('resource_write', { type: 'resource_write', uri });
          log(`${connection.clientId} wrote ${uri}`);
          return {};
        },
        resourceDelete: async (params) => {
          const uri = String(params.uri ?? '');
          await need(need(storeFor(uri), 'resourceDelete').remove, 'resourceDelete')(
            uri, params.recursive === true,
          );
          log(`${connection.clientId} removed ${uri}`);
          return {};
        },
        resourceMkdir: async (params) => {
          const uri = String(params.uri ?? '');
          await need(need(storeFor(uri), 'resourceMkdir').mkdir, 'resourceMkdir')(uri);
          return {};
        },
        /*
         * Both ends are the store's business, including the source.
         *
         * The source is emptied and the destination is filled, so a store that
         * can write one and not the other refuses the half it cannot do. A
         * `copy` reads the source, which the read half already allows inside a
         * served directory.
         *
         * Two different schemes are refused rather than attempted: neither
         * provider could carry out the other's half, which is the same answer
         * two different clients already get for a cross-client move.
         */
        resourceMove: async (params) => {
          const source = String(params.source ?? '');
          const destination = String(params.destination ?? '');
          const held = storeFor(source);
          if (held !== storeFor(destination)) throw new RpcError(-32602, `${source} and ${destination} are served by different providers`);
          await need(need(held, 'resourceMove').move, 'resourceMove')(
            source, destination, params.failIfExists === true,
          );
          log(`${connection.clientId} moved ${source} to ${destination}`);
          return {};
        },
        resourceCopy: async (params) => {
          const source = String(params.source ?? '');
          const destination = String(params.destination ?? '');
          const held = storeFor(destination);
          if (storeFor(source) !== held) throw new RpcError(-32602, `${source} and ${destination} are served by different providers`);
          await need(need(held, 'resourceCopy').copy, 'resourceCopy')(
            source, destination, params.failIfExists === true,
          );
          return {};
        },
        /**
         * May I read this, may I write it.
         *
         * The negotiated form of the question, and a client that asks is told
         * yes for any `file:` URI, the way the reference host answers it:
         * there is no person at a daemon to prompt, and the connection token
         * has already decided who may be here.
         *
         * It grants nothing, because there is nothing left to grant: the write
         * half is served to any connection, and the read half always was. The
         * answer is kept because the protocol has the method and a client that
         * asks deserves the same answer the reference gives, and the ask is
         * logged so a host operator can see it.
         */
        resourceRequest: async (params) => {
          const uri = String(params.uri ?? '');
          if (!uri.startsWith('file://')) throw new RpcError(-32009, `This host does not mediate ${uri}`);
          // Neither flag is a read, which is what the protocol tells receivers
          // to make of a request that sets nothing.
          const write = params.write === true;
          log(`${connection.clientId} may ${write ? 'write' : 'read'} ${uri}`);
          return {};
        },
        /**
         * Run one of the verbs a changeset advertised.
         *
         * Three gates, and none of them is a flag on this host: the id has to
         * be one this changeset offers *now*, the target has to be a kind that
         * operation accepts, and the session must not be mid-turn. The list is
         * the access model - a client can invoke nothing that was not already
         * put in front of it. An operation that writes is not gated on a
         * `resourceRequest`, because the resource half is not either.
         */
        invokeChangesetOperation: async (params) => {
          const channel = String(params.channel ?? '');
          const at = changesetAt(channel);
          if (!at) throw new RpcError(-32001, `No changeset at ${channel}`);
          const source = need(options.changes, 'invokeChangesetOperation');
          const operationId = String(params.operationId ?? '');
          const context = operationContext(at.owner, at.dir);
          const offered = (source.operations?.(at.dir, at.owner, at.scope, context) ?? [])
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
          // `-32004`, which the protocol has for exactly this: the operation
          // requires no active turn and there is one. `-32002` is
          // `ProviderNotFound`, so a client branching on the code was told to
          // try another provider when what it should do is wait.
          if ((statusOf(at.owner) & Status.InProgress) !== 0)
            throw new RpcError(-32004, `${at.owner} is mid-turn`);

          const key = opKey(channel, operationId);
          const held = sessions.get(at.owner);
          const lead = held && leadOf(held);
          inFlight.add(key);
          lastError.delete(key);
          dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'running' });
          try {
            const meta = typeof params._meta === 'object' && params._meta !== null ? params._meta as Record<string, unknown> : undefined;
            const result = await need(source.invoke, 'invokeChangesetOperation').call(source, {
              ...context,
              dir: at.dir,
              session: at.owner,
              scope: at.scope,
              operationId,
              ...(target !== undefined ? { target } : {}),
              ...(lead ? { subject: lead.title() } : {}),
              ...(meta !== undefined ? { meta } : {}),
            });
            inFlight.delete(key);
            dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'idle' });
            // Before the refresh, so GitHub's later answer is what survives.
            if (result.pullRequest !== undefined) recordPullRequest(at.owner, at.dir, result.pullRequest);
            // Something wrote to the tree, so every changeset of this session
            // is now describing a directory that has moved. The catalogue
            // first, because `refresh` is what makes the next read fresh.
            refreshFacts(at.dir);
            await options.changes?.refresh?.(at.dir).catch(() => false);
            await contentMoved(at.owner);
            return {
              ...(result.message !== undefined ? { message: result.message } : {}),
              // What the operation produced, when it produced something worth
              // opening. A pull request a push made is the case: the operation
              // succeeded, and the useful part of it is a page somewhere.
              ...(result.followUp !== undefined ? { followUp: result.followUp } : {}),
            };
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
            // With the source's code and data when it chose them: a refusal
            // the reference client branches on is more than its message.
            const chosen = error as { code?: unknown; data?: unknown };
            if (typeof chosen.code === 'number') throw new RpcError(chosen.code, message, chosen.data);
            throw new RpcError(INTERNAL_ERROR, message);
          }
        },
        resourceResolve: async (params) => {
          const uri = String(params.uri ?? '');
          return await need(need(storeFor(uri), 'resourceResolve').resolve, 'resourceResolve')(
            uri,
            params.followSymlinks !== false,
          );
        },
        /**
         * Start one.
         *
         * The **client** chooses the URI and sends it as `channel` - which is
         * what makes the session addressable before this host has answered, so
         * the client can subscribe to it without a round trip in between.
         */
        createSession: async (params) => {
          const uri = named(String(params.channel ?? ''), 'session');
          const provider = String(params.provider ?? first.provider);
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
          const wanted = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.replace(/^file:\/\//, ''));
          const asked = wanted[0];
          const where = asked;
          // The peers of the first, which the protocol says are equal to each
          // other and to it in everything but which one the process is rooted
          // at. A backend that cannot take them is told none.
          const peers = agents.get(provider)?.multipleDirectories === true ? wanted.slice(1) : [];
          /*
           * The worktree, before anything is started in it.
           *
           * Made first because the backend is handed a directory and expected
           * to work in it: a session opened in the folder and then moved would
           * be an agent whose files changed under it. A failure here is a
           * session that never existed, which is the right outcome - the
           * alternative is one running somewhere the person did not choose.
           */
          /*
           * How far along, for the one thing here that takes visible time.
           *
           * `root/progress` echoes the `progressToken` the request carried, so
           * it is sent only when the client asked for one - and only to the
           * client that asked, because the token is that request's and means
           * nothing to anybody else. Making a worktree is `git worktree add`
           * plus a copy of whatever the client asked to bring along, which on
           * a large repository is seconds a person otherwise waits through
           * with nothing on screen.
           */
          const token = typeof params.progressToken === 'string' ? params.progressToken : undefined;
          const along = (progress: number, message: string): void => {
            if (token === undefined) return;
            connection.peer.notify('root/progress', { channel: ROOT, progressToken: token, progress, total: 2, message });
          };
          along(0, config.isolation === 'worktree' ? 'Making a working tree' : 'Starting the session');
          const running = await isolated(uri, config, where);
          along(1, 'Starting the agent');
          await settle(uri, where, config);
          // This connection's tokens and no other's. A client that pushed
          // nothing gets a session on the daemon's own credentials, which is
          // how every session worked before there was anything to push.
          openSession(uri, provider, backendsOwn(config), running, undefined, tokensFor(provider), peers);
          // Complete, which the protocol spells as `progress === total`.
          along(2, 'Ready');
          /*
           * The creator claiming its place in the session it just made.
           *
           * The protocol's own words: "equivalent to dispatching a
           * `session/activeClientSet` immediately after creation". Answered
           * here rather than left to that dispatch because it saves the round
           * trip the field exists to save, and because a client that has to
           * announce itself afterwards owns a session that is briefly empty
           * of it.
           *
           * The `clientId` is this connection's, not the one in the payload.
           * The protocol says the two MUST match, and forcing it is what the
           * dispatch path does for the same reason: a client naming somebody
           * else is announcing a presence that is not theirs.
           */
          const claimed = typeof params.activeClient === 'object' && params.activeClient !== null
            ? params.activeClient as Bag
            : undefined;
          if (claimed !== undefined) {
            const clientId = connection.clientId || 'anonymous';
            const activeClient: Bag = {
              ...claimed,
              clientId,
              tools: Array.isArray(claimed.tools) ? claimed.tools : [],
            };
            const here = presence.get(idOf(uri)) ?? new Map<string, Bag>();
            presence.set(idOf(uri), here);
            here.set(clientId, activeClient);
            dispatch(uri, { type: 'session/activeClientSet', activeClient });
            retool(uri);
          }
          return {};
        },
        /**
         * A second conversation in one session.
         *
         * Same backend, same directory, same config - which is what makes the
         * chats peers rather than one being the other's child. `source` is
         * accepted: a `fork` resumes at the turn and seeds the copy from the
         * source transcript, and a `sideChat` copies nothing and carries that
         * turn's text on its first prompt.
         */
        createChat: async (params) => {
          const uri = String(params.channel ?? '');
          const chatUri = String(params.chat ?? '');
          const held = sessions.get(uri);
          if (!held)
            throw new RpcError(-32001, `No agent for session ${uri}`);
          if (idOf(chatUri) === '' || chatUri.indexOf(':') <= 0)
            throw new RpcError(-32602, `${chatUri} is not a chat URI`);
          if (byChat.has(chatUri))
            throw new RpcError(-32003, `${chatUri} already exists`);
          /*
           * Made out of another chat, when a client asks for that.
           *
           * A fork copies the conversation through one turn and continues it,
           * under an id of its own so the chat it came from is untouched. A
           * side chat copies nothing and is *told* what that turn said - the
           * protocol is explicit that the source transcript stays out of its
           * visible history, so the context rides on its first prompt.
           */
          const source = (typeof params.source === 'object' && params.source !== null
            ? params.source
            : undefined) as { kind?: unknown; chat?: unknown; turnId?: unknown } | undefined;
          let made: { resume?: string; seed?: Bag[]; forkAt?: string; context?: string } | undefined;
          if (source !== undefined) {
            const kind = String(source.kind ?? '');
            // The kind first, because it decides whether the rest of the
            // source means anything: an unknown one is a client asking for
            // something this host has never heard of, and saying "no such
            // turn" about it would send somebody looking at the turn.
            if (kind !== 'fork' && kind !== 'sideChat')
              throw new RpcError(-32602, `${kind} is not a chat source this host knows`);
            const from = byChat.get(chatOf(String(source.chat ?? '')));
            if (!from || from.uri !== uri)
              throw new RpcError(-32602, `${String(source.chat ?? '')} is not a chat in ${uri}`);
            const turnId = String(source.turnId ?? '');
            const all = from.chat.allTurns();
            const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
            if (at < 0)
              throw new RpcError(-32602, `${turnId} is not a turn in ${String(source.chat ?? '')}`);
            if (kind === 'fork') {
              if (held.agent.chats?.fork !== true)
                throw new RpcError(-32602, `${held.agent.provider} cannot fork a chat from a turn`);
              // The backend's own name for that prompt, which is the only one
              // it can be asked to continue from.
              const point = from.chat.forkPoint?.(turnId);
              const started = from.chat.agentId();
              if (point === undefined || started === undefined)
                throw new RpcError(-32602, `${turnId} is not a turn this host can fork from`);
              made = { resume: started, forkAt: point, seed: all.slice(0, at + 1) as Bag[] };
            }
            else {
              if (held.agent.chats?.sideChat !== true)
                throw new RpcError(-32602, `${held.agent.provider} cannot start a side chat from a turn`);
              const message = (all[at] as Bag | undefined)?.message;
              const said = typeof message === 'object' && message !== null
                ? (message as { text?: unknown }).text
                : undefined;
              made = { context: typeof said === 'string' ? said : '' };
            }

          }
          /*
           * The directories this chat is about, when it is about fewer.
           *
           * The protocol requires every entry to be in the owning session's
           * set: a chat cannot reach anywhere its session cannot, and one that
           * named somewhere else would be asking the host to widen a session
           * through a chat. The first entry is the process root and is the
           * session's, so what a chat chooses among is the peers.
           */
          const asked = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
            .filter((one): one is string => typeof one === 'string')
            .map((one) => one.replace(/^file:\/\//, ''));
          const own = [held.workingDirectory, ...(held.additional ?? [])].filter((one) => one !== undefined);
          const stray = asked.find((one) => !own.includes(one));
          if (stray !== undefined)
            throw new RpcError(-32602, `${stray} is not a working directory of ${uri}`);
          const peers = asked.length > 0
            ? asked.filter((one) => one !== held.workingDirectory)
            : held.additional;
          if (asked.length > 0) beside.set(chatUri, peers ?? []);
          const chat = spawn(held.agent, uri, chatUri, held.config, made, held.workingDirectory, undefined, peers);
          log(`opened ${chatUri} in ${uri}`);
          // `summary`, not `chat`: the reducer reads `action.summary.resource`,
          // and a chat named any other way arrives as a TypeError inside it.
          dispatch(uri, { type: 'session/chatAdded', summary: chatSummary(uri, chatUri, chat) });
          const first_ = (typeof params.initialMessage === 'object' && params.initialMessage !== null
            ? params.initialMessage
            : undefined) as Record<string, unknown> | undefined;
          if (first_ !== undefined) {
            chat.begin(crypto.randomUUID(), String(first_.text ?? ''));
          }
          return {};
        },
        disposeChat: async (params) => {
          // Either spelling, like `subscribe` and a dispatch.
          const chatUri = chatOf(String(params.channel ?? ''));
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
          drafts.delete(chatUri);
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
          removeSession(String(params.channel ?? ''));
          return {};
        },
        /**
         * A pill's close button.
         *
         * The reference client's own request, outside the protocol, behind
         * `_meta['vscode.removeSessionArtifact']` in `initialize`: a person
         * taking off what the agent recorded, without a turn to say so in.
         * `session` names the session, `artifactId` the entry; an id nobody
         * has is nothing to do, the way the reference host answers it.
         */
        /**
         * A handle on a session's worktree, for the window that manages it.
         *
         * The reference host makes the tree here, ahead of the session, from
         * the prompt; this host made it when the session was created, so the
         * answer is that tree and `prompt` has nothing left to name. A
         * session with no tree is not one the window can hold a handle on,
         * and says so in the reference host's words.
         */
        'vscode/createAgentHostDetachedWorktree': async (params) => {
          if (typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
          if (typeof params.prompt !== 'string') throw new RpcError(-32602, 'prompt must be a string');
          const uri = sessionFor(params.session);
          const tree = worktrees.get(uri);
          if (tree === undefined) {
            throw new RpcError(-32602, sessions.has(uri)
              ? `Session is not configured for worktree isolation: ${params.session}`
              : `Session not found: ${params.session}`);
          }
          const handle = crypto.randomUUID();
          const now = Date.now();
          detached.set(handle, {
            session: uri,
            repository: tree.repository,
            path: tree.path,
            ...(tree.branch !== undefined ? { branch: tree.branch } : {}),
            claimed: false,
            archived: false,
            createdAt: now,
            lastSeenAt: now,
          });
          log(`${connection.clientId || 'a client'} holds ${handle} on ${tree.path}`);
          return { handle, resource: `file://${tree.path}` };
        },
        /** The session started in the tree: the handle is in use, and stays until the window lets go. */
        'vscode/claimAgentHostDetachedWorktree': async (params) => {
          const handle = String(params.handle ?? '');
          const held = detached.get(handle);
          if (held === undefined) throw new RpcError(-32602, `Unknown detached worktree handle: ${handle}`);
          held.claimed = true;
          held.lastSeenAt = Date.now();
          return {};
        },
        /**
         * Archived is the tree taken down, and the branch kept so it can
         * come back; unarchived is the tree put back on that branch.
         *
         * Not while a session is running in it, and not with work nobody
         * committed in it - the same two judgements a disposal makes. A
         * handle nobody holds is nothing to do, the way the reference host
         * answers it.
         */
        'vscode/setAgentHostDetachedWorktreeArchived': async (params) => {
          const handle = String(params.handle ?? '');
          const archived = params.archived === true;
          const held = detached.get(handle);
          if (held === undefined) return {};
          held.archived = archived;
          const port = options.worktrees;
          if (port === undefined) return {};
          const present = await stat(held.path).then(() => true, () => false);
          if (archived) {
            if (!present) return {};
            if (sessions.has(held.session)) {
              log(`kept ${held.path}: ${held.session} is running in it`);
              return {};
            }
            if (await port.dirty(held.path).catch(() => true)) {
              log(`kept ${held.path}: it has changes nobody committed`);
              return {};
            }
            await port.remove(held.repository, held.path)
              .then(() => { log(`removed ${held.path} for the archived ${handle}`); })
              .catch((error: unknown) => { log(`kept ${held.path}: ${error instanceof Error ? error.message : String(error)}`); });
            return {};
          }
          if (held.branch === undefined || present) return {};
          await port.create({ repository: held.repository, base: held.branch, path: held.path })
            .then(() => { log(`put ${held.path} back on ${held.branch ?? ''} for ${handle}`); })
            .catch((error: unknown) => { log(`could not put ${held.path} back: ${error instanceof Error ? error.message : String(error)}`); });
          return {};
        },
        /** The window is done with the tree: gone, branch and all, unless a session is still in it. */
        'vscode/deleteAgentHostDetachedWorktree': async (params) => {
          const handle = String(params.handle ?? '');
          const held = detached.get(handle);
          if (held === undefined) return {};
          if (sessions.has(held.session)) throw new RpcError(-32004, `${held.session} is running in ${held.path}; dispose the session first`);
          detached.delete(handle);
          worktrees.delete(held.session);
          // Already gone with its session, which is the ordinary order of things.
          if (!await stat(held.path).then(() => true, () => false)) return {};
          await options.worktrees?.remove(held.repository, held.path, held.branch)
            .then(() => { log(`removed ${held.path} for ${handle}`); })
            .catch((error: unknown) => {
              throw new RpcError(INTERNAL_ERROR, `Could not remove ${held.path}: ${error instanceof Error ? error.message : String(error)}`);
            });
          return {};
        },
        /**
         * The set the window still knows about, under one scope.
         *
         * A handle it names is seen again; one it does not name, in that
         * scope, is let go once the grace has passed - the tree removed when
         * it is clean and nobody is in it, and kept when either is not so. A
         * scope is the repository the trees were made from, or the tree's
         * own path, since the reference client's spelling of it is its own.
         */
        'vscode/reconcileAgentHostDetachedWorktrees': async (params) => {
          const scope = String(params.scope ?? '').replace(/^file:\/\//, '').replace(/\/$/, '');
          const active = new Set(Array.isArray(params.activeHandles) ? params.activeHandles.map(String) : []);
          const now = Date.now();
          for (const [handle, held] of detached) {
            if (held.repository !== scope && held.path !== scope) continue;
            if (active.has(handle)) {
              held.lastSeenAt = now;
              continue;
            }
            if (now - (held.claimed ? held.lastSeenAt : held.createdAt) < DETACHED_GRACE) continue;
            detached.delete(handle);
            if (sessions.has(held.session)) continue;
            const port = options.worktrees;
            if (port === undefined || await port.dirty(held.path).catch(() => true)) continue;
            worktrees.delete(held.session);
            await port.remove(held.repository, held.path, held.branch)
              .then(() => { log(`removed ${held.path}: the window let ${handle} go`); })
              .catch((error: unknown) => { log(`kept ${held.path}: ${error instanceof Error ? error.message : String(error)}`); });
          }
          return {};
        },
        'vscode/removeSessionArtifact': async (params) => {
          const session = String(params.session ?? '');
          const artifactId = String(params.artifactId ?? '').trim();
          if (session === '' || artifactId === '') throw new RpcError(-32602, 'session and artifactId must be non-empty strings');
          const uri = sessions.has(session) ? session : sessionFor(session);
          const held = kept.artifacts(idOf(uri)) ?? [];
          const left = held.filter((one) => one.id !== artifactId);
          if (left.length !== held.length) setArtifacts(uri, left);
          return {};
        },
        /**
         * Where the backend's own record of a session is.
         *
         * The window's "open session state file", behind
         * `_meta['vscode.getAgentHostSessionStateFile.chat']` in `initialize`
         * since it names a chat as well as a session. A backend that writes
         * no such file answers no resource, which is the reference host's
         * answer too.
         */
        'vscode/getAgentHostSessionStateFile': async (params) => {
          if (typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
          if (params.chat !== undefined && typeof params.chat !== 'string') throw new RpcError(-32602, 'chat must be a URI string');
          const found = stateFileOf(params.session, params.chat);
          return found === undefined ? {} : { resource: `file://${found}` };
        },
        /**
         * The logs, packed up for a bug report.
         *
         * The host's own files under `agenthost/`, and the session's record
         * as `events.jsonl` when a session is named - the names the reference
         * host's collector gives them, so the window reads the result the
         * same. The archive is read back in chunks; the directory is opened
         * where it is.
         */
        'vscode/collectAgentHostDebugLogs': async (params) => {
          const kind = params.kind;
          if (kind !== 'archive' && kind !== 'directory') throw new RpcError(-32602, 'kind must be archive or directory');
          if (params.session !== undefined && typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
          if (params.chat !== undefined && typeof params.chat !== 'string') throw new RpcError(-32602, 'chat must be a URI string');
          if (params.chat !== undefined && params.session === undefined) throw new RpcError(-32602, 'chat must belong to the requested Agent Session');
          const files: LogFile[] = (options.diagnostics?.logs?.() ?? []).map((file) => ({ path: hostLogPath(file), from: file }));
          const record = params.session === undefined ? undefined : stateFileOf(params.session, params.chat);
          if (record !== undefined) files.push({ path: 'events.jsonl', from: record, provider: true });
          return await logs.collect(files, kind);
        },
        'vscode/readAgentHostDebugLogsChunk': async (params) => {
          if (typeof params.resource !== 'string') throw new RpcError(-32602, 'resource must be a URI string');
          if (typeof params.position !== 'number') throw new RpcError(-32602, 'position must be a number');
          try { return await logs.read(params.resource, params.position); }
          catch (error) { throw new RpcError(-32602, error instanceof Error ? error.message : String(error)); }
        },
        /**
         * The four the window asks of its own host about itself.
         *
         * `shutdown` answers first and stops after, so the window hears yes
         * rather than a dropped socket. The network diagnostics are what the
         * process can see - the proxy variables, and the endpoints its
         * backends name - and `diagnosticsFetch` tries one. Managed settings
         * are a policy layer this host has no counterpart to, and an empty
         * list is the honest shape of that.
         */
        shutdown: async () => {
          const stop = options.diagnostics?.shutdown;
          if (stop === undefined) throw new RpcError(METHOD_NOT_FOUND, 'This host does not serve shutdown');
          setTimeout(() => { void Promise.resolve(logs.close()).then(() => stop()); }, 0);
          return {};
        },
        getNetworkDiagnosticsInfo: async () => {
          const proxyEnv: Record<string, string> = {};
          for (const key of PROXY_ENV) {
            const value = process.env[key];
            if (value) proxyEnv[key] = value;
          }
          const endpoints = [...agents.values()].flatMap((agent) => agent.endpoints?.() ?? []);
          if (options.github !== undefined) endpoints.push({ name: 'GitHub API', url: 'https://api.github.com/' });
          return {
            version: options.diagnostics?.version ?? '0.0.1',
            os: process.platform,
            arch: process.arch,
            proxySettings: {},
            proxyEnv,
            endpoints,
          };
        },
        getManagedSettingsDiagnostics: async () => [],
        diagnosticsFetch: async (params) => {
          if (typeof params.url !== 'string') throw new RpcError(-32602, 'url must be a string');
          let target: URL;
          try { target = new URL(params.url); }
          catch { throw new RpcError(-32602, `${params.url} is not a URL`); }
          const [dnsIpv4, dnsIpv6] = await Promise.all([resolved(target.hostname, 4), resolved(target.hostname, 6)]);
          const began = Date.now();
          try {
            const answer = await fetch(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
            const body = await answer.text();
            return {
              url: params.url, dnsIpv4, dnsIpv6,
              statusCode: answer.status, statusMessage: answer.statusText,
              body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
              durationMs: Date.now() - began,
            };
          }
          catch (error) {
            return { url: params.url, dnsIpv4, dnsIpv6, error: reason(error), durationMs: Date.now() - began };
          }
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
            : {}) as Record<string, unknown>;
          /*
           * The host's own properties, merged over the backend's.
           *
           * Over rather than under: `isolation` and its two companions are
           * this host's to answer, and a backend that happened to advertise
           * the same names would be advertising control of a directory it
           * does not choose.
           */
          /*
           * `workingDirectory`, singular, because that is the field this
           * command declares.
           *
           * `createSession` takes `workingDirectories` and this one does not,
           * and reading the plural here meant the answer was always computed
           * against the host's own first path instead of the folder the
           * question was about - so a client asking about a repository was
           * told what a non-repository offers, which is no isolation at all.
           * The plural is still read after it, for a client that sends what
           * the neighbouring command takes.
           */
          const one = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
          const asked = one ?? (Array.isArray(params.workingDirectories)
            ? params.workingDirectories.find((entry) => typeof entry === 'string')
            : undefined);
          const mine = await isolating(
            typeof asked === 'string' ? asked.replace(/^file:\/\//, '') : dir,
            typeof answered.isolation === 'string' ? answered.isolation : undefined,
          );
          const theirs = published(agent.schema());
          const properties = {
            ...(typeof theirs.properties === 'object' && theirs.properties !== null ? theirs.properties : {}),
            ...(typeof mine.schema.properties === 'object' && mine.schema.properties !== null ? mine.schema.properties : {}),
          };
          // Iterative, as a real host's is: what has been answered comes back
          // answered, so re-asking does not quietly undo a choice.
          return {
            schema: { ...theirs, properties },
            values: { ...agent.defaults(), ...mine.defaults, ...answered },
          };
        },
        /**
         * The values behind a property whose list is too long to send.
         *
         * Only `branch`, because it is the only key here with more values than
         * a picker holds - the rest are enums of five things or fewer, and a
         * client is told so by their schema. A property this host has no
         * lookup for answers with nothing rather than an error: the client
         * asked what else there is, and "nothing else" is an answer.
         */
        sessionConfigCompletions: async (params) => {
          const property = String(params.property ?? '');
          const asked = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
          const port = options.worktrees;
          if (property !== 'branch' || !port) return { items: [] };
          const where = (asked ?? `file://${dir}`).replace(/^file:\/\//, '');
          const repository = await port.repository(where).catch(() => undefined);
          if (repository === undefined) return { items: [] };
          const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
          const branches = await port.branches(repository).catch(() => [] as string[]);
          /*
           * Substring rather than prefix, and capped.
           *
           * Somebody looking for `softov/agents/1a2b` types `1a2b`, and a
           * prefix match would answer nothing. The cap is the same one the
           * schema seeds with, because the list is ordered by most recent
           * commit and a picker showing four hundred rows is one nobody reads.
           */
          const found = branches.filter((name) => name.toLowerCase().includes(query));
          return { items: found.slice(0, SEEDS).map((name) => ({ value: name, label: name })) };
        },
      };
      /**
       * One client action, applied.
       *
       * Only the actions a client is *allowed* to originate: the rest are
       * this host telling clients what it did, and one arriving from a client
       * is a client lying about what happened. The protocol package carries
       * the authority - `IS_CLIENT_DISPATCHABLE` - and its own docstring says
       * servers should check it.
       *
       * Separate from the notification entry below only so the origin can be
       * held around the whole of it. `origin` is taken as an argument as well,
       * for the few sites that answer in a later turn of the event loop: a
       * config key the backend has to be asked about cannot read `applying`,
       * because by the time it answers that is nobody's.
       */
      const applyDispatch = (params: Record<string, unknown>, origin: Origin): void => {
        const asked = String(params.channel ?? '');
        // Resolved before anything looks it up, so a client that talks to a
        // chat - or a session - under its own spelling drives the same one it
        // is watching rather than one nothing here has heard of.
        const channel = meantBy(asked);
        const action = (typeof params.action === 'object' && params.action !== null
          ? params.action
          : {}) as Record<string, unknown>;
        const type = String(action.type ?? '');
        /** Refuse this dispatch, in the words of whatever would not have it. */
        const no = (reason: string): void => refuse(connection.peer, channel, action, origin, reason);
        /*
         * Whether a client is allowed to originate this at all, asked of the
         * protocol rather than answered here.
         *
         * `IS_CLIENT_DISPATCHABLE` is exhaustive over `StateAction` and its
         * own docstring says servers should check it, so it grows with the
         * protocol and the switch below does not have to. Refused with its own
         * reason: a host-only action arriving from a client is a client
         * claiming something happened, which is not the same complaint as an
         * action this host has not got round to serving - and told apart only
         * here, because both used to fall into the one default.
         */
        /*
         * A watch this client itself keeps, whose reports this host relays.
         *
         * `resourceWatch/changed` is a host's to say - except on a watch over
         * a client's own resources, where that client is the only thing that
         * can see the files move: it was asked for the watch through
         * `createResourceWatch` and answered with the channel. Passed
         * straight through to whoever subscribed, and refused from anybody
         * else by the check below - a change to somebody else's files is not
         * a thing a third client may claim happened.
         */
        if (relayed.get(channel)?.owner === connection) {
          dispatch(channel, action, origin);
          return;
        }
        if (dispatchable[type] === false) {
          no(`${type} is this host's to say, not a client's`);
          return;
        }
        /*
         * A mark on a file, kept for whoever else is in the session.
         *
         * Reduced with the protocol's own `annotationsReducer` rather than
         * with five cases written here: every client applies its own dispatch
         * with that function, and a host that reduced the same action even
         * slightly differently would hand out a state its clients disagree
         * with. It returns the state it was given when the action names
         * something that is not there, which is what makes a no-op tellable
         * from a change - and a no-op echoed as though it had applied is a
         * client left holding an optimistic mark this host never kept.
         */
        if (type.startsWith('annotations/')) {
          if (!channel.endsWith(MARKS)) {
            no(`${type} belongs on a session's ${MARKS} channel, not ${channel}`);
            return;
          }
          const id = idOf(channel.slice(0, -MARKS.length));
          const before = marksOf(id);
          const after = annotationsReducer(before, action as unknown as AnnotationsAction);
          if (after === before) {
            no(`${type} names an annotation this session does not have`);
            return;
          }
          marks.set(id, after);
          dispatch(channel, action);
          return;
        }
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
        /*
         * What a client wants of this host, kept and said back.
         *
         * On the root channel, so it belongs to no session and there is
         * nothing to look up. VS Code pushes this at connect and used to be
         * answered with `dispatchAction root/configChanged on unknown
         * ahp-root://` - the shell it asked for went nowhere, and every
         * terminal opened whatever `$SHELL` happened to be.
         */
        if (channel === ROOT && type === 'root/configChanged') {
          const config = (typeof action.config === 'object' && action.config !== null
            ? action.config
            : {}) as Record<string, unknown>;
          if (action.replace === true) for (const key of Object.keys(rootConfig)) delete rootConfig[key];
          for (const [key, value] of Object.entries(config)) {
            // `undefined` is how a key is taken back, and JSON has no such
            // value - so a client saying so sends the key with a null.
            if (value === null || value === undefined) delete rootConfig[key];
            else rootConfig[key] = value;
          }
          log(`root config: ${Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') || '(nothing)'}`);
          /*
           * The artifact wording is read where the tools are built, so a
           * running session is told the new set now and handed it again when
           * its chats are retooled. The definitions move even though the
           * tools do not: what a client draws is the description.
           */
          if (Object.prototype.hasOwnProperty.call(config, 'artifactToolsCompactPrompts')) {
            for (const uri of sessions.keys()) {
              dispatch(uri, { type: 'session/serverToolsChanged', tools: toolDefinitions(uri) });
              retool(uri);
            }
          }
          // Said back, like every other action a client originates: nothing
          // in a client applies its own dispatch, and a second client
          // watching the root learns of it only from here.
          dispatch(ROOT, action);
          return;
        }
        if (type === 'changeset/filesReviewChanged') {
          const cut = channel.indexOf('/changeset/');
          const owner = cut > 0 ? channel.slice(0, cut) : '';
          const scope = cut > 0 ? channel.slice(cut + '/changeset/'.length) : '';
          const dir = owner === '' ? undefined : dirOf(owner);
          const files = Array.isArray(action.files)
            ? action.files.filter((one): one is string => typeof one === 'string')
            : [];
          const on = action.reviewed === true;
          if (dir === undefined || files.length === 0) {
            no(`${channel} is not a changeset, or no files were named`);
            return;
          }
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
          if (!store) { no(`${type} needs an automations store, and this host has none`); return; }
          const resource = String(action.resource ?? '');
          if (!resource.startsWith('ahp-automation:/')) {
            no(`${resource || 'That'} is not an automation URI`);
            return;
          }
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
          if (!made) no(`No automation at ${resource}`);
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
            no(`${resource} does not offer remove`);
            return;
          }
          store.remove(resource);
          return;
        }

        if (type === 'automationRun/cancelRequested') {
          no('A run here is a session, and disposing it is how it stops');
          return;
        }

        if (type === 'session/activeClientSet') {
          // `titles` is keyed by the bare id, so the URI has to come off before
          // it is asked. Under the whole channel this never matched, and every
          // client announcing itself in a session read from a transcript - the
          // ordinary way one is opened - was dropped in silence. It became
          // audible only once dropping stopped being silent.
          /*
           * Known to this host, which is not the same as running here.
           *
           * `owners` is every session the catalogue has listed and every one
           * this host started; `titles` is only the ones whose transcript
           * somebody has opened. Asking `titles` turned away a client
           * announcing itself in a row `listSessions` had returned a moment
           * earlier - which is the ordinary case, because a client announces
           * itself when it opens a row rather than after reading it.
           */
          if (!sessions.has(channel) && !owners.has(channel)) {
            no(`${channel} is not a session here`);
            return;
          }
          const clientId = connection.clientId || 'anonymous';
          const carried = (typeof action.activeClient === 'object' && action.activeClient !== null
            ? action.activeClient
            : {}) as Bag;
          const activeClient: Bag = {
            ...carried,
            clientId,
            tools: Array.isArray(carried.tools) ? carried.tools : [],
          };
          const held = presence.get(idOf(channel)) ?? new Map<string, Bag>();
          presence.set(idOf(channel), held);
          /*
           * Saying again what this host already held is not a change.
           *
           * `serverSeq` advances with *state* and never with messages, and a
           * client reconciles what it contributes whenever the session state
           * moves. So an echo of an announcement that changed nothing was
           * itself the change that prompted the next announcement, and the two
           * of us ran that loop three hundred times in a few seconds, burning
           * a sequence number apiece. The guard `isReadChanged` has below is
           * the same guard, and this is the same reason for it.
           */
          if (JSON.stringify(held.get(clientId)) === JSON.stringify(activeClient))
            return;
          // Re-announcing is how a client refreshes what it contributes, so
          // this replaces rather than merges - a tool taken away has to be
          // able to go.
          held.set(clientId, activeClient);
          dispatch(channel, { type, activeClient });
          // What it says it can run is a change to what the model is offered,
          // which is the whole point of the field: announced and never read,
          // `tools` was a list this host published back at the client that
          // sent it.
          retool(channel);
          return;
        }

        if (type === 'session/isReadChanged' || type === 'session/isArchivedChanged') {
          const uri = sessionFor(channel);
          const bit = type === 'session/isReadChanged' ? Status.IsRead : Status.IsArchived;
          const on = type === 'session/isReadChanged'
            ? action.isRead === true
            : action.isArchived === true;
          const before = kept.flags(idOf(uri));
          const after = on ? before | bit : before & ~bit;
          if (after === before)
            return;
          kept.setFlags(idOf(uri), after);
          // Every client watching, and the catalogue: a flag one client sets
          // is a flag the others have to see, which is what having a host
          // for this buys over each client keeping its own.
          dispatch(uri, action);
          summaryMoved(uri);
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
            case 'terminal/cleared':
              terminal.clear();
              break;
            case 'terminal/titleChanged':
              terminal.setTitle(String(action.title ?? ''));
              break;
            case 'terminal/claimed': {
              // A notification, so a malformed one is dropped rather than
              // refused - and dropped is right: the alternative was setting
              // the claim to `{}`, which told every other client that
              // nobody owned it.
              const claimed = claimOf(action.claim);
              if (claimed) terminal.setClaim(claimed);
              break;
            }
            default:
              no(`${type} is not served on a terminal`);
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
          const uri = sessionFor(channel);
          const config = (typeof action.config === 'object' && action.config !== null
            ? action.config
            : {}) as Record<string, unknown>;
          const values = { ...kept.config(idOf(uri)) };
          for (const [key, value] of Object.entries(config)) values[key] = String(value);
          kept.setConfig(idOf(uri), values);
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
          // The session the chat belongs to, which is not the chat's own name:
          // a chat URI carries its session rather than being derived from it.
          const uri = sessionFor(channel);
          const id = idOf(uri);
          void (async () => {
            const seed = await past(id);
            if (!seed) {
              refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
              return;
            }
            /*
             * Named again, because `past` is what learned whose session this
             * is - and what this host will call it.
             *
             * A client may say the first thing about a row before anything has
             * listed a catalogue, and until something has, there is no name to
             * look an owner up under. Asking with the name computed beforehand
             * found nothing and refused a session that was right there.
             */
            const named = nameOf(id);
            const owner = owners.get(named);
            if (!owner) {
              refuse(connection.peer, channel, action, origin, `No backend owns ${channel}`);
              return;
            }
            // Back where it ran. A session continued in another directory is
            // a conversation whose second half cannot see the files its
            // first half was about.
            const ran = wheres.get(named)?.[0]?.replace(/^file:\/\//, '');
            const session = spawn(owner, named, chatUriFor(named), kept.config(id) ?? {}, { resume: id, seed }, ran);
            log(`resumed ${named}`);
            dispatch(named, { type: 'session/ready' });
            summaryMoved(named);
            const message = (typeof action.message === 'object' && action.message !== null
              ? action.message
              : {}) as Record<string, unknown>;
            void fire('message', {
              type: 'message',
              session: named,
              chat: chatUriFor(named),
              turn: String(action.turnId ?? ''),
              text: String(message.text ?? ''),
            });
            session.begin(String(action.turnId ?? ''), String(message.text ?? ''), modelIn(message.model));
          })();
          return;
        }
        const session = held;
        /*
         * A draft in a session this host is not running.
         *
         * The one client action worth taking without starting anything: it
         * moves no conversation, costs a map entry, and starting a CLI
         * because somebody typed a character would be a session opened by
         * accident. Everything else still needs a session, and says so.
         *
         * Checked against the catalogue rather than taken on trust, the way
         * `chat/turnStarted` is - a chat URI is a client's to spell, and a
         * draft held for a session nobody has is a map that only grows.
         */
        if (!session && type === 'chat/draftChanged') {
          const id = idOf(sessionFor(channel));
          void (async () => {
            if (!(await past(id))) {
              refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
              return;
            }
            const next = typeof action.draft === 'object' && action.draft !== null
              ? action.draft as Bag
              : undefined;
            if (next === undefined) drafts.delete(channel);
            else drafts.set(channel, next);
            // Echoed, because the point of a draft being on the wire at all is
            // that the other clients watching this chat see it.
            dispatch(channel, action, origin);
          })();
          return;
        }
        if (!session) {
          // With its keys, because the useful half of this line is what was
          // in the action nobody read - a type alone says only that a client
          // wanted something.
          const carried = Object.keys(action).filter((key) => key !== 'type');
          no(`${type} names nothing here${carried.length > 0 ? ` (${carried.join(', ')})` : ''}`);
          return;
        }
        switch (type) {
          case 'chat/turnStarted': {
            const message = (typeof action.message === 'object' && action.message !== null
              ? action.message
              : {}) as Record<string, unknown>;
            const text = String(message.text ?? '');
            const turnId = String(action.turnId ?? '');
            // Before it is started or queued, so a handler sees it once
            // whether or not the backend is free to run it this moment.
            void fire('message', { type: 'message', session: session.uri, chat: session.chatUri, turn: turnId, text });
            /*
             * `!ls` is a command, and everything else is a question.
             *
             * Trimmed, and empty means it was neither: a lone `!` is somebody
             * typing an exclamation mark, and it goes to the agent like any
             * other text. The three conditions are the three halves that have
             * to be there - a shell to run it in, a session that will hold a
             * turn it did not answer, and something after the mark.
             */
            const command = text.startsWith(BANG) ? text.slice(BANG.length).trim() : '';
            if (command !== '' && options.terminals) {
              /*
               * Refused rather than sent, when the backend cannot hold one.
               *
               * `Session.ran` is optional, so a backend that leaves it out has
               * no turn to put a shell command in. Handing `!ls` to the model
               * instead is the one thing the prefix promises not to do: the
               * answer would be prose about the command rather than the command.
               * A refusal is what tells the client to put its optimistic turn
               * back, rather than leaving it open over a message nobody ran.
               */
              if (!session.ran) {
                const name = sessions.get(session.uri)?.agent.provider ?? 'This provider';
                refuse(
                  connection.peer, channel, action, origin,
                  `${name} cannot run a command in a turn; use a terminal instead`,
                );
                break;
              }
              const where = session.workingDirectories()[0]?.replace(/^file:\/\//, '') ?? dir;
              session.ran(turnId, command, (toolCallId) => commanded(command, where, {
                kind: 'session',
                session: session.uri,
                chat: session.chatUri,
                turnId,
                toolCallId,
              }));
              break;
            }
            session.begin(turnId, text, modelIn(message.model));
            break;
          }
          /**
           * One key, merged.
           *
           * The action carries only what changed, so writing the whole
           * object back would revert whatever another client set while this
           * one had the form open.
           */
          /*
           * A directory added to, taken from, or put in place of the session's set.
           *
           * The SDK takes its directories when the CLI starts and exposes no
           * way to add one after, so this starts the backend again *resumed* -
           * the same conversation, in a wider place - rather than refusing.
           * Not while a turn is running: a CLI replaced mid-answer is an
           * answer that stops halfway, and `-32004` is the code for asking a
           * client to wait.
           */
          /*
           * A rename from a client.
           *
           * On a chat channel it names that chat, the way the reference host
           * reads it (`sessionTitleContribution.ts`); on the session channel
           * it names the session, which is its default chat. Blank is a
           * refusal, not a blank title: a row nobody can find again is the
           * thing the derived title exists to prevent.
           */
          case 'session/titleChanged': {
            const uri = session.uri;
            const owner = sessions.get(uri);
            if (owner === undefined) {
              no(`${channel} is not a session this host is running`);
              break;
            }
            const title = String(action.title ?? '').trim();
            if (title === '') {
              no('a title cannot be blank');
              break;
            }
            renameChat(uri, byChat.has(channel) ? channel : owner.defaultChat, title);
            break;
          }
          case 'session/workingDirectorySet':
          case 'session/workingDirectoryRemoved':
          case 'session/workingDirectoryReplaced': {
            const owner = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
            if (owner === undefined) {
              no(`${channel} is not a session this host is running`);
              break;
            }
            if (owner.agent.multipleDirectories !== true) {
              no(`${owner.agent.provider} works in one directory per session`);
              break;
            }
            const uri = session.uri;
            if ((statusOf(uri) & Status.InProgress) !== 0) {
              no('a working directory cannot change while a turn is running');
              break;
            }
            const path = (value: unknown): string => String(value ?? '').replace(/^file:\/\//, '');
            const held = owner.additional ?? [];
            let after = held;
            if (type === 'session/workingDirectorySet') {
              const one = path(action.directory);
              if (one === '' || one === owner.workingDirectory || held.includes(one)) break;
              after = [...held, one];
            }
            else if (type === 'session/workingDirectoryRemoved') {
              const one = path(action.directory);
              // The first is the process root and the protocol says a client
              // MUST NOT remove it. Said rather than silently ignored.
              if (one === owner.workingDirectory) {
                no('the first working directory is the one the agent runs in, and cannot be removed');
                break;
              }
              if (!held.includes(one)) break;
              after = held.filter((other) => other !== one);
            }
            else {
              // The primary slot, replaced atomically - which is the only way
              // index 0 may move, and why this host advertises
              // `primaryReplacement` beside `immutablePrimary`.
              const one = path(action.directory);
              if (one === '' || one === owner.workingDirectory) break;
              owner.workingDirectory = one;
            }
            owner.additional = after;
            void restart(uri, tokensFor(owner.agent.provider), { additional: after })
              .then(() => { dispatch(uri, action, origin); })
              .catch((error: unknown) => { no(error instanceof Error ? error.message : String(error)); });
            break;
          }
          case 'session/configChanged': {
            const config = (typeof action.config === 'object' && action.config !== null
              ? action.config
              : {}) as Record<string, unknown>;
            // Config belongs to the session, so it is remembered there: a
            // chat opened after this one is answered starts on it too.
            const owning = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
            if (owning) {
              // Kept as it arrived. A config value is `unknown` on the wire,
              // and `permissions` is an object - stringifying it made a
              // session remember the word `[object Object]`.
              for (const [key, value] of Object.entries(config)) owning.config[key] = value;
            }
            /*
             * This host's own keys, which no backend has heard of.
             *
             * `isolation` and its companions decide a directory, and a
             * directory is decided when a session is created - so the answer
             * can still move while nothing has been said, and not afterwards.
             * That window is exactly the one a client puts these controls in
             * front of somebody in: it creates the backend session first so
             * the controls have somewhere to write, then sends the first
             * message. Applied together and started once, because two keys in
             * one action are one decision.
             */
            const settled = decided.get(session.uri) ?? {};
            const ours = Object.entries(config)
              .filter(([key]) => HOSTS_OWN.includes(key))
              // Only what actually differs. A client that sends its whole
              // config bag back - the same `isolation` it was given - is
              // agreeing with this host, and restarting a session to arrive
              // where it already is would be a session that disposed and
              // reopened itself for nothing.
              .filter(([key, value]) => value !== settled[key]);
            if (ours.length > 0 && owning !== undefined) {
              const bad = ours.find(([, value]) => typeof value !== 'string');
              const started = [...owning.chats.values()].some((chat) => chat.allTurns().length > 0);
              if (bad !== undefined) no(`${bad[0]} takes a string`);
              else if (started) no(`${ours[0]?.[0]} is fixed once the session has started`);
              else {
                const mine = { ...settled };
                for (const [key, value] of ours) mine[key] = value as string;
                decided.set(session.uri, mine);
                const uri = session.uri;
                void restart(uri, tokensFor(owning.agent.provider))
                  .then(() => {
                    for (const [key, value] of ours)
                      dispatch(uri, { type: 'session/configChanged', config: { [key]: value } }, origin);
                  })
                  .catch((error: unknown) => { no(error instanceof Error ? error.message : String(error)); });
              }
            }
            for (const [key, value] of Object.entries(config)) {
              // Answered above, and not the backend's to hear about.
              if (HOSTS_OWN.includes(key)) continue;
              /*
               * What the schema says about this key, rather than what this
               * file used to know about four of them.
               *
               * `host.ts` imports no backend and is meant not to know one
               * exists, and it held the names `permissionMode`, `model`,
               * `effortLevel` and `outputStyle` and refused `thinking` by
               * name. Every one of those is a property of whatever schema the
               * backend published, and the two things this layer actually
               * needs to know are declared there: whether the key can move on
               * a running session, and whether it belongs to the session or
               * to one chat in it.
               */
              const property = propertyOf(owning?.agent, key);
              /*
               * Absent is not a refusal.
               *
               * `autoApprove` and `mode` are conventional names a client
               * sends whatever a host advertises, and this backend takes both
               * without declaring either - so the schema decides how a key
               * behaves and the backend decides whether it is taken at all.
               */
              // Immutable, and said so rather than accepted and dropped: a
              // control that reports success and changes nothing is worse
              // than one that refuses.
              if (property?.sessionMutable === false) {
                no(`${key} is fixed when the session is created`);
                continue;
              }
              if (session.setConfig === undefined) {
                no(`${key} is not a config key this backend takes`);
                continue;
              }
              /*
               * Every chat, or only this one, as the property says.
               *
               * A permission mode and an output style are the session's: the
               * chats are peers on one config, and a voice set on one of them
               * is a session where two conversations answer differently. A
               * model is the chat's. Neither is a fact about this host.
               */
              const everywhere = property?.scope === 'chat'
                ? []
                : (owning ? [...owning.chats.values()] : []).filter((chat) => chat !== session);
              for (const chat of everywhere) void Promise.resolve(chat.setConfig?.(key, value));
              void Promise.resolve(session.setConfig(key, value)).then((answer) => {
                // The backend's own words when it refused, because only it
                // knows whether the key or the value was the problem.
                if (answer === true) dispatch(session.uri, { type: 'session/configChanged', config: { [key]: value } }, origin);
                else no(answer);
              });
            }
            break;
          }
          /*
           * The latest turn, run again rather than typed again.
           *
           * The protocol's own conditions - latest, errored, message and parts
           * intact - are the backend's to check, because only it knows what
           * its last turn was. A backend that cannot re-run one says so here
           * rather than being asked to.
           */
          /*
           * A directory added to or taken from this chat's own set.
           *
           * The same mechanism the session's set uses - the CLI is started
           * again, resumed - applied to one chat rather than all of them. A
           * chat may only ever narrow its session's set, so anything outside
           * it is refused rather than quietly widening the session.
           */
          case 'chat/workingDirectorySet':
          case 'chat/workingDirectoryRemoved': {
            const owner = byChat.get(channel);
            if (owner === undefined) {
              no(`${channel} is not a chat this host is running`);
              break;
            }
            const held = sessions.get(owner.uri);
            if (held === undefined || held.agent.multipleDirectories !== true) {
              no('this backend works in one directory per session');
              break;
            }
            if ((statusOf(owner.uri) & Status.InProgress) !== 0) {
              no('a working directory cannot change while a turn is running');
              break;
            }
            const one = String(action.directory ?? '').replace(/^file:\/\//, '');
            const own = [held.workingDirectory, ...(held.additional ?? [])].filter((entry) => entry !== undefined);
            const had = beside.get(channel) ?? held.additional ?? [];
            let next = had;
            if (type === 'chat/workingDirectorySet') {
              if (!own.includes(one)) {
                no(`${one} is not a working directory of ${owner.uri}`);
                break;
              }
              if (one === held.workingDirectory || had.includes(one)) break;
              next = [...had, one];
            }
            else {
              if (one === held.workingDirectory) {
                no('the first working directory is the one the agent runs in, and cannot be removed');
                break;
              }
              if (!had.includes(one)) break;
              next = had.filter((other) => other !== one);
            }
            beside.set(channel, next);
            restartChat(owner.uri, channel, tokensFor(held.agent.provider));
            dispatch(channel, action, origin);
            break;
          }
          case 'chat/turnResume': {
            if (session.resume === undefined) {
              no('this backend cannot run a turn again');
              break;
            }
            if (!session.resume(String(action.turnId ?? ''))) {
              no(`${String(action.turnId ?? '')} is not a turn that can be resumed`);
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
            const message = (typeof action.message === 'object' && action.message !== null
              ? action.message
              : {}) as Record<string, unknown>;
            /*
             * Into the running turn, rather than behind it.
             *
             * Somebody correcting an agent halfway is the most ordinary thing
             * there is, and queueing it delivered the correction after the
             * thing it was trying to stop. The two refusals left are real: a
             * backend that cannot take a message mid-turn, and a chat with
             * nothing running to steer.
             */
            if (kind === 'steering') {
              if (!session.steer) {
                no('This backend cannot take a message mid-turn');
                break;
              }
              if (!session.steer(String(action.id ?? ''), String(message.text ?? ''))) {
                no('Nothing is running in this chat to steer');
              }
              break;
            }
            if (kind !== 'queued') {
              no(`${kind} is neither a steering message nor a queued one`);
              break;
            }
            const model = (typeof message.model === 'object' && message.model !== null
              ? message.model
              : {}) as Record<string, unknown>;
            session.queue(String(action.id ?? ''), String(message.text ?? ''), modelIn(model));
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
              // that did not happen - and the refusal beside it is what tells
              // the one client that asked why it moved back.
              no(`${id} has no runtime switch`);
              dispatch(session.uri, { type: 'session/customizationsChanged', customizations: session.customizations() });
            });
            break;
          }
          case 'session/mcpServerStartRequested':
            void session.startMcpServer(String(action.id ?? '')).then((took) => {
              if (!took) no(`${String(action.id ?? '')} would not start`);
            });
            break;
          case 'session/mcpServerStopRequested':
            void session.stopMcpServer(String(action.id ?? '')).then((took) => {
              if (!took) no(`${String(action.id ?? '')} would not stop`);
            });
            break;
          case 'chat/draftChanged':
            // A `Message`, not a string: `ChatState.draft` is the message
            // somebody is part-way through writing, model and all. Absent
            // clears it, which is what the action says `undefined` means.
            session.setDraft(typeof action.draft === 'object' && action.draft !== null
              ? action.draft as Bag
              : undefined);
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
          case 'chat/inputCompleted': {
            /*
             * `response`, which is the field the action has.
             *
             * `ChatInputResponseKind` is `accept`, `decline` or `cancel`, and
             * this read `accepted` - a key no client sends - so every answer
             * arrived as an accept and a person declining a question was
             * indistinguishable from one answering it. `accepted` is still
             * honoured for anything that sent it before this, but `response`
             * decides when both are there.
             */
            const response = typeof action.response === 'string' ? action.response : undefined;
            const accepted = response !== undefined ? response === 'accept' : action.accepted !== false;
            session.answer(String(action.requestId ?? action.id ?? ''), accepted, (typeof action.answers === 'object' && action.answers !== null
              ? action.answers
              : {}) as Record<string, unknown>);
            break;
          }
          /*
           * Drop the turns after a named one, and mean it.
           *
           * This is edit-and-resend: a client truncates to the turn before
           * the message somebody wants to change, then starts a new turn with
           * the edited text. So the agent has to forget the dropped turns as
           * well - a host that only cleared its own screen would leave the
           * conversation carrying on from a history nobody can see any more,
           * and the next answer would be about the message that was edited
           * away.
           *
           * Forgetting them means the CLI is started again, resumed at the
           * last thing the kept turn did. The turns up to there are handed
           * over as the seed, so the chat keeps its history across the
           * restart, and the session id is kept - see `rewindAt` - so a later
           * resume reaches the truncated conversation rather than the one
           * this dropped.
           */
          case 'chat/truncated': {
            const turnId = typeof action.turnId === 'string' ? action.turnId : undefined;
            /*
             * Every turn, which this host cannot ask for.
             *
             * The action's `turnId` is optional and its absence means "clear
             * the whole conversation" - which as a rewind is a cut at a point
             * before the first prompt, and there is no such entry to name.
             * Refused rather than served as an emptied screen in front of an
             * agent that remembers all of it.
             */
            if (turnId === undefined) {
              no('This host can drop the turns after one, but not a conversation entire');
              break;
            }
            const all = session.allTurns();
            const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
            if (at < 0) {
              no(`${turnId} is not a completed turn in ${session.chatUri}`);
              break;
            }
            // The backend's own name for the end of that turn. Absent for a
            // turn this process did not watch run - one read back off a
            // transcript - and a rewind to a point the backend cannot be told
            // is the half of this that would silently not happen.
            const point = session.endPoint?.(turnId);
            const started = session.agentId();
            const owner = sessions.get(session.uri);
            if (point === undefined || started === undefined || owner === undefined) {
              no(`${turnId} is not a turn this host can rewind to`);
              break;
            }
            /*
             * Said before the restart, not after.
             *
             * A client applies this by dropping the turns after `turnId`; the
             * session that comes up behind it opens with exactly those turns.
             * In the other order a client would take a full snapshot and then
             * be told to cut it, which is the same end state reached by
             * showing somebody the turns they asked to be rid of.
             */
            dispatch(session.chatUri, action);
            session.close();
            // So the next thing the new session says about itself is reported
            // rather than compared against what the old one last said.
            described.delete(session.chatUri);
            spawn(
              owner.agent,
              session.uri,
              session.chatUri,
              owner.config,
              { resume: started, rewindAt: point, seed: all.slice(0, at + 1) as Bag[] },
              owner.workingDirectory,
              undefined,
              beside.get(session.chatUri) ?? owner.additional,
            );
            log(`truncated ${session.chatUri} to ${turnId}`);
            break;
          }
          /*
           * Somebody's half-typed answer, kept for whoever else is looking.
           *
           * The same argument as `chat/draftChanged`: two people on one chat
           * are answering one question, and an answer each client kept to
           * itself would need no host at all. What it is kept *on* is the
           * request this host is already holding open - the protocol calls
           * the result the request's synced answer state, and says a
           * `chat/inputCompleted` may carry no answers because this is where
           * they are.
           */
          case 'chat/inputAnswerChanged': {
            if (!session.setAnswer) {
              no('This backend keeps no draft answers');
              break;
            }
            const requestId = String(action.requestId ?? '');
            const questionId = String(action.questionId ?? '');
            // Absent clears that question's draft, which is what the action
            // says `undefined` means and the only way JSON can say it.
            const answer = typeof action.answer === 'object' && action.answer !== null
              ? action.answer as Bag
              : undefined;
            if (!session.setAnswer(requestId, questionId, answer))
              no(`${requestId} is not a question this chat is waiting on`);
            break;
          }
          /*
           * Approving a tool call's *result*, which nothing here ever asks for.
           *
           * It belongs to a call completed with `requiresResultConfirmation`,
           * and no call this host builds sets it - the confirmation asked for
           * here is before the tool runs, not after. A client sending one is
           * answering a question nobody put.
           */
          case 'chat/toolCallResultConfirmed':
            no('No tool call here asks for its result to be confirmed');
            break;
          /*
           * What a client's own tool did, said by the client that ran it.
           *
           * The protocol makes the client named in the call's contributor
           * responsible for executing it and dispatching the result, so this
           * is the other half of offering a client's tools to the model at
           * all: the agent is blocked on this call, and this is what unblocks
           * it.
           *
           * Nothing is echoed from here. The result goes back to the harness,
           * the harness writes the tool result, and the session reports the
           * completion to every client from that - the same path every other
           * tool call takes. Relaying it here as well would draw the row
           * finished twice, once from a client's word and once from what
           * actually happened.
           */
          case 'chat/toolCallComplete': {
            const toolCallId = String(action.toolCallId ?? '');
            const clientId = connection.clientId || 'anonymous';
            const result = (typeof action.result === 'object' && action.result !== null
              ? action.result
              : {}) as Bag;
            if (!session.completeToolCall) {
              no('This backend runs no tools on a client\'s behalf');
              break;
            }
            // `ToolCallResult.content` is MCP's content blocks; what reaches a
            // model through this host is text, so text is what is read out of
            // them. An error carries its message instead, which is the only
            // thing a failed call actually says.
            const ok = result.success !== false;
            const text = (Array.isArray(result.content) ? result.content : [])
              .map((block) => (typeof block === 'object' && block !== null ? block as Bag : {}))
              .filter((block) => typeof block.text === 'string')
              .map((block) => String(block.text))
              .join('\n');
            const wrong = typeof result.error === 'object' && result.error !== null
              ? String((result.error as Bag).message ?? '')
              : '';
            if (!session.completeToolCall(toolCallId, clientId, {
              text: ok ? text : (wrong || text || 'The tool failed'),
              ok,
            })) no(`${toolCallId} is not a call ${clientId} is running here`);
            break;
          }
          /*
           * Streaming into a call while it runs, which is a *contributor's* to
           * do.
           *
           * The protocol has the owning client dispatch this for a tool the
           * client itself provides - the call carries a `ToolCallContributor`
           * with that client's id, and a server should refuse anyone else.
           * Relayed rather than reduced: what a tool is printing as it runs is
           * the running client's to say, and this host holds none of it.
           */
          case 'chat/toolCallContentChanged': {
            const toolCallId = String(action.toolCallId ?? '');
            const clientId = connection.clientId || 'anonymous';
            const owner = session.toolCallOwner?.(toolCallId);
            if (owner === undefined) {
              no(`${toolCallId} is not a call a client is running here`);
              break;
            }
            if (owner !== clientId) {
              no(`${toolCallId} is ${owner}'s call, and its content is ${owner}'s to change`);
              break;
            }
            dispatch(session.chatUri, action);
            break;
          }
          default:
            no(`${type} is not served yet`);
        }
      };
      /** Notifications: no id, no answer, and that is the whole difference. */
      const notifications: Record<string, (params: Record<string, unknown>) => void> = {
        unsubscribe: (params) => {
          // This connection stops watching. Not the channel - doing that to
          // shed one consumer kills the stream the others are reading.
          const channel = String(params.channel ?? '');
          connection.watching.delete(channel);
          for (const [meant, alias] of connection.aliases) {
            if (alias === channel) connection.aliases.delete(meant);
          }
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
         * `applying` is held across the whole of `applyDispatch` and cleared
         * after, so every action the dispatch causes - including the ones
         * emitted from inside a session, several layers down - goes out
         * carrying the `clientSeq` the client sent. Nothing in there is
         * awaited, which is what makes that safe: no second dispatch can
         * begin while this one is being applied.
         */
        dispatchAction: (params) => {
          const origin: Origin = {
            clientId: connection.clientId || 'anonymous',
            clientSeq: typeof params.clientSeq === 'number' ? params.clientSeq : 0,
          };
          applying = origin;
          try { applyDispatch(params, origin); }
          finally { applying = undefined; }
        },
      };
      return {
        async handle(request) {
          const notify = notifications[request.method];
          if (notify) {
            // Dropped rather than refused: a notification carries no id, so
            // there is nowhere to say no, and a client that has not
            // introduced itself has no subscriptions to unsubscribe and no
            // `clientSeq` an echo could be matched against.
            if (!handshook) return undefined;
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
          // Everything before the handshake is `-32601`, which reads oddly
          // for a method this host plainly has and is what the protocol
          // leaves for it: there is no code for "not yet", and the reference
          // host answers exactly this. `ping` is the one exception the spec
          // states outright - the round trip is a liveness check, and a
          // liveness check that needs a handshake first cannot tell a
          // half-open socket from a busy one.
          if (!handshook && !GREETINGS.has(request.method)) {
            throw new RpcError(METHOD_NOT_FOUND, `This host does not serve ${request.method} before initialize`);
          }
          // And a second `initialize` is no longer one of them: the version
          // is agreed, and re-agreeing it would re-key every subscription
          // this connection is holding.
          if (handshook && request.method === 'initialize') {
            throw new RpcError(METHOD_NOT_FOUND, `${connection.clientId || 'This client'} has already initialized`);
          }
          /*
           * A URI another client published is that client's to answer.
           *
           * Before the handler, because the handler is this host's
           * filesystem and the resource is not on it. What goes back is
           * whatever the owning client said, verbatim - including its
           * refusal, which is the owner's to make.
           */
          /*
           * A channel the protocol fixes, named as something else.
           *
           * Twenty commands declare `channel` as a literal - `ahp-root://`
           * for most, `ahp-automations://` for the two automation ones -
           * because they are about the host rather than about any one
           * session. A host that answered them on whatever arrived would make
           * a client sending the wrong constant look correct, which is how a
           * client ships one: it typechecks, every test passes against the
           * lenient host, and the first conformant one refuses it with
           * nothing on screen saying why.
           *
           * Only when the client actually named one. A command sent without a
           * `channel` has named nothing wrong, and this host has always taken
           * those - refusing them now would be a rule applied backwards.
           */
          const fixed = DECLARED[request.method];
          const named = (request.params as { channel?: unknown } | undefined)?.channel;
          // The catalogue under any of its spellings is still the catalogue.
          if (fixed !== undefined && typeof named === 'string' && named !== '' && named !== fixed
            && !(fixed === AUTOMATIONS && isAutomations(named))) {
            throw new RpcError(-32602, `${request.method} is answered on ${fixed}, not on ${named}`);
          }
          if (REVERSE.has(request.method)) {
            const away = await elsewhere(request.method, request.params ?? {});
            if (away !== undefined) return away.result;
          }
          return handler(request.params);
        },
        close() {
          const was = [...connection.watching];
          connections.delete(connection);
          void fire('client_disconnect', { type: 'client_disconnect', client: connection.clientId || 'anonymous' });
          // The tokens went with the connection; so do their clocks.
          for (const resource of [...expiring.keys()]) forgetExpiry(resource);
          // And the watches it was keeping for other clients: the channel was
          // its to report on, and with it gone nothing ever will again.
          for (const [channel, away] of [...relayed]) {
            if (away.owner === connection) relayed.delete(channel);
          }
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
