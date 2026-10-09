import { accepts } from '../configvalues.js';
import { frozenCopy } from '../frozen.js';
import { HOSTS_OWN } from './common.js';
import type { SessionConfigAnswerer, SessionConfigAsk } from '../types/completions.js';
import type { Agent } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/** What a session may be configured with, and what this host answers for it. */
export interface SessionConfig {
  isolating: (
    where: string | undefined,
    chosen?: string,
  ) => Promise<{ schema: Bag; defaults: Record<string, unknown>; repository?: string }>;
  mergedConfig(uri: string, theirs: unknown, mine: Record<string, unknown>): Bag;
  propertyOf(agent: Agent | undefined, key: string): { sessionMutable?: boolean; scope?: string } | undefined;
  sessionSchema(agent: Agent): Bag;
  runningSchema(agent: Agent): Bag;
  seeded(properties: Bag, ask: Omit<SessionConfigAsk, 'property' | 'query'>): Promise<Bag>;
  contributedDefaults(): Record<string, unknown>;
  storedConfig(owner: Agent, id: string): Record<string, unknown>;
  mineOf(config: Record<string, unknown>): Record<string, unknown>;
}

/**
 * How many branches ride along in the schema before a client has to ask.
 *
 * The list is ordered by most recent commit, so the first few are the ones
 * somebody means. The rest arrive through `sessionConfigCompletions` as they
 * are typed for.
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
        worktreeIncludeFiles: [],
        worktreeSymlinkFolders: [],
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
           * are eligible - and why the control is `readOnly`, like the three
           * below it: it carries a preference the client already holds rather
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
  const mergedConfig = (uri: string, theirs: unknown, mine: Record<string, unknown>): Bag => {
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
          properties[key] ?? { type: 'string', title: key, readOnly: true, sessionMutable: false },
        ]),
    );
  };

  /**
   * One property of a backend's config schema, as this host reads it.
   *
   * Two fields and no more: `sessionMutable`, which the protocol already
   * declares, and `scope`, which it does not - the protocol's schema is
   * deliberately generic and says nothing about whether a key belongs to a
   * session or to one chat inside it. A backend that says neither gets the
   * safe answers: mutable, and the session's.
   *
   * A key a plugin contributed is found here too, which is what makes a
   * key like `computer` obey the schema it was declared with. The backend's
   * own property wins where both declare one, the same way `sessionSchema`
   * folds them. Read from the raw schemas rather than from `sessionSchema`,
   * because `published` drops `scope` on the way out and this is the one
   * reader that needs it.
   */
  const propertyOf = (agent: Agent | undefined, key: string): { sessionMutable?: boolean; scope?: string } | undefined => {
    if (!agent) return undefined;
    const own = agent.schema();
    const ownProperties = (typeof own.properties === 'object' && own.properties !== null
      ? own.properties
      : {}) as Bag;
    const held = ownProperties[key] ?? options.sessionConfig?.[key];
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
   *
   * `type` is set here rather than asked of the backend. `SessionConfigSchema`
   * declares it as a required `object`, and a backend that lists `properties`
   * without saying what they are properties of publishes a schema a strict
   * client refuses.
   */
  const published = (schema: Bag): Bag => {
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : undefined) as Bag | undefined;
    if (properties === undefined) return { ...schema, type: 'object' };
    return {
      ...schema,
      type: 'object',
      properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => {
        if (typeof value !== 'object' || value === null) return [key, value];
        const { scope: _scope, ...rest } = value as Bag & { scope?: unknown };
        return [key, rest];
      })),
    };
  };

  /**
   * The session schema with what a plugin contributed, on the way out.
   *
   * A contributed key is a control a client draws beside the backend's own,
   * and it exists only while its plugin is loaded. The backend's own property
   * wins where both declare one, because the fold already reported that as a
   * collision and a plugin may not quietly move a setting a backend owns -
   * decision `a-plugin-may-contribute-a-session-key`.
   */
  const sessionSchema = (agent: Agent): Bag => {
    const schema = published(agent.schema());
    const extra = options.sessionConfig;
    if (extra === undefined || Object.keys(extra).length === 0) return schema;
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    return { ...schema, type: 'object', properties: { ...extra, ...properties } };
  };

  /**
   * The schema a *running* session publishes.
   *
   * Every key that may not move once the session runs is marked
   * `sessionMutable: true, readOnly: true`, so a client draws the value the
   * session was created with as a chip that cannot be opened. Without this a
   * fixed key disappears from the window the moment the first turn runs: VS
   * Code draws a chip only for `sessionMutable` keys, with `isolation` and
   * `branch` as the two names it carves out, and nothing said where a
   * session's computer or Claude's thinking had gone.
   *
   * `sessionMutable: true` is not literally true - this host still refuses a
   * change after the first turn, because `propertyOf` reads the schema before
   * this rewrite, where the key is still `sessionMutable: false`. It is the
   * flag that makes the chip appear.
   *
   * Only the backend's and a plugin's keys pass through here. This host's
   * own - `isolation`, `branch` and their companions - are added afterwards
   * by `hostSchema`, and a client draws those by name already.
   */
  const runningSchema = (agent: Agent): Bag => {
    const schema = sessionSchema(agent);
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Bag;
    /*
     * A frozen copy, because this one goes to the backend.
     *
     * `sessionSchema` reads the contributed keys out of the fold, which are
     * another plugin's entries; a backend handed them live could change what a
     * client is drawn - decision
     * `a-plugin-gets-frozen-copies-of-host-values`. The host's own reads of the
     * schema are elsewhere and keep the store, which is what a contributed key
     * exists in.
     */
    return frozenCopy({
      ...schema,
      properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => {
        if (typeof value !== 'object' || value === null) return [key, value];
        const one = value as Bag;
        if (one.sessionMutable !== false) return [key, value];
        return [key, { ...one, sessionMutable: true, readOnly: true }];
      })),
    });
  };

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
  const seeded = async (properties: Bag, ask: Omit<SessionConfigAsk, 'property' | 'query'>): Promise<Bag> => {
    const answerers = options.sessionConfigCompletions;
    if (answerers === undefined) return properties;
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

  /** The defaults a contributed key names, under the backend's own. */
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

  /** What this host answered, in the shape it answered it, for saying back on the session. */
  const mineOf = (config: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
    Object.entries(config)
      // A string, or a list of strings for the two pattern keys, which a
      // session says back in the shape it was given.
      .filter(([key, value]) => HOSTS_OWN.includes(key)
        && (typeof value === 'string'
          || (Array.isArray(value) && value.every((one) => typeof one === 'string'))))
      .map(([key, value]) => [key, value]),
  );

  return {
    isolating, mergedConfig, propertyOf, sessionSchema, runningSchema, seeded,
    contributedDefaults, storedConfig, mineOf,
  };
}