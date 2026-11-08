import { accepts } from '../utils/configvalues.js';
import { frozenCopy } from '../utils/frozen.js';
import { HOSTS_OWN, HOSTS_TAKEN } from './common.js';
import type { SessionConfigAnswerer, SessionConfigAsk } from '../types/completions.js';
import type { Agent, SchemaPolicy } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/** What a session may be configured with, and what this host answers for it. */
export interface SessionConfig {
  isolating: (
    where: string | undefined,
    chosen?: string,
  ) => Promise<{ schema: Bag; defaults: Record<string, unknown>; repository?: string }>;
  mergedConfig(uri: string, theirs: unknown, mine: Record<string, unknown>): Bag;
  formOrdered(properties: Bag, hosts: string[]): Bag;
  propertyOf(agent: Agent | undefined, key: string): { sessionMutable?: boolean; chatMutable?: boolean } | undefined;
  sessionSchema(agent: Agent): Bag;
  runningSchema(agent: Agent): Bag;
  schemaPolicy(): SchemaPolicy;
  seeded(
    properties: Bag,
    ask: Omit<SessionConfigAsk, 'property' | 'query'>,
    also?: Record<string, SessionConfigAnswerer>,
  ): Promise<Bag>;
  contributedDefaults(): Record<string, unknown>;
  storedConfig(owner: Agent, id: string): Record<string, unknown>;
  hostOwnedSessionConfig(config: Record<string, unknown>, offered: Bag): Record<string, unknown>;
  omitHostOwnedSessionConfig(config: Bag): Bag;
}

/**
 * How many branches a completion of the branch answers with, the most
 * recent first: the first few are the ones somebody means.
 */
export const SEEDS = 20;

