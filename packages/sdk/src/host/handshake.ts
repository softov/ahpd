import { compareProtocolVersions, negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { RUN_HISTORY_LIMIT } from '../automations/automations.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { uriOf } from '../resources/fileuri.js';
import { bag, str } from '../utils/values.js';
import { BANG } from './common.js';
import type { Bag } from '../types/common.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * The ways in, and the credential a resource is lent under.
 *
 * `initialize` and `reconnect` are the two introductions and `ping` is how a
 * client tells a live socket from one an idle proxy has dropped.
 * `authenticate` is what lends a resource its token, expires it when the
 * client says how long it has, and takes it back.
 */
export interface Handshake {
  initialize: (params: Record<string, unknown>) => Promise<unknown>;
  ping: () => Promise<unknown>;
  reconnect: (params: Record<string, unknown>) => Promise<unknown>;
  authenticate: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * The version VS Code 1.141 offers, which reads the 1.0.0 wire.
 *
 * The package's caret rule matches a `0.x` offer only on the same minor, so
 * this one agrees with neither baseline. VS Code's own host answers it, and
 * lists it among the versions it speaks.
 */
const LEGACY_COMPATIBLE_VERSION = '0.10.0';

/** The longest `locale` kept: a BCP 47 tag past this is not one a client sends. */
const LOCALE_LIMIT = 35;

/** Every version the host speaks, highest first: the package's baselines and the 1.141 alias. */
const SPOKEN_VERSIONS = [...SUPPORTED_PROTOCOL_VERSIONS, LEGACY_COMPATIBLE_VERSION]
  .sort((a, b) => compareProtocolVersions(b, a));

/**
 * The one MCP server a token was aimed at: its session, under the name this
 * host holds it by, and the customization id the session publishes it under.
 */
interface Target {
  session: string;
  customizationId: string;
}

/**
 * The key a pushed token is kept under: its resource, and the server it was
 * aimed at when the client named one.
 *
 * The protocol keys a provider-level token by its resource and a targeted one
 * by its target as well, because two MCP servers can share a resource and
 * still be two consumers. So `tokensFor` and `lent`, which look a token up by
 * its resource, never find one aimed at a server.
 * https://github.com/microsoft/agent-host-protocol/blob/0b7b7f9f4ceb2fbd8846557416f765ac73da647d/docs/specification/authentication.md#L151-L153
 */
const keyOf = (resource: string, target?: Target): string => (target === undefined
  ? resource
  : JSON.stringify([resource, target.session, target.customizationId]));

/**
 * The MCP server a session publishes under an id, at the top level or as the
 * child of another customization: the two places the protocol says a target's
 * server is found, and where the reference host looks for one.
 * https://github.com/microsoft/agent-host-protocol/blob/0b7b7f9f4ceb2fbd8846557416f765ac73da647d/docs/specification/authentication.md#L143
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/shared/mcpCustomizationController.ts#L606-L620
 */
const mcpServerIn = (customizations: unknown[], id: string): Bag | undefined => {
  for (const one of customizations.map(bag)) {
    const servers = one.type === 'mcpServer' ? [one] : (Array.isArray(one.children) ? one.children.map(bag) : []);
    const found = servers.find((server) => server.type === 'mcpServer' && str(server.id) === id);
    if (found !== undefined) return found;
  }
  return undefined;
};

export function createHandshake(ctx: HostContext, conn: ConnectionContext): Handshake {
  const { connection } = conn;
  const {
    advertised, advertisedChannels, advertisedGrants, advertisedMethods, advertisedSchemes, agents, answeredAs, browsable, channelAwaiting,
    clientPluginsOf, dir, fire, flushDeltas, heldAs, holders, known, leadOf, leaves, locales, loginId, log, LOGS, METRICS, metaMoved,
    metadataFor, meantBy, openedBy, options, ownId, ownerFor, principals, refreshPullRequests, replayable, seenBy, sessions,
    snapshotOf, spellingOf, TRACES, watchedAs,
  } = ctx;

  /**
   * Keeps the locale this client sent, on the connection and by client id.
   *
   * A `locale` that is not a non-empty string of at most 35 characters is
   * read as none sent. On `initialize` the client then has no locale; on
   * `reconnect` it keeps the one it had.
   */
  const keepLocale = (locale: unknown, resuming: boolean): void => {
    if (typeof locale === 'string' && locale.length > 0 && locale.length <= LOCALE_LIMIT) {
      locales.set(connection.clientId, locale);
    } else if (!resuming) {
      locales.delete(connection.clientId);
    }
    const kept = locales.get(connection.clientId);
    if (kept === undefined) delete connection.locale;
    else connection.locale = kept;
  };

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
  const expire = (resource: string, target?: Target): void => {
    /*
     * The host's own resource holds no token to expire - what it leaves is
     * a principal - so it is the one case this path answers differently.
     * The notification is the same either way, because what a client has
     * to do about it is the same.
     */
    if (target === undefined && options.users !== undefined && resource === loginId()) {
      const until = connection.principalUntil;
      if (until === undefined) return;
      const left = until - Date.now();
      if (left > 0) {
        expiring.set(resource, setTimeout(() => expire(resource), Math.min(left, LONGEST)));
        expiring.get(resource)?.unref?.();
        return;
      }
      expiring.delete(resource);
      delete connection.principal;
      delete connection.principalUntil;
      log(`${connection.clientId || 'a client'}'s sign-in expired`);
      connection.peer.notify('auth/required', {
        channel: channelAwaiting(resource, connection),
        resource: metadataFor(resource),
        reason: 'expired',
      });
      return;
    }
    const key = keyOf(resource, target);
    const held = connection.tokens.get(key);
    if (held?.expiresAt === undefined) return;
    const left = held.expiresAt - Date.now();
    if (left > 0) {
      expiring.set(key, setTimeout(() => expire(resource, target), Math.min(left, LONGEST)));
      expiring.get(key)?.unref?.();
      return;
    }
    expiring.delete(key);
    connection.tokens.delete(key);
    log(`${connection.clientId || 'a client'}'s token for ${resource}${target === undefined ? '' : ` at ${target.customizationId}`} expired`);
    connection.peer.notify('auth/required', {
      // An MCP server's requirement is drawn on its session, and a token
      // aimed at one names that session itself, as this connection watches it.
      channel: target === undefined
        ? channelAwaiting(resource, connection)
        : watchedAs(connection, target.session) ?? target.session,
      resource: metadataFor(resource),
      reason: 'expired',
    });
  };
  /**
   * Stop watching a token's clock: it was replaced, revoked, or the client left.
   *
   * By the key the token is kept under, which is what `expiring` holds.
   */
  const forgetExpiry = (key: string): void => {
    const timer = expiring.get(key);
    if (timer !== undefined) clearTimeout(timer);
    expiring.delete(key);
  };
  /**
   * The MCP server a token's `target` names, or the refusal of it.
   *
   * A client that answers one server's sign-in names that server by the
   * session and the customization id this host published, and the protocol
   * has the host refuse a target it cannot find with `-32602`. A kind this
   * host does not know names a consumer it cannot confine the token to, so it
   * is refused the same way, as the reference host refuses it.
   *
   * The resource has to be the one that server waits for: the protocol says
   * so, and it is the resource this host advertised for it.
   * https://github.com/microsoft/agent-host-protocol/blob/0b7b7f9f4ceb2fbd8846557416f765ac73da647d/docs/specification/authentication.md#L143-L145
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L2033-L2048
   */
  const aimedAt = (named: unknown, resource: string): Target => {
    const target = bag(named);
    if (target.kind !== 'mcpServer') {
      throw new RpcError(INVALID_PARAMS, `A target of kind ${JSON.stringify(target.kind ?? null)} is not one this host knows`);
    }
    const asked = str(target.session) ?? '';
    const customizationId = str(target.customizationId) ?? '';
    // Under whatever spelling the client knows the session by.
    const session = heldAs(asked);
    const held = sessions.get(session);
    // A session this connection does not watch is not one its tokens are
    // spent on, whoever else holds it open.
    if (held !== undefined && watchedAs(connection, session) === undefined) {
      throw new RpcError(INVALID_PARAMS, `${asked} is not a session this connection watches`);
    }
    const lead = held === undefined ? undefined : leadOf(held);
    // Both halves of what the session publishes: what its backend reports,
    // and the plugins its clients handed it.
    const server = lead === undefined
      ? undefined
      : mcpServerIn([...lead.customizations(), ...clientPluginsOf(session)], customizationId);
    if (server === undefined) {
      throw new RpcError(INVALID_PARAMS, `${customizationId || 'That'} is not an MCP server of ${asked || 'a session this host holds'}`);
    }
    const state = bag(server.state);
    if (state.kind !== 'authRequired' || bag(state.resource).resource !== resource) {
      throw new RpcError(INVALID_PARAMS, `${customizationId} in ${asked} is not waiting for a token for ${resource || 'that resource'}`);
    }
    return { session, customizationId };
  };
  conn.tokensFor = tokensFor;
  conn.expiring = expiring;
  conn.forgetExpiry = forgetExpiry;

  return {
    /**
     * The handshake.
     *
     * Version negotiation is the highest version the client offered that
     * is compatible with one of `SUPPORTED_PROTOCOL_VERSIONS`, which is
     * what the specification asks for and what `negotiateProtocolVersion`
     * is for, or `0.10.0` when the client offered it and nothing above it
     * agreed. A host that answers with a version the client did not offer
     * has answered with a version the client cannot read.
     */
    initialize: async (params) => {
      const offered = Array.isArray(params.protocolVersions)
        ? params.protocolVersions as string[]
        : [];
      let agreed: string | undefined;
      try {
        agreed = negotiateProtocolVersion(offered);
      } catch (problem) {
        // An entry that is not a `MAJOR.MINOR.PATCH` string is malformed
        // rather than merely incompatible, and the package throws on one.
        // An uncaught throw is not a JSON-RPC error a client can read.
        throw new RpcError(INVALID_PARAMS, problem instanceof Error ? problem.message : String(problem));
      }
      // An offer that holds the alias gets it, unless the package agreed
      // on something above it.
      if (offered.includes(LEGACY_COMPATIBLE_VERSION)
        && (agreed === undefined || compareProtocolVersions(LEGACY_COMPATIBLE_VERSION, agreed) > 0)) {
        agreed = LEGACY_COMPATIBLE_VERSION;
      }
      if (!agreed) {
        // `supportedVersions`, which is the name the protocol gives this
        // field and the only reason the error is recoverable: it is what a
        // client reads to pick a version to retry with. Under any other
        // spelling, the one way out of a version mismatch reads
        // `undefined`.
        throw new RpcError(-32005, 'No protocol version in common', { supportedVersions: [...SPOKEN_VERSIONS] });
      }
      /*
       * Whether a container can be made here, asked before the answer
       * that says so.
       *
       * Once per handshake rather than once per host: the question costs
       * two version probes, the answer can change under a running daemon
       * - Docker started, the CLI installed - and a client that is told
       * no is a client that never offers the flow. A probe that throws is
       * a no, because it answered nothing.
       */
      const containersReady = options.containers === undefined
        ? false
        : await options.containers.available().catch(() => false);
      connection.clientId = typeof params.clientId === 'string' ? params.clientId : 'anonymous';
      /*
       * What this connection agreed to, kept for every later delivery: an
       * action introduced after this version is not sent to it, live or in a
       * replay. Read before the snapshots below, which are answered whole.
       */
      connection.protocolVersion = agreed;
      // Met, so a later `reconnect` under this id is answerable.
      known.add(connection.clientId);
      keepLocale(params.locale, false);
      void fire({ type: 'client_connect', client: connection.clientId });
      // Introduced. Said after the version is agreed, so a client this
      // host cannot speak to is not one it has shaken hands with.
      conn.handshook = true;
      const wanted = Array.isArray(params.initialSubscriptions)
        ? params.initialSubscriptions.filter((uri) => typeof uri === 'string')
        : [];
      /*
       * Text still in the window goes out before the first snapshot is read,
       * for the reason `subscribe` gives: the parts these snapshots are built
       * from already carry it, and the delta that wrote it would write it
       * again.
       */
      flushDeltas();
      const snapshots = [];
      for (const channel of wanted) {
        // A handshake that fails because one requested channel is gone is
        // a client that cannot connect at all. Take what can be taken.
        try {
          // Gated, resolved and answered the way `subscribe` is: the
          // root, a session or a chat under another spelling is told
          // under that spelling. Awaited only when the gate is waiting on
          // a scheme, so a handshake does not spend a turn of the loop on a
          // question it will not be asked.
          const held = conn.admit('subscribe', { channel });
          if (held !== undefined) await held;
          const snapshot = await snapshotOf(meantBy(channel), connection.config ?? {}, connection);
          const meant = answeredAs(connection, channel, snapshot);
          snapshots.push(snapshot);
          connection.watching.add(channel);
          openedBy(meant, connection.clientId);
        }
        catch { /* not subscribed, and the client will be told if it asks */ }
      }
      log(`${connection.clientId} connected, speaking ${agreed}`);
      return {
        protocolVersion: agreed,
        serverSeq: ctx.serverSeq,
        serverInfo: { name: 'ahpd', version: options.diagnostics?.version ?? '0.0.1' },
        snapshots,
        defaultDirectory: uriOf(dir),
        // What the client should ask about rather than send. A slash is a
        // skill or a prompt the host contributed; an at-sign and a hash are
        // both a file, which is how VS Code's own host answers the two.
        // Without this the client has no reason to believe any of them means
        // anything here, and types them into the chat as text.
        completionTriggerCharacters: ['/', '@', '#'],
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
         * resolution.
         *
         * `runCancellation` is served, so a client offers Stop on a run that
         * is `pending` or `running`. What it stops is the turn in each of the
         * run's sessions through the same call a stop in a chat makes, and
         * the session is kept - a run ends, and a session somebody may open
         * is not a thing a stop takes away.
         *
         * `runHistoryLimit` is how many runs an automation keeps, and the
         * store keeps exactly it: the newest ended runs up to the number, and
         * every run that has not ended, which is what a client reads a history
         * against when it decides to ask for an older page.
         *
         * `customizations` says a template may name client plugins and this
         * host will copy them, which needs the port that copies a client's
         * plugin at all. It is advertised only where there is one: a host with
         * nowhere to put a copy refuses a template naming any, and a client
         * told otherwise would be a client writing one that never runs.
         */
        ...(options.automations
          ? {
            automations: {
              create: {}, schedules: {}, runCancellation: {},
              runHistoryLimit: RUN_HISTORY_LIMIT,
              ...(options.clientPlugins ? { customizations: {} } : {}),
            },
          }
          : {}),
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
        _meta: {
          'vscode.removeSessionArtifact': true,
          'vscode.detachedWorktrees': true,
          'vscode.getAgentHostSessionStateFile.chat': true,
          // A run of this host's automations needs no client connected. The
          // reference client offers a host's automations only where it says
          // so, so it goes with the `automations` capability above.
          ...(options.automations ? { 'vscode.autonomousAutomations': true } : {}),
          /*
           * This host's session URIs are the AHP ones, and not the legacy
           * `provider:/id` spelling.
           *
           * VS Code keeps the legacy form for a host it decided is native, and
           * a native host is one whose root `_meta` carries `hostBuild`. This
           * host sends that key for the version line in the Output channel, so
           * this is what keeps every session URI it hands out. The two are one
           * change - decision `ahpd-says-it-is-a-native-host`.
           */
          'vscode.ahpSessionUris': true,
          // The dev container surface. A client reads this before it
          // offers the flow, so it is true only where a container can
          // actually be made: a host with the launcher loaded and no
          // Docker, or no Dev Container CLI, omits it and is never asked -
          // decision `a-dev-container-is-reached-by-docker-exec`.
          ...(containersReady ? { 'vscode.devContainers': true } : {}),
          // What this host serves beside `file:`, so a client can draw a
          // screen for a scheme before it has a URI to ask.
          ...(advertisedSchemes() === undefined ? {} : { 'ahpd.resourceProviders': advertisedSchemes() }),
          // The channels plugins serve, so a client can offer one before it
          // has a URI to subscribe to.
          ...(advertisedChannels() === undefined ? {} : { 'ahpd.channels': advertisedChannels() }),
          // The `x-` commands the daemon and plugins serve, so a client
          // can offer one before it sends it.
          ...(advertisedMethods() === undefined ? {} : { 'ahpd.methods': advertisedMethods() }),
          // Every subject a grant may name, and what it may be granted, so a
          // client can draw the operation list for a role it is about to ask
          // somebody to confirm. Always here: it says what a role could hold,
          // not what anybody holds.
          'ahpd.grants': advertisedGrants(),
          // Who this connection is, so a client can read that person's own
          // `user://<id>` and needs no grant to do it. Absent where the
          // connection is nobody, which is every host with no users
          // directory.
          ...(ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ownerFor(connection) }),
        },
      };
    },
    ping: async () => null,
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
      /*
       * Under a users directory, a person signed in resumes only an id
       * that is theirs or nobody's, and is answered `-32008` otherwise,
       * so their client falls back to a fresh `initialize`. A connection
       * nobody has signed in on resumes any id it names: what it may not
       * read is `missing`, and `claimsId` gives it no claim on an id
       * somebody holds until that person signs in on it.
       */
      const holder = holders.get(clientId);
      if (options.users !== undefined && connection.root !== true && connection.principal !== undefined
        && holder !== undefined && holder !== connection.principal.id) {
        throw new RpcError(-32008, `${clientId || 'That client'} is not a client this connection may resume`);
      }
      // A person signed in resuming an id nobody holds holds it from now.
      if (options.users !== undefined && connection.principal !== undefined && holder === undefined && ownId(clientId)) {
        holders.set(clientId, connection.principal.id);
      }
      connection.clientId = clientId;
      // An ahpd extension: `reconnect` takes `locale` as `initialize` does,
      // and a client that sends none keeps the one it had.
      keepLocale(params.locale, true);
      void fire({ type: 'client_connect', client: connection.clientId });
      // The other way in. A client that dropped resumes with this rather
      // than a fresh `initialize`, and it is as much an introduction.
      conn.handshook = true;
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

      /*
       * Text still in the window goes out first, as it does for `subscribe`.
       *
       * This client was watching before it dropped, so what is flushed here
       * is replayed to it below rather than read out of a snapshot - and a
       * delta replayed after the snapshot that already holds its words is the
       * same word twice.
       */
      flushDeltas();
      const missing: string[] = [];
      /** Each channel resumed, by the name this host dispatches under, with the name the client used. */
      const resumed = new Map<string, string>();
      for (const channel of wanted) {
        try {
          // Resolved the way `subscribe` resolves it, so a client coming
          // back under its own spelling of a chat, a session, or the
          // automations catalogue is resumed rather than told the channel
          // has gone - and is replayed, which is keyed by the name this
          // host dispatches under rather than the one the client used.
          const held = conn.admit('subscribe', { channel });
          if (held !== undefined) await held;
          const meant = meantBy(channel);
          await snapshotOf(meant, connection.config ?? {}, connection);
          if (meant !== channel) connection.aliases.set(meant, channel);
          connection.watching.add(channel);
          openedBy(meant, connection.clientId);
          resumed.set(meant, channel);
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
      const replayable_ = since <= ctx.serverSeq && (oldest === undefined || since >= oldest - 1);
      if (replayable_) {
        log(`${clientId} came back at ${since}, replaying`);
        return {
          type: 'replay',
          actions: replayable.flatMap((held) => {
            const alias = resumed.get(held.channel);
            if (held.serverSeq <= since || alias === undefined) return [];
            const envelope = seenBy(connection, held);
            if (envelope === undefined) return [];
            // A session's actions under the name this connection uses for
            // it, as they went out live; any other channel, the
            // automations catalogue among them, under the held name.
            return [spellingOf(connection, held.channel) === undefined ? envelope : { ...envelope, channel: alias }];
          }),
          missing,
        };
      }
      log(`${clientId} came back at ${since}, too far behind ${oldest} - snapshotting`);
      const snapshots = [];
      for (const channel of resumed.values()) {
        const snapshot = await snapshotOf(meantBy(channel), connection.config ?? {}, connection);
        answeredAs(connection, channel, snapshot);
        snapshots.push(snapshot);
      }
      return { type: 'snapshot', snapshots };
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
       * The one MCP server the client aimed the token at, when it named one.
       *
       * Read from the request as it arrives: the protocol added `target`
       * after the 1.0.0 package this host is typed over, and says it needs
       * no version of its own. A token aimed at a server is that server's
       * alone, so nothing below treats it as the host's sign-in or as a
       * backend's own credential.
       */
      const target = params.target === undefined ? undefined : aimedAt(params.target, resource);
      /*
       * A backend's own resource, or one of its MCP servers'.
       *
       * The second kind is advertised on a server's `authRequired` state
       * rather than on the agent, and is just as much a resource this host
       * named - the protocol's rule is that a client's `resource` matches
       * one the server advertised, and both of these are. A target has
       * already named its server, and its session's chats are the ones told.
       *
       * Only the sessions this connection watches: a token is spent on the
       * sessions its client asks for and nowhere else, and these are the
       * ones it was asked to sign in for.
       */
      const waiting = (target === undefined
        ? [...sessions].filter(([uri]) => watchedAs(connection, uri) !== undefined).flatMap(([, held]) => [...held.chats.values()])
        : [...(sessions.get(target.session)?.chats.values() ?? [])])
        .filter((chat) => chat.awaiting?.().includes(resource) === true);
      if (target === undefined && waiting.length === 0 && !advertised().has(resource)) {
        throw new RpcError(INVALID_PARAMS, `${resource || 'That'} is not a resource this host advertises`);
      }
      const key = keyOf(resource, target);
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
       *
       * With a target, the token kept for that server is the one that goes:
       * the protocol limits a revocation to its target.
       */
      if (token === '') {
        const had = connection.tokens.delete(key);
        forgetExpiry(key);
        const signedOut = target === undefined && options.users !== undefined && resource === loginId()
          && connection.principal !== undefined && connection.root !== true;
        if (signedOut) {
          delete connection.principal;
          delete connection.principalUntil;
        }
        const at = target === undefined ? '' : ` at ${target.customizationId} in ${target.session}`;
        log(`${connection.clientId || 'a client'} ${had ? 'revoked' : 'had no'} token for ${resource}${at}${signedOut ? ' and signed out' : ''}`);
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
        throw new RpcError(INVALID_PARAMS, 'expiresIn must be a positive integer of seconds');
      }
      /*
       * The deployment's own key needs no credential.
       *
       * A socket on it is already the host, so signing in here could only
       * demote it and signing out could only lose the key. Answered as accepted and otherwise
       * ignored, because the client asked for something that is already so.
       */
      if (target === undefined && connection.root === true && options.users !== undefined && resource === loginId()) return {};
      /*
       * The host's own resource: the one credential here that is checked.
       *
       * Every other token is a backend's or an MCP server's, held
       * unverified and spent elsewhere, which is what the block below
       * still does. This one is a person, and the directory is the only
       * thing that can say whether the token belongs to one.
       */
      if (target === undefined && options.users !== undefined && resource === loginId()) {
        const held = await options.users.verify(token);
        if (held === undefined) {
          throw new RpcError(-32007, 'That credential is not one this host knows', {
            resources: [options.users.resource],
          });
        }
        /*
         * A local token where the record requires the issuer.
         *
         * It opens the socket and names nobody, so it is not a credential for
         * signing in: the issuer's token is the one that says who they are.
         */
        if (held.trusted === false) {
          throw new RpcError(-32007, 'Sign in through your issuer', {
            resources: [options.users.resource],
          });
        }
        // The clock this replaces, stopped before a second one is armed:
        // signing in again is the same thing to this resource that a
        // replaced token is to any other, and the path below forgets that
        // one for the same reason.
        /*
         * A client id is the first person's who signed in under it, and
         * nobody else signs in under it: the id is who a published
         * resource is routed to. `InitializeResult` carries no client id,
         * so the connection cannot be handed another one.
         */
        const holder = holders.get(connection.clientId);
        if (holder !== undefined && holder !== held.id) {
          throw new RpcError(-32003, `${connection.clientId} is another person's client id here; connect under one of your own`);
        }
        forgetExpiry(resource);
        connection.principal = held;
        principals.set(`user:${held.id}`, held);
        if (ownId(connection.clientId)) holders.set(connection.clientId, held.id);
        /*
         * When the sign-in ends, which is the earlier of two clocks.
         *
         * The client says how long it means to stay, and the credential says
         * how long it is good for - a token this host checked itself carries
         * its issuer's `exp`, and one past that is a credential the issuer
         * would refuse. A connection left open on one would be a person this
         * host still believes and the issuer no longer does, so the earlier of
         * the two is when they stop being signed in. Neither is always there:
         * a client that says nothing and a token with no expiry leave the
         * other to decide, and neither leaves the connection unending.
         */
        const said = expiresIn === undefined ? undefined : Date.now() + expiresIn * 1000;
        const until = said === undefined
          ? held.expiresAt
          : held.expiresAt === undefined ? said : Math.min(said, held.expiresAt);
        if (until === undefined) delete connection.principalUntil;
        else {
          connection.principalUntil = until;
          expire(resource);
        }
        // A person's id rather than the clientId, which is the thing about
        // this connection that was actually checked.
        void fire({ type: 'authenticated', client: held.id, resource });
        // The credential's end is named when it is the shorter one, so a log
        // that says how long the client asked for does not read as how long
        // the sign-in lasts.
        const short = until !== undefined && (said === undefined || until < said) ? ', no longer than its credential' : '';
        log(`${held.id} signed in${expiresIn !== undefined ? `, for ${expiresIn}s` : ''}${short}`);
        return {};
      }
      /*
       * Applied where it belongs, rather than only remembered.
       *
       * A token for an MCP server is that server's `Authorization` header
       * and nothing else's; a token for a backend is a credential its next
       * session starts with. The first takes effect now, on the sessions
       * that were waiting for it, and a targeted one names its server to
       * each chat so no server beside it takes the token.
       */
      for (const chat of waiting) void chat.authenticated?.(resource, token, target?.customizationId);
      forgetExpiry(key);
      connection.tokens.set(key, {
        token,
        ...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
      });
      void fire({ type: 'authenticated', client: connection.clientId || 'anonymous', resource });
      if (expiresIn !== undefined) expire(resource, target);
      const at = target === undefined ? '' : ` at ${target.customizationId} in ${target.session}`;
      log(`${connection.clientId || 'a client'} authenticated for ${resource}${at}${expiresIn !== undefined ? `, for ${expiresIn}s` : ''}`);
      // A GitHub token is a reason to ask GitHub again: a lookup that
      // answered nothing as nobody may answer as this person. One aimed at
      // a server is not a token those lookups are ever given.
      if (target === undefined && resource === String(options.github?.resource.resource ?? '')) {
        for (const dir of browsable()) {
          void refreshPullRequests(dir).then((moved) => { if (moved) metaMoved(dir); }).catch(() => {});
        }
      }
      return {};
    },
  };
}
