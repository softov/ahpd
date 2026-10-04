import { negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { RpcError } from '../rpc.js';
import { BANG } from './common.js';
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

export function createHandshake(ctx: HostContext, conn: ConnectionContext): Handshake {
  const { connection } = conn;
  const {
    advertised, advertisedGrants, advertisedSchemes, agents, answeredAs, browsable, channelAwaiting, dir, fire,
    holders, known, leaves, loginId, log, LOGS, METRICS, metaMoved, metadataFor, meantBy,
    options, ownId, ownerFor, principals, refreshPullRequests, replayable, seenBy, sessions,
    snapshotOf, spellingOf, TRACES,
  } = ctx;

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
    /*
     * The host's own resource holds no token to expire - what it leaves is
     * a principal - so it is the one case this path answers differently.
     * The notification is the same either way, because what a client has
     * to do about it is the same.
     */
    if (options.users !== undefined && resource === loginId()) {
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
        channel: channelAwaiting(resource),
        resource: metadataFor(resource),
        reason: 'expired',
      });
      return;
    }
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
     * is for. A host that answers with a version the client did not offer
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
        throw new RpcError(-32602, problem instanceof Error ? problem.message : String(problem));
      }
      if (!agreed) {
        // `supportedVersions`, which is the name the protocol gives this
        // field and the only reason the error is recoverable: it is what a
        // client reads to pick a version to retry with. Under any other
        // spelling, the one way out of a version mismatch reads
        // `undefined`.
        throw new RpcError(-32005, 'No protocol version in common', { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
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
      // Met, so a later `reconnect` under this id is answerable.
      known.add(connection.clientId);
      void fire({ type: 'client_connect', client: connection.clientId });
      // Introduced. Said after the version is agreed, so a client this
      // host cannot speak to is not one it has shaken hands with.
      conn.handshook = true;
      const wanted = Array.isArray(params.initialSubscriptions)
        ? params.initialSubscriptions.filter((uri) => typeof uri === 'string')
        : [];
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
          answeredAs(connection, channel, snapshot);
          snapshots.push(snapshot);
          connection.watching.add(channel);
        }
        catch { /* not subscribed, and the client will be told if it asks */ }
      }
      log(`${connection.clientId} connected, speaking ${agreed}`);
      return {
        protocolVersion: agreed,
        serverSeq: ctx.serverSeq,
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
        _meta: {
          'vscode.removeSessionArtifact': true,
          'vscode.detachedWorktrees': true,
          'vscode.getAgentHostSessionStateFile.chat': true,
          // The dev container surface. A client reads this before it
          // offers the flow, so it is true only where a container can
          // actually be made: a host with the launcher loaded and no
          // Docker, or no Dev Container CLI, omits it and is never asked -
          // decision `a-dev-container-is-made-by-the-dev-container-cli`.
          ...(containersReady ? { 'vscode.devContainers': true } : {}),
          // What this host serves beside `file:`, so a client can draw a
          // screen for a scheme before it has a URI to ask.
          ...(advertisedSchemes() === undefined ? {} : { 'ahpd.resourceProviders': advertisedSchemes() }),
          // Every subject a grant may name, and what it may be granted, so a
          // client can draw the operation list for a role it is about to ask
          // somebody to confirm. Always here: it says what a role could hold,
          // not what anybody holds - decision
          // `a-grant-names-an-operation-and-read-and-write-are-its-groups`.
          'ahpd.grants': advertisedGrants(),
          // Who this connection is, so a client can read that person's own
          // `user://<id>` and needs no grant to do it. Absent where the
          // connection is nobody, which is every host with no users
          // directory - decision
          // `a-connection-is-told-who-it-is-on-initialize-and-in-root-state`.
          ...(ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ownerFor(connection) }),
        },
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
        const signedOut = options.users !== undefined && resource === loginId()
          && connection.principal !== undefined && connection.root !== true;
        if (signedOut) {
          delete connection.principal;
          delete connection.principalUntil;
        }
        log(`${connection.clientId || 'a client'} ${had ? 'revoked' : 'had no'} token for ${resource}${signedOut ? ' and signed out' : ''}`);
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
       * The deployment's own key needs no credential.
       *
       * A socket on it is already the host, so signing in here could only
       * demote it and signing out could only lose the key - decision
       * `the-door-token-is-the-host`. Answered as accepted and otherwise
       * ignored, because the client asked for something that is already so.
       */
      if (connection.root === true && options.users !== undefined && resource === loginId()) return {};
      /*
       * The host's own resource: the one credential here that is checked.
       *
       * Every other token is a backend's or an MCP server's, held
       * unverified and spent elsewhere, which is what the block below
       * still does. This one is a person, and the directory is the only
       * thing that can say whether the token belongs to one.
       */
      if (options.users !== undefined && resource === loginId()) {
        const held = await options.users.verify(token);
        if (held === undefined) {
          throw new RpcError(-32007, 'That credential is not one this host knows', {
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
        if (expiresIn !== undefined) {
          connection.principalUntil = Date.now() + expiresIn * 1000;
          expire(resource);
        }
        else delete connection.principalUntil;
        // A person's id rather than the clientId, which is the thing about
        // this connection that was actually checked.
        void fire({ type: 'authenticated', client: held.id, resource });
        log(`${held.id} signed in${expiresIn !== undefined ? `, for ${expiresIn}s` : ''}`);
        return {};
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
      void fire({ type: 'authenticated', client: connection.clientId || 'anonymous', resource });
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
  };
}
