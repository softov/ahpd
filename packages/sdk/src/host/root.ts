import { availableParallelism, totalmem } from 'node:os';
import { seesAccount, seesConfig, PER_CONNECTION } from './gate.js';
import { OPERATIONS, operationsOf } from '../access/users.js';
import { REMOTE_SESSIONS_META } from '../sessions/remotesession.js';
import { sdkVersion } from '../version.js';
import { vscodeRootProperties } from '../vscoderootconfig.js';
import { CLIENT_QUEUE_BYTES, MINIMUM_LIMIT_BYTES, REPLAY_BYTES } from './limits.js';
import { ROOT } from './channels.js';
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
 * never asked for.
 */
const ORDER = ['get', 'list', 'resolve', 'watch', 'put', 'delete', 'mkdir', 'move', 'copy'] as const;

const METHOD_OF: Record<typeof ORDER[number], string> = {
  get: 'read',
  list: 'list',
  resolve: 'resolve',
  watch: 'watch',
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

/*
 * The machine this host runs on, measured once.
 *
 * VS Code filters the hosts it may delegate a session to by these numbers, so
 * a host that sends none is a host its window never offers. The key, the shape
 * and the three platform names are VS Code's own; its two rules are kept with
 * them. A system whose platform it has no name for is left out rather than
 * guessed at, and the same goes for a count - a value a client cannot read as
 * a capacity is worse than an absent one.
 */
const hostResources = (): Bag => {
  const platform = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'macos'
      : process.platform === 'linux' ? 'linux' : undefined;
  const architecture = process.arch.trim().length > 0 ? process.arch : undefined;
  const cpuCount = capacity(availableParallelism);
  const total = capacity(totalmem);
  const constrained = capacity(() => process.constrainedMemory());
  /*
   * The smaller of the two, because both are ceilings.
   *
   * The machine has so much and the process may use no more than the other
   * says, so what is available to this host is whichever is reached first.
   */
  const memoryBytes = total === undefined ? constrained
    : constrained === undefined ? total : Math.min(total, constrained);
  return {
    ...(platform === undefined ? {} : { platform }),
    ...(architecture === undefined ? {} : { architecture }),
    ...(cpuCount === undefined ? {} : { cpuCount }),
    ...(memoryBytes === undefined ? {} : { memoryBytes }),
  };
};

/** One reading, kept only where it comes back as a positive whole number. */
const capacity = (measure: () => number | undefined): number | undefined => {
  try {
    const value = measure();
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  catch { return undefined; }
};

/**
 * The root config key one backend's account is published under.
 *
 * VS Code has a name for one of them: its window reads the account its own
 * Codex agent runs on out of `vscode.codexAccount`, so a Codex account lands
 * where that window already looks. Every other backend takes the same name with
 * this host's prefix, and there is no other key to take - VS Code names Codex
 * and no other harness.
 *
 * The key is deliberately not one `ROOT_CONFIG_SCHEMA` declares. The value is
 * the harness's own answer about who it is signed in as, so a client that could
 * push one would be telling this host the operator's email - and undeclared, a
 * push of it is refused by the same path every key this host cannot describe
 * takes. It is published into `config.values` all the same, which is where VS
 * Code's own host puts its account: a value a client reads, not a setting it
 * draws a control for.
 */
export const accountKey = (provider: string): string =>
  provider === 'codex' ? 'vscode.codexAccount' : `ahpd.${provider}Account`;

/**
 * The root config key that says the daemon has to start again for a write it
 * took to apply.
 *
 * The host's own value, which it sets with its own `root/configChanged` and
 * which ends with the process that set it. Declared `readOnly`, so a client
 * draws it and does not edit it. A client's push that names it never moves
 * it: the echo says the host's value.
 */
export const RESTART_KEY = 'ahpd.restartNeeded';

/** What the root channel advertises, and the config a client pushes to it. */
export interface Root {
  rootConfig: Record<string, unknown>;
  descriptors(): Bag[];
  daemonSchema(): Record<string, unknown>;
  daemonProperties(): Record<string, unknown>;
  daemonKey(key: string): boolean;
  /** Whether a key the root's config holds is the daemon's to show, a plugin removed while the daemon runs among them. */
  daemonHeld(key: string): boolean;
  declaresConfigKey(key: string): boolean;
  advertisedSchemes(): Record<string, unknown> | undefined;
  advertisedChannels(): { scheme: string; title: string; description?: string; grant: string }[] | undefined;
  advertisedMethods(): { method: string; title: string; description?: string; grant: string }[] | undefined;
  advertisedGrants(): Record<string, unknown>;
  /** The daemon's own config values, as its port answers them now, or none on a host with no daemon keys. */
  daemonValues(): Promise<Record<string, unknown>>;
  /**
   * The state the root channel opens with: every agent, the sessions and
   * terminals this host holds, and the whole config - the host's keys, the
   * daemon's `daemon` values and every backend's account. Read once; every
   * change after it is a root action.
   */
  rootSeed(daemon: Record<string, unknown>): Bag;
  /**
   * The root's held state as one connection reads it: the agents it may use,
   * the config keys it may read with its own preferences in theirs, and the
   * `_meta` the handshake gave it.
   */
  rootFor(held: Bag, mine?: Record<string, unknown>, connection?: Connection): Bag;
  /**
   * What a root config `replace` keeps that the push names none of: the
   * daemon's values, every backend's account and the restart mark, as the
   * root's state holds them. None of them is a client's to clear.
   */
  keptOnReplace(pushed: Record<string, unknown>): Record<string, unknown>;
  /**
   * Say each daemon value that moved since the root's state last said it.
   *
   * For a write to the daemon's file that no client's `root/configChanged`
   * made, which is what a plugin command and a served paths command do.
   * Nothing when the root is not held yet: its first snapshot reads the port.
   */
  daemonValuesMoved(): Promise<void>;
}

export function createRoot(ctx: HostContext): Root {
  const { options, agents, sessions, terminals } = ctx;
  // Measured here rather than per root state: the machine does not change
  // while this process runs, and a client that re-read it would be reading
  // four syscalls for one answer.
  const resources = hostResources();
  // Read once for the same reason, and out of the manifest rather than from a
  // literal here, which is what `version.ts` is for.
  const build = sdkVersion();

  /**
   * Each backend's account, by the key it is published under.
   *
   * Built per root state rather than kept beside `rootConfig`, because where it
   * lives is `about`: a probe fills it at boot and a running session that
   * reports its own replaces it, and two copies of one value are two answers
   * waiting to disagree.
   *
   * A backend no account has been reported for has no key at all, which is the
   * honest shape of "not known yet". VS Code's own reader answers `unknown` for
   * an absent value, and a client draws no account rather than an empty one.
   */
  const accountValues = (): Record<string, unknown> => Object.fromEntries(
    [...agents.values()].flatMap((agent): [string, unknown][] => {
      const { account } = ctx.about(agent.provider);
      return account === undefined ? [] : [[accountKey(agent.provider), account]];
    }),
  );

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
    // Required on `AgentInfo`, and a backend may say none: one that does not
    // is described by its name.
    description: agent.description || agent.displayName,
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
   * Ten of them are read by this host: `defaultShell` and `workspaceTrust`
   * below, which belong to the connection that pushed them, the three
   * terminal and edit rules among VS Code's own, which belong there for the
   * same reason and are what `spawn.ts` answers `getAutoApproval` from,
   * `globalAutoApproveEnabled`, which `trust.ts` asks before a tool call runs,
   * `eligibleForAutoApproval`, which `spawn.ts` asks per tool before a call
   * runs, and this host's own `changeWords`, which says where a commit message
   * and a pull request's words come from, with `clientQueueBytes` and
   * `replayBytes` beside it, which bound what this host holds for a client that
   * is not reading (`limits.ts`). The rest are declared and nothing more, which is
   * what a client needs and all it gets.
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
      /*
       * Whether the daemon has to start again for a write it took to apply.
       * The host's own fact and not a setting, so `readOnly`: a client shows
       * it and its push never moves it (`RESTART_KEY`).
       */
      [RESTART_KEY]: {
        type: 'boolean',
        title: 'Restart Needed',
        description: 'The daemon has to start again for a change it took to apply.',
        readOnly: true,
      },
      /*
       * Where a commit message and a pull request's words come from.
       *
       * This host's own key and not VS Code's: the reference client pushes
       * nothing for it, draws it from here and reads a value it pushed back as
       * a setting. Four modes, and two of them ask something else to write the
       * words - a model on a provider this host serves, or the session's own
       * agent in a side chat. The default is the session title, which is what
       * this host wrote before there was a key at all, so a client that never
       * pushes one sees nothing move.
       */
      changeWords: {
        type: 'object',
        title: 'Change Words',
        description: "Where a commit message and a pull request's words come from when the person gives none.",
        properties: {
          mode: {
            type: 'string',
            title: 'Mode',
            description: "Session Title uses the session's own title, Forced refuses an empty message, Model asks a named model, Agent asks the session's own agent in a side chat.",
            enum: ['session-title', 'forced', 'model', 'agent'],
            enumDescriptions: [
              "Use the session's own title, which is what this host wrote before there was a setting.",
              'Refuse the commit or the pull request when the person gave no words.',
              'Ask a model on a provider this host serves.',
              "Ask the session's own agent in a side chat.",
            ],
            default: 'session-title',
          },
          provider: {
            type: 'string',
            title: 'Provider',
            description: 'The backend to ask, in Model mode. One this host serves.',
          },
          model: {
            type: 'string',
            title: 'Model',
            description: 'The model to run the turn on, in Model mode, as the root channel spells it.',
          },
        },
        required: ['mode'],
      },
      /*
       * How much this host holds for one client that is not reading.
       *
       * The socket queue of a connection whose client reads slower than the
       * host writes grows with every frame it has not taken, and past this the
       * host stops writing to that client and closes it rather than queue for
       * it for as long as it stays connected (`rpc.ts`). Bytes rather than
       * frames, because what a stalled client costs is memory: one action
       * carrying a large tool output is worth a thousand small ones.
       *
       * This host's own key and not VS Code's, like `changeWords` beside it,
       * and read at each send rather than held.
       *
       * A `number` and not an `integer`, and the least value said in the
       * description rather than as a `minimum`: the protocol's property schema
       * declares five types and no bound, so both are what `rootconfig.ts`
       * says for the daemon's own keys.
       */
      clientQueueBytes: {
        type: 'number',
        title: 'Client Queue Bytes',
        description: `The most a client that is not reading may have queued for it, in bytes, before the host closes it. At least ${MINIMUM_LIMIT_BYTES}.`,
        default: CLIENT_QUEUE_BYTES,
      },
      /*
       * How much the replay buffer holds, beside its thousand envelopes.
       *
       * The buffer keeps the last `REPLAY` actions so a client that reconnects
       * is sent what it missed rather than a fresh snapshot of every session it
       * watches. That count bounds nothing about memory: a thousand actions
       * carrying large tool outputs are a thousand envelopes whatever they
       * weigh, and they are held for as long as they stay inside the count.
       * Past this the buffer drops its oldest envelopes, as it does past the
       * count, and a client whose gap is older than what is left is sent
       * snapshots - which is what the protocol does for any gap it cannot
       * replay.
       *
       * Read at each push, and a `number` with its least value in the
       * description, for the reason `clientQueueBytes` above is.
       */
      replayBytes: {
        type: 'number',
        title: 'Replay Bytes',
        description: `The most the replay buffer holds, in bytes, before it drops its oldest envelopes. At least ${MINIMUM_LIMIT_BYTES}.`,
        default: REPLAY_BYTES,
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
   * Every key the daemon's port has declared or answered since the root
   * opened, filled by `rootSeed` and `daemonValuesMoved`.
   *
   * A plugin removed while the daemon runs keeps its property in the root's
   * schema and its `null` in the values, and they are the daemon's still,
   * though the port no longer declares them.
   */
  const daemonSeen = new Set<string>();
  /**
   * Whether a key the root's config holds is the daemon's, shown only to a
   * connection that may read the daemon's settings: one its port declares
   * now, or one it declared or answered since the root opened.
   */
  const daemonHeld = (key: string): boolean => daemonKey(key) || daemonSeen.has(key);
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
   * registered, because presence is how a client knows the key means anything.
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
   * The channels plugins serve, one entry each: the scheme, what a client
   * shows for it, and the grant a subscribe needs.
   *
   * The title is the scheme where the channel does not describe itself.
   * Absent when no plugin serves one, as `ahpd.resourceProviders` is.
   */
  const advertisedChannels = (): { scheme: string; title: string; description?: string; grant: string }[] | undefined => {
    const served = Object.values(options.channels ?? {});
    if (served.length === 0) return undefined;
    return served.map(({ scheme, channel }) => {
      const said = typeof channel.describe === 'function' ? channel.describe() : undefined;
      return {
        scheme,
        title: said?.title ?? scheme,
        ...(said?.description === undefined ? {} : { description: said.description }),
        grant: channel.grant,
      };
    });
  };

  /**
   * The `x-` commands the daemon and plugins serve, one entry each: the name,
   * what a client shows for it, and the grant a call needs.
   *
   * The title is the name where the command does not describe itself. Absent
   * when nobody serves one, as `ahpd.channels` is.
   */
  const advertisedMethods = (): { method: string; title: string; description?: string; grant: string }[] | undefined => {
    const served = Object.values(options.methods ?? {});
    if (served.length === 0) return undefined;
    return served.map(({ name, method }) => {
      const said = typeof method.describe === 'function' ? method.describe() : undefined;
      return {
        method: name,
        title: said?.title ?? name,
        ...(said?.description === undefined ? {} : { description: said.description }),
        grant: method.grant,
      };
    });
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
   * for cannot be two lists that drift. Eleven subjects are the ones this host
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

  /*
   * The daemon's own half of the config.
   *
   * Its keys are not held here the way `rootConfig` holds the host's: the
   * daemon's file is what they are, so the root's state opens with what the
   * port answers. A write a client pushes moves the state through its own
   * `root/configChanged`, and a write no client pushed through
   * `daemonValuesMoved`.
   */
  const daemonValues = async (): Promise<Record<string, unknown>> =>
    (Object.keys(daemonProperties()).length === 0 || options.rootConfig === undefined
      ? {}
      : await options.rootConfig.values());

  const rootSeed = (daemon: Record<string, unknown>): Bag => {
    for (const key of [...Object.keys(daemonProperties()), ...Object.keys(daemon)]) daemonSeen.add(key);
    return {
      agents: descriptors(),
      // What this host is running, not what is on disk beside it.
      activeSessions: ctx.activeCount(),
      ...(terminals.size > 0 ? { terminals: ctx.terminalInfo() } : {}),
      /*
       * Always present, and present even when empty.
       *
       * The root reducer returns the state *unchanged* when there is no `config`
       * on it, so a root without one would make every `root/configChanged` a
       * no-op on every client - including the one that had just pushed it.
       */
      config: {
        schema: { ...ROOT_CONFIG_SCHEMA, properties: { ...ROOT_CONFIG_SCHEMA.properties, ...daemonProperties() } },
        values: { ...rootConfig, ...daemon, ...accountValues(), ...(ctx.restartNeeded ? { [RESTART_KEY]: true } : {}) },
      },
    };
  };

  /** Whether a root config key is one a backend's account is published under. */
  const isAccountKey = (key: string): boolean =>
    [...agents.values()].some((agent) => accountKey(agent.provider) === key);

  const keptOnReplace = (pushed: Record<string, unknown>): Record<string, unknown> => {
    const held = (ctx.stateOf(ROOT)?.config as { values?: Bag } | undefined)?.values ?? {};
    return Object.fromEntries(Object.entries(held)
      .filter(([key]) => !Object.hasOwn(pushed, key) && (daemonKey(key) || isAccountKey(key) || key === RESTART_KEY)));
  };

  const daemonValuesMoved = async (): Promise<void> => {
    if (ctx.stateOf(ROOT) === undefined) return;
    const now = await daemonValues();
    for (const key of [...Object.keys(daemonProperties()), ...Object.keys(now)]) daemonSeen.add(key);
    const held = (ctx.stateOf(ROOT)?.config as { values?: Bag } | undefined)?.values ?? {};
    // A key the file no longer holds is said as `null`, the way a client takes
    // a key back, so a reader that merged the old value is told it is gone.
    const moved = Object.fromEntries([...new Set([...Object.keys(now), ...Object.keys(held).filter(daemonHeld)])]
      .filter((key) => Object.hasOwn(now, key) ? JSON.stringify(held[key]) !== JSON.stringify(now[key]) : held[key] !== null)
      .map((key) => [key, Object.hasOwn(now, key) ? now[key] : null]));
    if (Object.keys(moved).length > 0) ctx.dispatch(ROOT, { type: 'root/configChanged', config: moved });
  };

  const rootFor = (held: Bag, mine: Record<string, unknown> = {}, connection?: Connection): Bag => {
    const config = (held.config ?? { schema: ROOT_CONFIG_SCHEMA, values: {} }) as { schema: Bag; values: Bag };
    /*
     * The daemon's own keys for a connection that may read them and nobody
     * else, and the account each backend bills to likewise: the operator's
     * own, so it is `account:read`'s and the host's - decision
     * `an-agent-account-is-shown-to-account-readers`. A connection without the
     * grant is handed neither, which is the same absence a backend nothing has
     * reported an account for has.
     *
     * A `PER_CONNECTION` key is the pushing client's, so another connection
     * reads its own in its place: the state holds whatever was pushed last,
     * and that copy belongs to nobody.
     */
    const reads = seesConfig(connection);
    const values = Object.fromEntries(Object.entries(config.values).filter(([key]) =>
      !PER_CONNECTION.has(key) && (reads || !daemonHeld(key)) && (seesAccount(connection) || !isAccountKey(key))));
    const properties = (config.schema.properties ?? {}) as Bag;
    const meta = metaFor(connection);
    return {
      ...held,
      // The host's list, rewritten for the one connection asking when it is
      // already somebody: the sign-in resource is the one field that differs.
      agents: connection === undefined ? held.agents : ctx.agentsFor(connection, held.agents),
      config: {
        schema: reads
          ? config.schema
          : { ...config.schema, properties: Object.fromEntries(Object.entries(properties).filter(([key]) => !daemonHeld(key))) },
        values: { ...values, ...mine },
      },
      ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
    };
  };

  /**
   * The root's `_meta`, as one connection reads it: what this host and its
   * plugins offer, in that connection's words, and who the connection is.
   */
  const metaFor = (connection?: Connection): Bag => {
    const schemes = advertisedSchemes();
    const channels = advertisedChannels();
    const methods = advertisedMethods();
    return {
      /*
       * The machine, for a window choosing which host to delegate to.
       *
       * Left out, rather than sent empty, where nothing could be measured: a
       * client reading `{}` has a host it knows nothing about, and an absent
       * key is the same statement with nothing invented.
       */
      ...(Object.keys(resources).length === 0 ? {} : { 'vscode.agentHost.resources': resources }),
      /*
       * And that this host takes a session another window sends it.
       *
       * The window offers a host as a place to delegate a session to only
       * where it says both this and its resources, so a host that kept an
       * origin without saying it would be sent nothing. It goes with the code
       * that keeps the origin and not before it: a window told this of a host
       * that dropped the origin would send a session whose agent never
       * reports back.
       */
      [REMOTE_SESSIONS_META]: true,
      /*
       * The build, which is also what says this host is a native one.
       *
       * VS Code writes this version in its Output channel, and reads the same
       * key to decide that this host is one of its own - for which it expects
       * the legacy `provider:/id` session URIs unless the handshake says
       * otherwise. So this key and `vscode.ahpSessionUris` on `initialize` are
       * one change and never two - decision `ahpd-says-it-is-a-native-host`.
       *
       * Left out where `version.ts` found no manifest: a host telling a client
       * it is version `unknown` is a host that has claimed to be native on the
       * strength of a number it does not have.
       */
      ...(build === 'unknown' ? {} : { hostBuild: { version: build } }),
      ...(schemes === undefined ? {} : { 'ahpd.resourceProviders': schemes }),
      ...(channels === undefined ? {} : { 'ahpd.channels': channels }),
      ...(methods === undefined ? {} : { 'ahpd.methods': methods }),
      'ahpd.grants': advertisedGrants(),
      /*
       * Who this connection is, in the block the handshake already uses.
       *
       * A client that signs in after connecting learns its id by taking the
       * root snapshot again, and this is the same statement as the handshake's,
       * so a client that subscribes later reads what a client that connected
       * earlier was told. Nobody else's.
       */
      ...(connection === undefined || ctx.ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ctx.ownerFor(connection) }),
    };
  };

  return {
    rootConfig, descriptors, daemonSchema, daemonProperties,
    daemonKey, daemonHeld, declaresConfigKey, advertisedSchemes, advertisedChannels, advertisedMethods, advertisedGrants,
    daemonValues, rootSeed, rootFor, keptOnReplace, daemonValuesMoved,
  };
}