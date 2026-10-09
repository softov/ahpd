import { seesConfig, PER_CONNECTION } from './gate.js';
import { OPERATIONS, operationsOf } from '../users.js';
import { vscodeRootProperties } from '../vscoderootconfig.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';
import type { ResourceProvider } from '../types/resources.js';

/*
 * The provider's method names, and the words a grant is made of.
 *
 * The order lists what a scheme does and the lookup says how: a provider
 * implements `read`, `write` and `remove` and a role grants `get`, `put`
 * and `delete`, so the advertised word is the one a client can put in a
 * `role://` body and have it mean the method the host will call. They were
 * `read` and `write` before, which named a group rather than an act, and
 * a client that wrote `policy:read` into a role was naming a group the gate
 * never asked for - decision
 * `a-grant-names-an-operation-and-read-and-write-are-its-groups`.
 */
const ORDER = ['get', 'list', 'resolve', 'put', 'delete', 'mkdir', 'move', 'copy'] as const;

const METHOD_OF: Record<typeof ORDER[number], string> = {
  get: 'read',
  list: 'list',
  resolve: 'resolve',
  put: 'write',
  delete: 'remove',
  mkdir: 'mkdir',
  move: 'move',
  copy: 'copy',
};

/**
 * What one provider can be granted, read off the methods it implements.
 *
 * The one place a scheme's operations are worked out, which is what keeps
 * `ahpd.resourceProviders` and the scheme's entry in `ahpd.grants` from being
 * two lists that drift: a client that offers what the first says can put in a
 * role and the gate answers from the second.
 */
const schemeOperations = (provider: ResourceProvider): string[] => {
  const held = provider as unknown as Record<string, unknown>;
  return ORDER.filter((one) => typeof held[METHOD_OF[one]] === 'function');
};

/** What the root channel advertises, and the config a client pushes to it. */
export interface Root {
  rootConfig: Record<string, unknown>;
  descriptors(): Bag[];
  daemonSchema(): Record<string, unknown>;
  daemonProperties(): Record<string, unknown>;
  daemonKey(key: string): boolean;
  declaresConfigKey(key: string): boolean;
  advertisedSchemes(): Record<string, unknown> | undefined;
  advertisedGrants(): Record<string, unknown>;
  rootState(mine?: Record<string, unknown>, connection?: Connection): Promise<Bag>;
}

