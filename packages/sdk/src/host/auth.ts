import { ROOT } from './channels.js';
import { hostAgent, mayUseAgent, ownershipOf } from '../agents/usable.js';
import type { Agent } from '../types/agent.js';
import type { Connection, Credential } from '../types/host.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/**
 * The scopes a client says a token grants, as VS Code's host keeps them: each
 * once and sorted, and none for anything that is not a list of them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostCredentials.ts#L48-L50
 */
export const normalizeScopes = (scopes: unknown): string[] => (Array.isArray(scopes)
  ? [...new Set(scopes.filter((one): one is string => typeof one === 'string'))].sort()
  : []);

/**
 * The key a pushed token is kept under: its resource and its scopes, and the
 * server it was aimed at when the client named one, as VS Code's host keys a
 * stored token.
 *
 * Two MCP servers can share a resource and still be two consumers, so a
 * targeted token is kept apart from a provider-level one, and a lookup by a
 * resource never finds one aimed at a server.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAuthenticationService.ts#L498-L501
 */
export const keyOf = (resource: string, scopes: readonly string[], target?: { session: string; customizationId: string }): string =>
  (target === undefined
    ? `${resource}\u0000${scopes.join('\u0000')}`
    : JSON.stringify([resource, scopes, target.session, target.customizationId]));

/**
 * The token one client pushed for a resource and the scopes asked for, as VS
 * Code's host picks one: the token pushed for exactly those scopes; with
 * scopes asked for, the provider-level token with the fewest scopes covering
 * them; and the one pushed with no scopes. One past its expiry is none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAuthenticationService.ts#L456-L486
 */
export const storedAuthToken = (tokens: ReadonlyMap<string, Credential>, resource: string, scopes: readonly string[]): Credential | undefined => {
  const live = (held: Credential | undefined): Credential | undefined =>
    (held !== undefined && !(held.expiresAt !== undefined && held.expiresAt <= Date.now()) ? held : undefined);
  const asked = normalizeScopes(scopes);
  const exact = live(tokens.get(keyOf(resource, asked)));
  if (exact !== undefined || asked.length === 0) return exact;
  const covering = [...tokens.values()]
    .filter((one) => one.target === undefined && one.resource === resource && one.scopes.length > 0 && live(one) !== undefined
      && asked.every((scope) => one.scopes.includes(scope)))
    .sort((a, b) => a.scopes.length - b.scopes.length)[0];
  return covering ?? live(tokens.get(keyOf(resource, [])));
};

/** What a person has to sign into, and what they have. */
export interface Auth {
  /** The resource a client authenticates for the host's own sign-in. */
  authenticationResource(): string;
  resourcesOf(agent: Agent): Bag[];
  agentsFor(connection: Connection, list: unknown): unknown;
  /** A token any connected client authenticated for a resource and the scopes asked for, unexpired, for the host's own work. */
  getAuthToken(resource: string, scopes?: readonly string[]): string | undefined;
  advertised(): Set<string>;
  metadataFor(resource: string): Bag;
  channelAwaiting(resource: string, connection: Connection): string;
  watchedAs(connection: Connection, session: string): string | undefined;
}

export function createAuth(ctx: HostContext): Auth {
  const { options, agents, connections, sessions } = ctx;

  /**
   * The session's URI when a connection watches it, or nothing when it does
   * not.
   *
   * A session is watched under the one URI it is held by. These are the
   * sessions a connection signs into an MCP server for, reading the server's
   * `authRequired` state, as a VS Code window reads it and VS Code's host says
   * nothing more, and the only ones its tokens are spent on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L729-L736
   */
  const watchedAs = (connection: Connection, session: string): string | undefined =>
    (connection.watching.has(session) ? session : undefined);

  /*
   * The users directory's protected resource, the one a client authenticates
   * for the host's own sign-in, as VS Code's host names the resource a relay
   * client authenticates.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2634-L2640
   */
  const authenticationResource = (): string => String(options.users?.resource.resource ?? '');
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
  /**
   * The agent list as one connection is told it: every agent, and one this
   * caller may not use, decided by `mayUseAgent` from the owner its record
   * names, listed with no models, as VS Code's host lists a provider it does
   * not advertise to a client.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3288-L3291
   *
   * The host's own sign-in is on no agent: its requirement is said in the
   * `-32007` refusal's data, as VS Code's host says its host-level sign-in,
   * since a VS Code client asks for a token for each resource an agent lists.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2634-L2642
   */
  const agentsFor = (connection: Connection, list: unknown): unknown => {
    if (options.users === undefined) return list;
    if (!Array.isArray(list)) return list;
    const owners = options.agentOwners;
    return list.map((agent) => {
      if (typeof agent !== 'object' || agent === null) return agent;
      /*
       * Whose the agent is, read from its record. An id the records do not
       * hold is the daemon's own or a plugin's, and takes the host rule.
       */
      const provider = (agent as Bag).provider;
      const owned = typeof provider === 'string' ? ownershipOf(owners?.(), provider) : hostAgent;
      return mayUseAgent(connection.principal, owned, { root: connection.root === true, hasDirectory: true })
        ? agent
        : { ...agent as Bag, models: [] };
    });
  };
  /**
   * A token any connected client authenticated for a resource and the scopes
   * asked for, picked as `storedAuthToken` picks one and skipping one that has
   * run out, for the host's own work, as VS Code's host reads a token from the
   * host-wide store any client authenticated into.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAuthenticationService.ts#L267-L273
   */
  const getAuthToken = (resource: string, scopes: readonly string[] = []): string | undefined => {
    // A person's sign-in is not a credential the host spends on its own work:
    // one client's sign-in must not become another client's session.
    if (options.users !== undefined && resource === authenticationResource()) return undefined;
    for (const connection of connections) {
      const held = storedAuthToken(connection.tokens, resource, scopes);
      if (held !== undefined) return held.token;
    }
    return undefined;
  };

  /** Every resource identifier any agent here advertised, and the host's own sign-in, which its refusals name. */
  const advertised = (): Set<string> => {
    const out = new Set<string>();
    for (const agent of agents.values()) {
      for (const one of resourcesOf(agent)) {
        const id = (one as { resource?: unknown }).resource;
        if (typeof id === 'string') out.add(id);
      }
    }
    if (options.users !== undefined) out.add(authenticationResource());
    return out;
  };
  /**
   * The whole RFC 9728 record for a resource, as a backend advertised it.
   *
   * `auth/required` carries the record rather than the identifier, so a
   * client knows where to go and sign in. One no agent lists - the host's own
   * sign-in, or an MCP server's, named on a session's own state - is answered
   * with the identifier alone, which is the record's one required field, as
   * VS Code's host says its own identity's expiry.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/missionControl/missionControlProtocolServer.ts#L217
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
   * state on.
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

  return { authenticationResource, resourcesOf, agentsFor, getAuthToken, advertised, metadataFor, channelAwaiting, watchedAs };
}