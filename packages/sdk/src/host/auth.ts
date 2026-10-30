import { ROOT } from './channels.js';
import { hostAgent, mayUseAgent, ownershipOf } from '../agents/usable.js';
import type { Agent } from '../types/agent.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/** What a person has to sign into, and what they have. */
export interface Auth {
  loginId(): string;
  resourcesOf(agent: Agent): Bag[];
  agentsFor(connection: Connection, list: unknown): unknown;
  lent(resource: string): string | undefined;
  advertised(): Set<string>;
  metadataFor(resource: string): Bag;
  channelAwaiting(resource: string, connection: Connection): string;
  watchedAs(connection: Connection, session: string): string | undefined;
  asking(channel: string, action: Record<string, unknown>): void;
}

export function createAuth(ctx: HostContext): Auth {
  const { options, agents, connections, sessions } = ctx;

  /**
   * The name a connection watches a session under, or nothing when it does
   * not watch it.
   *
   * Any spelling of the session counts, as it does for whether a client has
   * left one, and the answer is the client's own spelling, which is the name
   * it is told about the session under. These are the sessions a connection
   * asks for: the ones it is asked to sign into, and the only ones its tokens
   * are spent on.
   */
  const watchedAs = (connection: Connection, session: string): string | undefined =>
    [...connection.watching].find((channel) => ctx.heldAs(channel) === session);

  /**
   * The resource a sign-in requirement is said as the protocol's own
   * notification.
   *
   * `auth/required` is connection-level rather than a state action: a client
   * reads it and pushes a token back with `authenticate`. Sent off the same
   * state change that carries the requirement - an MCP server saying
   * `authRequired` - so there is one source for the fact and no second thing
   * to keep in step.
   *
   * Only to connections watching that session, because that is the channel
   * the notification names and the only place the requirement is visible,
   * each under the name it watches the session by.
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
      const watched = watchedAs(connection, channel);
      if (watched !== undefined) {
        connection.peer.notify('auth/required', { channel: watched, resource, reason: 'required' });
      }
    }
  };

  const loginId = (): string => String(options.users?.resource.resource ?? '');
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
    // The host's own sign-in resource, listed here for the same reason GitHub's
    // is: it is the host's, whichever backend the session runs on.
    ...(options.users ? [options.users.resource as Bag] : []),
  ];
  /**
   * The agent list as one connection is told it.
   *
   * Two rewrites, and both are about one connection. The host's sign-in
   * resource is advertised on every backend with `required: true`, because
   * every command but the handshake and `authenticate` is refused until
   * somebody signs in - and a client reads that field to decide whether to
   * prompt before it ever sends a command. For a connection this host already
   * treats as somebody, root or carrying a principal, the prompt would be for
   * a token nothing needs, and a client that insists on it never creates a
   * session at all. So that one resource is rewritten for that one connection,
   * and a backend's own resources and GitHub's are listed as they are.
   *
   * And the list holds only the agents this caller may use, decided by
   * `mayUseAgent` from the owner its record names. An agent left out is not
   * one this connection is told exists, which is why this is a filter and not
   * a field it cannot use.
   *
   * A copy rather than an edit, because `options.users.resource` is the
   * directory's own record and `descriptors()` is rebuilt from it for every
   * delivery. Never called on the canonical list: the replay buffer and
   * `descriptors()` keep `required: true`, and the rewrite happens where an
   * envelope or a snapshot is handed to one connection.
   */
  const agentsFor = (connection: Connection, list: unknown): unknown => {
    if (options.users === undefined) return list;
    if (!Array.isArray(list)) return list;
    const id = loginId();
    const owners = options.agentOwners;
    /*
     * Who this connection already is: root, or somebody signed in. Only such a
     * connection is told the host's sign-in is not required, because only it
     * has a credential nothing else needs.
     */
    const somebody = connection.root === true || connection.principal !== undefined;
    return list.flatMap((agent) => {
      if (typeof agent !== 'object' || agent === null) return [agent];
      const held = agent as Bag;
      /*
       * Whose the agent is, read from its record. An id the records do not
       * hold is the daemon's own or a plugin's, and takes the host rule.
       */
      const provider = held.provider;
      const owned = typeof provider === 'string' ? ownershipOf(owners?.(), provider) : hostAgent;
      if (!mayUseAgent(connection.principal, owned, { root: connection.root === true, hasDirectory: true })) return [];
      if (!somebody || !Array.isArray(held.protectedResources)) return [agent];
      const mine = held.protectedResources.some((one) => typeof one === 'object' && one !== null && (one as Bag).resource === id);
      if (!mine) return [agent];
      return [{
        ...held,
        protectedResources: held.protectedResources.map((one) => (typeof one === 'object' && one !== null && (one as Bag).resource === id
          ? { ...(one as Bag), required: false }
          : one)),
      }];
    });
  };
  /** A token any connected client lent for a resource, and has not run out. */
  const lent = (resource: string): string | undefined => {
    // A person's sign-in is not a credential the host spends on its own work:
    // one client's sign-in must not become another client's session.
    if (options.users !== undefined && resource === loginId()) return undefined;
    for (const connection of connections) {
      const held = connection.tokens.get(resource);
      if (held !== undefined && !(held.expiresAt !== undefined && held.expiresAt <= Date.now())) return held.token;
    }
    return undefined;
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
   * Where a requirement for that resource is visible, to one connection.
   *
   * A backend's own resource is the root's business; an MCP server's is the
   * session that server belongs to, which is where its `authRequired` state
   * is drawn. Only a session the connection watches is one it can see that
   * state on, and it is named the way the connection watches it.
   */
  const channelAwaiting = (resource: string, connection: Connection): string => {
    for (const [uri, held] of sessions) {
      const watched = watchedAs(connection, uri);
      if (watched === undefined) continue;
      for (const chat of held.chats.values()) {
        if (chat.awaiting?.().includes(resource) === true) return watched;
      }
    }
    return ROOT;
  };

  return { loginId, resourcesOf, agentsFor, lent, advertised, metadataFor, channelAwaiting, watchedAs, asking };
}