export function createRoot(ctx: HostContext): Root {
  const { options, agents, sessions, terminals } = ctx;

  /**
   * Every backend, as the root channel advertises them.
   *
   * `models` is what its probe found, or empty for one that has not answered
   * yet - which is the same real answer a host gives for a harness nobody has
   * signed into.
   */
  const descriptors = (): Bag[] => [...agents.values()].map((agent) => ({
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
    models: ctx.about(agent.provider).models.map((model) => ({ ...model, provider: agent.provider })),
    /*
     * What a client may send a token for.
     *
     * The protocol says `authenticate`'s `resource` MUST match one the server
     * has itself advertised, so this list is not decoration - it is the whole
     * door. A host advertising none can be handed no credential at all, which
     * is what this one used to be.
     */
    ...(ctx.resourcesOf(agent).length > 0
      ? { protectedResources: ctx.resourcesOf(agent) }
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
    ...(ctx.about(agent.provider).seeds.length > 0
      ? { customizations: ctx.about(agent.provider).seeds }
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
   * Host-wide configuration, which a connected client pushes.
   *
   * Not this host's own settings - those are argv and `config.json`, and a
   * client has no business in them. These are the preferences a *client* holds
   * about how the host should behave for it: VS Code sends `defaultShell` out
   * of `terminal.integrated.agentHostProfile.<os>` the moment it connects,
   * because which shell a host-managed terminal opens is a preference of the
   * person's rather than a fact about the machine.
   *
   * Everything pushed whose key is declared below is kept, and only what the
   * host's own half of that schema names is acted on. Keeping a declared key
   * this host does not act on is not indulgence: `values` is state a client
   * reads back, and a host that dropped a key it merely drew would report a
   * setting that silently reverted.
   *
   * A key nobody declares is a different thing and is refused rather than
   * kept: a value with no property is one no client can draw or explain, and
   * the refusal is said in the words of the key, so the next UPSTREAM.md pass
   * finds what a newer VS Code added.
   */
  const rootConfig: Record<string, unknown> = {};
  /**
   * Every key a client may push, which is what it draws its controls from.
   *
   * The keys VS Code's agent host declares are spread in first, so a client
   * draws every one the window pushes and a value it pushed reads back as a
   * setting. The host's own keys come after, so a clash would resolve to the
   * host's reading of the same key (there is none).
   *
   * Three of them are read by this host: `defaultShell` and `workspaceTrust`
   * below, which belong to the connection that pushed them, and
   * `globalAutoApproveEnabled`, which `trust.ts` asks before a tool call runs.
   * The rest are declared and nothing more, which is what a client needs and
   * all it gets.
   */
  const ROOT_CONFIG_SCHEMA = {
    // `type` is required of a `ConfigSchema` and is always `object`. Left out,
    // it was a schema a strict reader refuses and a lenient one guesses at.
    type: 'object',
    properties: {
      ...vscodeRootProperties,
      defaultShell: {
        type: 'string',
        title: 'Default Shell',
        description: 'Absolute path to the shell host-managed terminals open. The system shell when unset.',
      },
      /*
       * Which folders the window starting this session trusts.
       *
       * VS Code's own property, `agentHostSchema.ts:864-877`, English strings
       * out of `localize` - see host/66 p1 task 01, which declares it here
       * rather than in the file host/45 task 01 gathers VS Code's keys into.
       * `readOnly` because the value is the window's to push and not a
       * control for a person to set on the host, and required so a client
       * that draws it says both halves. It declares the key and nothing else:
       * what reads it is `PER_CONNECTION` keeping it on the connection that
       * pushed it (`gate.ts`), `trusted` answering a folder from it
       * (`trust.ts`) and the move asking a client before it goes somewhere
       * untrusted.
       */
      workspaceTrust: {
        type: 'object',
        title: 'Workspace Trust',
        properties: {
          enabled: { type: 'boolean', title: 'Enabled' },
          trustedUris: {
            type: 'array',
            title: 'Trusted Folders',
            items: { type: 'string', title: 'Folder URI' },
          },
        },
        required: ['enabled', 'trustedUris'],
        readOnly: true,
      },
    },
  };
  /**
   * The daemon's own root config keys, and where they came from.
   *
   * `HostOptions.rootConfig` is a port rather than a value, so its schema is
   * read once and held: which keys it carries decides which half of a
   * `root/configChanged` this host acts on and which half it keeps, and asking
   * a daemon on every envelope of a channel everybody writes to would be a
   * question asked about the host's own plumbing.
   */
  const daemonSchema = (): Record<string, unknown> => {
    const schema = options.rootConfig?.schema();
    return typeof schema === 'object' && schema !== null ? schema : {};
  };
  /** The properties the daemon's schema declares, or none when it declares none. */
  const daemonProperties = (): Record<string, unknown> => {
    const properties = daemonSchema()['properties'];
    return typeof properties === 'object' && properties !== null ? properties as Record<string, unknown> : {};
  };
  /** Whether a key is the daemon's rather than this host's. */
  const daemonKey = (key: string): boolean => Object.hasOwn(daemonProperties(), key);
  /**
   * Whether a pushed key is one this host can describe.
   *
   * The host's own properties or the daemon's, whoever is asking: a connection
   * without `config:read` is shown none of the daemon's keys, but the key
   * exists and a push of it is a write this host may make, so `seesConfig`
   * decides what a connection is shown and this decides what is real.
   */
  const declaresConfigKey = (key: string): boolean => Object.hasOwn(ROOT_CONFIG_SCHEMA.properties, key) || daemonKey(key);
  /**
   * What this host serves beside `file:`, as one map a client reads.
   *
   * The provider's own claim plus what the host can see for itself: the root
   * URI and the operations its methods implement. Absent when no provider is
   * registered, because presence is how a client knows the key means anything
   * - decision `a-resource-scheme-is-advertised-in-meta`.
   */
  const advertisedSchemes = (): Record<string, unknown> | undefined => {
    const providers = options.resourceProviders;
    if (providers === undefined) return undefined;
    const entries = Object.entries(providers);
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries.map(([scheme, provider]) => {
      const said = typeof provider.describe === 'function' ? provider.describe() : undefined;
      return [scheme, {
        ...(said ?? {}),
        root: `${scheme}://`,
        operations: schemeOperations(provider),
      }];
    }));
  };

  /**
   * One entry per registered scheme the table does not hold, shaped like a
   * built-in one.
   *
   * `operations` are the ones the provider implements, read by the same helper
   * `ahpd.resourceProviders` uses, and the groups are the resource ones - which
   * is what the gate answers from for any subject `OPERATIONS` does not hold,
   * so `team:put` here means exactly what it means at the gate. They are kept
   * to the operations actually advertised, so the invariant every entry carries
   * holds here too: a client's two group lists are its operation list, and
   * neither operation is in both.
   *
   * A built-in subject wins a name a scheme shares with it: `file` is the
   * host's own scheme, and its entry is the table's rather than a provider's.
   */
  const schemeGrants = (): [string, unknown][] => Object.entries(options.resourceProviders ?? {})
    .filter(([scheme]) => !Object.hasOwn(OPERATIONS, scheme))
    .map(([scheme, provider]): [string, unknown] => {
      const said = typeof provider.describe === 'function' ? provider.describe() : undefined;
      const operations = schemeOperations(provider);
      const { groups } = operationsOf(scheme);
      return [scheme, {
        title: said?.title ?? scheme,
        description: said?.description ?? scheme,
        operations,
        groups: {
          read: groups.read.filter((one) => operations.includes(one)),
          write: groups.write.filter((one) => operations.includes(one)),
        },
      }];
    });

  /**
   * Every subject a grant may name, and the operations each one has.
   *
   * Read off `OPERATIONS`, so what the host advertises and what the gate asks
   * for cannot be two lists that drift. Ten subjects are the ones this host
   * decides, and every scheme it serves is beside them under its own name, so a
   * client drawing a role editor reads one map rather than a table and a key it
   * has to join itself. Always present, with or without a
   * directory: it says what a role *could* hold, not what anybody holds, and a
   * host with no `users` still has a `role:` scheme to write a role into.
   *
   * A description is passed through as the table or the provider wrote it,
   * because a client shows it to a person deciding what a grant is for: one
   * short sentence about the subject, and nothing appended here about groups,
   * history or how the host is built.
   */
  const advertisedGrants = (): Record<string, unknown> => Object.fromEntries([
    ...Object.entries(OPERATIONS).map(([subject, mine]) => {
      const { title, description, operations, groups } = mine;
      return [subject, {
        title,
        description,
        operations: [...operations],
        groups: { read: [...groups.read], write: [...groups.write] },
      }];
    }),
    ...schemeGrants(),
  ]);

  const rootState = async (mine: Record<string, unknown> = {}, connection?: Connection): Promise<Bag> => {
    /*
     * The daemon's own half, for a connection that may read it and nobody else.
     *
     * Its keys are not held here the way `rootConfig` holds the host's: the
     * daemon's file is what they are, and a client that read them before a
     * change and reads them after must see two different answers. So both are
     * asked of the port per root state, and asked for nobody who does not hold
     * `config:read`.
     */
    const theirs = seesConfig(connection) ? daemonProperties() : {};
    const daemonValues = Object.keys(theirs).length === 0 || options.rootConfig === undefined
      ? {}
      : await options.rootConfig.values();
    const schemes = advertisedSchemes();
    const meta = {
      ...(schemes === undefined ? {} : { 'ahpd.resourceProviders': schemes }),
      'ahpd.grants': advertisedGrants(),
      ...(ctx.restartNeeded ? { 'ahpd.restartNeeded': true } : {}),
      /*
       * Who this snapshot is for, in the block the handshake already uses.
       *
       * The root snapshot is built per connection, which is the whole of why
       * this key can live here: a client that signs in after connecting learns
       * its id by taking the root snapshot again, and this is the same statement
       * as the handshake's, so a client that subscribes later reads what a
       * client that connected earlier was told. Nobody else's - a snapshot is
       * never cached and never replayed to another connection - decision
       * `a-connection-is-told-who-it-is-on-initialize-and-in-root-state`.
       */
      ...(connection === undefined || ctx.ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ctx.ownerFor(connection) }),
    };
    return {
      // The host's list, rewritten for the one connection asking when it is
      // already somebody: the sign-in resource is the one field that differs.
      agents: connection === undefined ? descriptors() : ctx.agentsFor(connection, descriptors()),
      // What this host is running, not what is on disk beside it.
      activeSessions: sessions.size,
      ...(terminals.size > 0 ? { terminals: ctx.terminalInfo() } : {}),
      /*
       * Always present, and present even when empty.
       *
       * A client's root reducer returns the state *unchanged* when there is no
       * `config` on it, so a host that left this out made every
       * `root/configChanged` a no-op on every client - including the one that
       * had just pushed it.
       */
      /*
       * The host's keys, the daemon's beside them, then this connection's own
       * preferences.
       *
       * A `PER_CONNECTION` key is dropped from the host's half rather than
       * merged under: `rootConfig` still holds whatever was pushed last, because
       * the echo and the replay buffer are one per host, but that copy belongs to
       * nobody and showing it would tell a client that somebody else's shell was
       * its own. So what a connection reads back here is what it pushed, or
       * nothing.
       */
      config: {
        schema: { ...ROOT_CONFIG_SCHEMA, properties: { ...ROOT_CONFIG_SCHEMA.properties, ...theirs } },
        values: {
          ...Object.fromEntries(Object.entries(rootConfig).filter(([key]) => !PER_CONNECTION.has(key))),
          ...mine,
          ...daemonValues,
        },
      },
      /*
       * The same statement as the handshake's, so a client that subscribes later
       * reads what a client that connected earlier was told. `restartNeeded` is
       * for everybody: it names no key and no value, and a client that cannot
       * read the settings is still owed to know that one of them is not in force.
       */
      ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
    };
  };

  return {
    rootConfig, descriptors, daemonSchema, daemonProperties,
    daemonKey, declaresConfigKey, advertisedSchemes, advertisedGrants, rootState,
  };
}