export function createSessionConfig(ctx: HostContext): SessionConfig {
  const { options, kept } = ctx;

  const isolating = async (where: string | undefined, chosen?: string): Promise<{
    schema: Bag;
    defaults: Record<string, unknown>;
    repository?: string;
  }> => {
    const port = options.worktrees;
    if (!port || where === undefined) return { schema: {}, defaults: {} };
    const repository = await port.repository(where).catch(() => undefined);
    /*
     * A folder outside a repository is offered folder isolation alone, and
     * read-only, as VS Code's host offers it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L979-L1003
     */
    if (repository === undefined) {
      return {
        defaults: { isolation: 'folder' },
        schema: {
          properties: {
            isolation: {
              type: 'string',
              title: 'Isolation',
              description: 'Where the agent should make changes',
              enum: ['folder'],
              enumLabels: ['Folder'],
              enumDescriptions: ['Work directly in the folder'],
              default: 'folder',
              readOnly: true,
              sessionMutable: false,
            },
          },
        },
      };
    }
    /*
     * The branch a session starts from, one seed and the rest asked for as
     * they are typed, as VS Code's host seeds it: a worktree from the
     * repository's default branch, and a folder on the branch checked out,
     * which the port lists first.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1035-L1063
     */
    const head = (await port.branches(repository).catch(() => [] as string[]))[0];
    const base = chosen === 'worktree' ? await port.defaultBranch?.(repository).catch(() => undefined) ?? head : head;
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
        worktreeBranchPrefix: '',
        worktreeIncludeFiles: [],
        worktreeSymlinkFolders: [],
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
           * The branch, seeded with the one a session starts from.
           *
           * `enumDynamic` is the protocol's word for "there are more of these
           * than a picker can hold": the `enum` is the row shown before
           * anybody types, and `sessionConfigCompletions` answers what they
           * type.
           */
          ...(base !== undefined ? {
            branch: {
              type: 'string',
              title: 'Branch',
              description: 'Base branch to work from',
              enum: [base],
              enumLabels: [base],
              default: base,
              enumDynamic: true,
              readOnly: false,
              sessionMutable: false,
            },
          } : {}),
          /*
           * A preference a client seeds rather than a person picks.
           *
           * `readOnly` in the reference too: it carries somebody's
           * `git.branchPrefix`, which the client already holds, rather than a
           * question to put in front of them. Declared so the value rides in
           * the config bag at all; a key a host does not advertise is one a
           * client has no reason to send.
           */
          worktreeBranchPrefix: {
            type: 'string',
            title: 'Branch prefix',
            description: 'Prepended to the branch created for the worktree.',
            default: '',
            readOnly: true,
            sessionMutable: false,
          },
          /*
           * The files a checkout does not carry, and the session needs.
           *
           * Load-bearing rather than a refinement: a worktree has what git
           * tracks, so an ordinary project arrives without its `.env` and
           * without `node_modules`, and the agent inside it cannot run
           * anything. Offering `isolation` without this is offering a feature
           * that fails after the person chose it.
           *
           * An array of patterns, as the reference host declares it and its
           * window sends it. A comma-separated string is read as the list it
           * spells, for a client that sends one.
           */
          worktreeIncludeFiles: {
            type: 'array',
            title: 'Files to bring along',
            description: 'Patterns, in .gitignore syntax, for git-ignored files to copy into the worktree, such as .env',
            items: { type: 'string', title: 'Pattern' },
            default: [],
            // Not `readOnly`, which the reference marks it: ahpc lets a person
            // type it, and a row a client cannot open is a row a person
            // cannot either.
            sessionMutable: false,
          },
          /*
           * The folders a checkout does not carry, shared rather than copied.
           *
           * `node_modules` is the reason. Copying it is minutes and gigabytes
           * for a tree that then has its own dependencies to drift out of step
           * with the checkout's; a link is one directory the agent can build
           * against immediately. What it costs is that a write into it is a
           * write into the checkout too, which is why only git-ignored folders
           * are eligible, and why the control is `readOnly`, as the branch
           * prefix is: it carries a preference the client already holds rather
           * than a question to put in front of somebody.
           *
           * Two passes rather than one, as the reference runs two: a folder
           * that is linked should not also be copied.
           */
          worktreeSymlinkFolders: {
            type: 'array',
            title: 'Folders to share',
            description: 'Patterns, in .gitignore syntax, for git-ignored folders to link into the worktree, such as node_modules',
            items: { type: 'string', title: 'Pattern' },
            default: [],
            readOnly: true,
            sessionMutable: false,
          },
          /*
           * Two more a client seeds rather than a person picks: how somebody
           * wants a branch made, which the client already holds. `readOnly`
           * and declared for the reason the branch prefix is.
           */
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
   * A config schema's properties, in the order the reference host composes
   * them: the isolation key first, then the agent's own and every plugin's in
   * the order they arrived, then this host's other keys (the branch, its
   * prefix, the files and folders a worktree takes) in the order `hosts`
   * gives them, which is the order `isolating` declares them in. `computer`
   * leads with the isolation key: it is the machine the session runs on, and
   * every other answer is about a session on it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11018-L11034
   *
   * `hosts` is the caller's because only it knows which keys this host
   * declared: the isolation keys come from the worktree port and are absent on
   * a host without one.
   */
  const formOrdered = (properties: Bag, hosts: string[]): Bag => {
    const head = ['computer', 'isolation'].filter((key) => Object.hasOwn(properties, key));
    const tail = hosts.filter((key) => !head.includes(key) && Object.hasOwn(properties, key));
    const placed = new Set([...head, ...tail]);
    return Object.fromEntries([
      ...head.map((key) => [key, properties[key]] as const),
      ...Object.entries(properties).filter(([key]) => !placed.has(key)),
      ...tail.map((key) => [key, properties[key]] as const),
    ]);
  };

  /**
   * A config's properties or values with every key this host owns taken out,
   * as VS Code's `omitHostOwnedSessionConfig` takes them out of a provider's
   * config before its host lays its own over it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L539-L545
   */
  const omitHostOwnedSessionConfig = (config: Bag): Bag =>
    Object.fromEntries(Object.entries(config).filter(([key]) => !HOSTS_OWN.includes(key)));

  /**
   * A session's config with this host's own answers folded in.
   *
   * The schema as well as the values: a client draws a control from the
   * schema, so reporting `isolation: 'worktree'` against a schema that never
   * mentions `isolation` is a value with nothing to draw it. Every one of them
   * is `sessionMutable: false`, which is what stops the control once the
   * session has started rather than before it has. The backend's half has
   * every key this host owns taken out before this host's half is laid over
   * it, as VS Code's host composes a session's config.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11010-L11057
   */
  const mergedConfig = (uri: string, theirs: unknown, mine: Record<string, unknown>): Bag => {
    const held = (typeof theirs === 'object' && theirs !== null ? theirs : {}) as Bag;
    const schema = (typeof held.schema === 'object' && held.schema !== null ? held.schema : {}) as Bag;
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    const values = (typeof held.values === 'object' && held.values !== null ? held.values : {}) as Bag;
    const hostProperties = hostSchema(uri, mine);
    return {
      ...held,
      schema: {
        ...schema,
        properties: formOrdered({ ...omitHostOwnedSessionConfig(properties), ...hostProperties }, Object.keys(hostProperties)),
      },
      values: { ...omitHostOwnedSessionConfig(values), ...mine },
    };
  };

  /**
   * The one key this host declares rather than offers.
   *
   * `connectors` is not a question a person answers on the session form: a
   * binding is set by whoever starts the session, so there is no offer to
   * repeat and the row below is the declaration. `additionalProperties` is the
   * protocol's way of saying the map itself is the value - an alias to a
   * `connectors://<adapter>/<id>` string - and `sessionMutable: false` closes
   * it once the session has started, as every other host key.
   */
  const declared: Bag = {
    connectors: {
      type: 'object',
      title: 'Connectors',
      description: 'The connectors this session may use, by name.',
      additionalProperties: { type: 'string' },
      sessionMutable: false,
    },
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
  const hostSchema = (uri: string, mine: Record<string, unknown>): Bag => {
    const properties = ((ctx.offered.get(uri)?.properties ?? {}) as Bag);
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
          properties[key] ?? declared[key] ?? HOSTS_TAKEN[key]
            ?? { type: 'string', title: key, readOnly: true, sessionMutable: false },
        ]),
    );
  };

  /**
   * What the operator's policy says now, as a start and a schema asked for
   * before any session exists are both handed it: the daemon's managed
   * settings and per-tool eligibility, and the auto-approval restriction a
   * VS Code window forwards into the root config, as VS Code's agents read
   * that restriction and their managed settings at launch and when they
   * resolve a chat's config.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7407-L7411
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1579
   */
  const schemaPolicy = (): SchemaPolicy => ({
    ...(options.managedSettingsPermissions === undefined && options.eligibleForAutoApproval === undefined ? {} : {
      managedSettings: {
        ...(options.managedSettingsPermissions === undefined ? {} : { permissions: options.managedSettingsPermissions }),
        ...(options.eligibleForAutoApproval === undefined ? {} : { eligibleForAutoApproval: options.eligibleForAutoApproval }),
      },
    }),
    ...(ctx.rootConfig.autoApprovePolicyRestricted === true ? { autoApprovePolicyRestricted: true } : {}),
  });

  /**
   * One property of a backend's config schema, as this host reads it.
   *
   * Two fields: `sessionMutable`, which the protocol declares, and
   * `chatMutable`, VS Code's, which says a chat may hold its own value of the
   * key, set with `chat/configChanged` on the chat and reaching that chat
   * alone. A key that says neither stays as the session started it, since only
   * `sessionMutable: true` lets a key move after the session is created, and
   * is the session's.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L622-L623
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/protocol/channels-session/state.ts#L612-L618
   *
   * A key a plugin contributed is found here too, which is what makes a
   * key like `computer` obey the schema it was declared with. The contributed
   * property wins where both declare one, the same way `sessionSchema` folds
   * them.
   */
  const propertyOf = (agent: Agent | undefined, key: string): { sessionMutable?: boolean; chatMutable?: boolean } | undefined => {
    if (!agent) return undefined;
    const own = agent.schema(schemaPolicy());
    const ownProperties = (typeof own.properties === 'object' && own.properties !== null
      ? own.properties
      : {}) as Bag;
    const held = options.sessionConfig?.[key] ?? ownProperties[key];
    return typeof held === 'object' && held !== null
      ? held as { sessionMutable?: boolean; chatMutable?: boolean }
      : undefined;
  };

  /** A backend key said to be answered but not declared, so each is said once. */
  const completionsSaid = new Set<string>();

  /**
   * A backend's own answered keys, marked so a client asks for them.
   *
   * A key this backend answers is one a client must be told to ask about, and
   * `enumDynamic` is the protocol's word for it. The pair is set in one place
   * for the same reason a plugin's is: a schema claiming it with nobody
   * registered draws a picker answered with nothing.
   *
   * A key the schema does not declare is left out and said once. It would be a
   * picker for a control the form has no row for, and a typo in a backend's
   * own map is worth a line rather than a silent nothing.
   */
  const answeredKeys = (agent: Agent, properties: Bag): Bag => {
    const completions = agent.completions;
    if (completions === undefined) return properties;
    const out: Bag = { ...properties };
    for (const key of Object.keys(completions)) {
      const held = out[key];
      if (held === undefined) {
        const said = `${agent.provider}\u0000${key}`;
        if (!completionsSaid.has(said)) {
          completionsSaid.add(said);
          ctx.log(`${agent.provider}: completions names ${key}, which its schema does not declare`);
        }
        continue;
      }
      if (typeof held !== 'object' || held === null) continue;
      out[key] = { ...(held as Bag), enumDynamic: true };
    }
    return out;
  };

  /**
   * The session schema with what a plugin contributed and the keys this host
   * takes, on the way out.
   *
   * A contributed key is a control a client draws beside the backend's own,
   * and it exists only while its plugin is loaded. A key this host takes is on
   * every session, as the reference host declares it on its sessions, so a
   * client that sends one only where the schema declares it sends it here,
   * under the backend's own as VS Code's agents spread the platform schema
   * under theirs. A contributed property is this host's contribution and wins
   * a name the backend's schema also declares, and a backend's row for a key
   * this host owns is taken out, as VS Code's host publishes its own in place
   * of the provider's and omits the provider's for every key it owns.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L6168-L6190
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L374
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L539-L545
   *
   * `type` is this host's to set: `SessionConfigSchema` declares it as a
   * required `object`, and a backend that lists `properties` without saying
   * what they are properties of publishes a schema a strict client refuses.
   */
  const sessionSchema = (agent: Agent): Bag => {
    const schema = agent.schema(schemaPolicy());
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    const theirs = omitHostOwnedSessionConfig(answeredKeys(agent, properties));
    return { ...schema, type: 'object', properties: { ...HOSTS_TAKEN, ...theirs, ...options.sessionConfig } };
  };

  /**
   * The schema a *running* session publishes: the session's schema, each key
   * as its backend or its plugin declared it, as the reference host publishes
   * an agent's schema on a running session. A key that may not move once the
   * session runs keeps its `sessionMutable`, and a client draws it as it
   * would under the reference host.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2475-L2492
   *
   * A frozen copy, because this one goes to the backend.
   *
   * `sessionSchema` reads the contributed keys out of the fold, which are
   * another plugin's entries; a backend handed them live could change what a
   * client is drawn. The host's own reads of the schema are elsewhere and keep
   * the store, which is what a contributed key exists in.
   *
   * Only the backend's and a plugin's keys pass through here. This host's
   * own - `isolation`, `branch` and their companions - are added afterwards
   * by `hostSchema`.
   */
  const runningSchema = (agent: Agent): Bag => frozenCopy(sessionSchema(agent));

  /**
   * A contributed key's picker, seeded with what its own answerer says now.
   *
   * `enumDynamic` tells a client to ask, and a client that has not asked yet
   * still has to draw the value it is holding. The reference client labels a
   * chip by looking that value up in `enum` and falls back to the raw value
   * when there is none, so a key with no seed draws a machine as
   * `computer://box` and the empty value - "on this host" - as an empty chip.
   * The host seeds `branch` for exactly this reason; this does the same for a
   * key the host knows nothing about.
   *
   * Asked with an empty query, which is the question a picker asks when it
   * opens, and the property stays `enumDynamic`: the seed is the first page
   * and not the list.
   *
   * A key that already carries an `enum` is left alone - that plugin seeded
   * itself - and an answerer that fails costs its own seed and nothing else,
   * because a machine listing that cannot be read is not a reason to refuse
   * somebody the rest of the form.
   */
  const seeded = async (
    properties: Bag,
    ask: Omit<SessionConfigAsk, 'property' | 'query'>,
    also?: Record<string, SessionConfigAnswerer>,
  ): Promise<Bag> => {
    const mine = options.sessionConfigCompletions;
    if (mine === undefined && also === undefined) return properties;
    const answerers = { ...mine, ...also };
    const keys = Object.keys(properties).filter((key) => {
      const schema = properties[key] as Bag | undefined;
      return answerers[key] !== undefined && schema?.enumDynamic === true && schema.enum === undefined;
    });
    if (keys.length === 0) return properties;

    const out: Bag = { ...properties };
    await Promise.all(keys.map(async (key) => {
      let items;
      try {
        // The `try` covers the call as well as the promise: an answerer that
        // throws before returning one escapes a `.catch` on the result.
        items = await (answerers[key] as SessionConfigAnswerer)({ ...ask, property: key, query: '' });
      }
      catch { return; }
      if (!Array.isArray(items) || items.length === 0) return;
      const schema = out[key] as Bag;
      out[key] = {
        ...schema,
        enum: items.map((one) => one.value),
        enumLabels: items.map((one) => one.label),
        ...(items.some((one) => one.description !== undefined)
          ? { enumDescriptions: items.map((one) => one.description ?? '') }
          : {}),
      };
    }));
    return out;
  };

  /**
   * The defaults a contributed key names, which every caller lays over the
   * backend's own, as VS Code's host sets its values over the provider's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11035-L11036
   */
  const contributedDefaults = (): Record<string, unknown> => {
    const held: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(options.sessionConfig ?? {})) {
      if (schema.default !== undefined) held[key] = schema.default;
    }
    return held;
  };

  /** The stored values already said to be dropped, by session id, key and value, so each is said once. */
  const droppedSaid = new Set<string>();
  /**
   * The config a session was stored with, less what its backend no longer offers.
   *
   * Checked against the schema published now, backend and plugin keys both,
   * because a stored value may name a preset that was renamed or removed
   * since it was written. A value a declared property refuses is left out so
   * the default applies, and said in one line the first time. A key no
   * property declares is handed back as stored: the store only holds keys
   * the backend took, and a backend takes some it does not declare.
   */
  const storedConfig = (owner: Agent, id: string): Record<string, unknown> => {
    const schema = sessionSchema(owner);
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    const held: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(kept.config(id) ?? {})) {
      /*
       * A stored `worktreeIncludeFiles` string, read as the list it spells.
       *
       * The property is an array of patterns, and a session may hold the
       * comma-separated string form, which the array type would refuse and
       * replace with the default. The check below still runs, so a stored
       * value that is neither spelling is still refused.
       */
      const given = key === 'worktreeIncludeFiles' && typeof value === 'string'
        ? value.split(',').map((one) => one.trim()).filter((one) => one !== '')
        : value;
      if (properties[key] === undefined || accepts(properties[key], given)) {
        held[key] = given;
        continue;
      }
      const said = `${id}\u0000${key}\u0000${JSON.stringify(value)}`;
      if (droppedSaid.has(said)) continue;
      droppedSaid.add(said);
      ctx.log(`${ctx.nameOf(id)}: stored ${key} ${JSON.stringify(value)} is not offered; using the default`);
    }
    return held;
  };

  /** Whether a value is the alias map `connectors` holds: an object of strings. */
  const isAliasMap = (value: unknown): value is Record<string, string> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((one) => typeof one === 'string');

  /**
   * The host-owned keys of a client's config, each where its property in
   * `offered` (this host's offer for the session, or the declared
   * `connectors`) takes it, for saying back on the session; a key this host
   * takes, as it was sent. VS Code's host takes isolation only as its
   * property validates it, the branch and its prefix as strings, and the two
   * pattern keys only as lists of strings, keeping each from the provider's
   * config; a value outside its property's shape leaves the default.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L539-L545
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1016-L1018
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11037-L11055
   */
  const hostOwnedSessionConfig = (config: Record<string, unknown>, offered: Bag): Record<string, unknown> => Object.fromEntries(
    Object.entries(config).filter(([key, value]) => {
      if (Object.hasOwn(HOSTS_TAKEN, key)) return true;
      const property = offered[key] ?? declared[key];
      return HOSTS_OWN.includes(key) && property !== undefined && accepts(property, value)
        && (!Array.isArray(value) || value.every((one) => typeof one === 'string'))
        && (key !== 'connectors' || isAliasMap(value));
    }),
  );

  return {
    isolating, mergedConfig, formOrdered, propertyOf, sessionSchema, runningSchema, schemaPolicy, seeded,
    contributedDefaults, storedConfig, hostOwnedSessionConfig, omitHostOwnedSessionConfig,
  };
}