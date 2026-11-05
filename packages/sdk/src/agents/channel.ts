/**
 * `x-ahpd-agents`: the agents made from the engines a host serves.
 *
 * One row for each stored record, keyed by the agent's id, holding the record
 * as it is kept and a `state`: `ready`, `invalid` when its config no longer
 * fits the engine's schema or its engine refused to open it, or `unavailable` when
 * no plugin registers its engine any more. The engines themselves are listed on
 * `x-ahpd-engines`, built in `agents/engines.ts`.
 *
 * Where an engine's schema marks a field `secret`, or names an `env` variable
 * in `keyVariables`, the value is a secret. A put moves it to the vault under
 * `agent/<id>/<field>` in the owner's scope and keeps a
 * `{ "$secret": "<name>" }` in the record instead, so a listing, a snapshot, an
 * answer and the log never carry it. A field sent empty keeps the secret the
 * record already had, because a client is never given one to send back. A host
 * record's field may hold `{ "fromEnv": "<NAME>" }` instead, which the host
 * reads from its own environment when it opens the record; a team's or a
 * person's record that names one is refused.
 *
 * A field the engine's schema marks `x-ahpd-connector`, or a list whose items
 * it marks, names connectors by id, as a trigger's field does. A put is refused
 * when one names no connector of the adapter the mark asks for, or one whose
 * owner is neither the record's nor the host. A record a start reads back is
 * not checked: the agents open before the connectors do.
 *
 * Three commands serve an agent. `x-ahpd/agents/put` takes
 * `{ id, engine, owner, name, description?, icon?, model?, config }`, checks
 * `config` against the engine's schema, writes the record, calls the engine's
 * `open` with each secret read back, and folds the new agent list into the
 * running host. `x-ahpd/agents/remove` takes `{ id }`, ends the sessions that
 * run on it, takes its secrets out of the vault and takes the record out. Both
 * answer the row a client now holds. `x-ahpd/agents/check` takes `{ id }`,
 * builds the backend again, asks its probe and answers the row with its health.
 *
 * An edit keeps the agent and its sessions: the view `open` was handed is
 * updated in place, so a running session reads the new record at its next
 * turn. A record's id is unique across every owner, and it is also the agent's
 * `provider`: an engine that opens a backend under another id is refused rather
 * than served under a name no row has, and a put never takes an id the daemon
 * or a plugin already serves. A record of an engine no plugin registers stays on
 * disk and is served as `unavailable`: a disabled plugin keeps its agents. The
 * commands run one at a time, so two puts of one id cannot both find it free.
 */

import { INVALID_PARAMS, INTERNAL_ERROR, RpcError } from '../rpc.js';
import { connectorRefusal } from '../connectors/fields.js';
import {
  AGENT_SECRETS,
  asOwner,
  checkedConfig,
  forgetAll as forgetRecordSecrets,
  heldAgainst,
  moveSecrets as moveRecordSecrets,
  onTeam,
  ownerAllows,
  refuseOwner,
  withoutSecrets,
  resolved as resolvedRecord,
  secretPaths,
  DENIED,
} from '../channels/owners.js';
import { isRecordSlug } from '../resources/records.js';
import { recordsChannel, type RecordsChannel } from '../resources/recordschannel.js';
import { bag, isRecord, reason } from '../utils/values.js';
import type { Icon } from '@microsoft/agent-host-protocol';
import type { Agent } from '../types/agent.js';
import type { AgentHealth, AgentOwner, AgentState, AgentTemplate, ServedEngine } from '../types/agents.js';
import type { HandedAgent } from '../types/computers.js';
import type { ConnectorRef } from '../types/connectors.js';
import type { PluginMethod } from '../types/plugin.js';
import type { RecordCollection, StoredRecord } from '../types/records.js';
import type { Grant, Principal } from '../types/users.js';
import type { Vault } from '../types/vault.js';

/** The channel's scheme, and the domain its three commands are named under. */
const SCHEME = 'x-ahpd-agents';
const DOMAIN = 'x-ahpd/agents';
const PUT = `${DOMAIN}/put`;
const REMOVE = `${DOMAIN}/remove`;
const CHECK = `${DOMAIN}/check`;

/** How long a probe may take before its agent is called `unreachable`. */
const CHECK_LIMIT_MS = 10_000;

/** How a agents channel reads its store, and what it asks the host to take. */
export interface AgentsChannelOptions {
  /** The `agents` collection: one JSON record for each agent. */
  collection: RecordCollection;
  /**
   * The engines the plugins registered, read at each call.
   *
   * Read through a function because the engines are known only after the load,
   * and a channel built before it would hold none.
   */
  engines(): Record<string, ServedEngine>;
  /** The vault a secret is written to, and read back from when an engine opens. */
  vault(): Vault | undefined;
  /**
   * Check one value against an engine's schema, throwing the first finding.
   *
   * Taken as an option rather than imported: the sdk takes no third-party
   * runtime, and the schema checker the daemon uses belongs to the server.
   */
  check(value: unknown, schema: Record<string, unknown>, label: string): void;
  /**
   * Fold these agents into the running host, and answer the ids it now serves.
   *
   * Called with every record's agent after a put or a remove, and by `openAll`
   * at a start. A refusal throws, and the host keeps the list it had.
   */
  refold(agents: Agent[]): Promise<ReadonlySet<string>>;
  /** End every session running on one agent, before its record is removed. */
  endSessionsOf(id: string): Promise<void>;
  /**
   * What already serves an agent id this store does not hold, if anything.
   *
   * Answers the daemon, or the plugin that brought the agent, so a put can
   * refuse an id before writing a record the fold would then drop. Read only
   * for a record the store does not already hold.
   */
  holderOf?(id: string): string | undefined;
  /**
   * The connectors this host serves, read at each put.
   *
   * A field of an engine's schema marked `x-ahpd-connector` names one of these.
   * Absent on an embedder with no connectors, which checks no such field, as
   * an automations store with none checks no trigger.
   */
  connectors?(): readonly ConnectorRef[];
  /** Where a record that could not be opened is said. */
  onProblem?(message: string): void;
}

/** The live values one opened record is read through. */
interface OpenView {
  id: string;
  engine: string;
  owner: AgentOwner;
  name: string;
  description: string | undefined;
  icon: Icon | undefined;
  model: string | undefined;
  config: Record<string, unknown>;
}

/** One open agent: what built it, and the view a running session reads. */
interface Opened {
  /**
   * The engine object that built it, kept rather than its name: a plugin reload
   * brings a new object for the same name, and a record left on the old one
   * would keep a backend the unloaded module built.
   */
  engine: ServedEngine;
  /** The values `open` was handed, updated in place on an edit. */
  view: OpenView;
  /** The backend, which a session holds and reads at its next turn. */
  agent: Agent;
}

/** An agents channel, the commands beside it, and the agents it has open. */
export interface AgentsChannel {
  /** What `servedRecords` takes. */
  channel: RecordsChannel;
  /** `x-ahpd/agents/put`, `remove` and `check`, by name. */
  methods: Record<string, PluginMethod>;
  /**
   * Every stored record as an agent, without taking a fold.
   *
   * The records not open are opened, and the ones open have their views
   * refreshed from disk; the same backend object is answered for a record that
   * is already open, because a session holds it. A record whose engine is not
   * loaded, or whose secrets could not be read, is left out and said.
   */
  agents(): Promise<Agent[]>;
  /** Open every stored record, fold the list into the host, and refresh the channel. */
  openAll(): Promise<void>;
  /** Send every reader what the agents are now. */
  refresh(): Promise<void>;
  /**
   * The owner of each stored agent, as the last read of the collection found it.
   *
   * An id with no entry is not a record, and so a host agent. What the host
   * reads to decide which agents one caller is told about.
   */
  owners(): ReadonlyMap<string, AgentOwner | undefined>;
  /**
   * The plugin and the record one open agent runs on inside a machine.
   *
   * Nothing for an id that is not an open record.
   */
  handed(id: string): Promise<HandedAgent | undefined>;
}

export function agentsChannel(options: AgentsChannelOptions): AgentsChannel {
  /**
   * The owner of each stored agent, as the last read of the collection found
   * it.
   *
   * A read builds the next map and swaps it in rather than clearing this one:
   * a caller holding the map it was given keeps what it read, instead of
   * watching an id no record holds yet fall through to the host's rule.
   */
  let owners = new Map<string, AgentOwner | undefined>();
  /**
   * The ids a removal is taking out right now.
   *
   * A record is taken out of the store before the fold that drops it, and the
   * owner entry is kept until that fold is taken, so a caller that reads the
   * map between the two sees an id the store no longer holds. The marker is
   * what keeps it closed in that window: `ownersFor` answers it as a record
   * whose owner nobody can read, which every caller, its owner included, is
   * refused. It is cleared once the fold is taken, and stays when the fold
   * fails.
   */
  const removing = new Set<string>();
  /**
   * The owners map as the host reads it, with the removals in flight closed.
   *
   * An id being removed is answered with an entry that names no owner, so
   * `ownershipOf` reads it as a record nobody may use rather than as an id no
   * record holds - which is a host agent, and open to anyone who may start a
   * session at all.
   */
  const ownersFor = (): ReadonlyMap<string, AgentOwner | undefined> => {
    if (removing.size === 0) return owners;
    const shown = new Map(owners);
    for (const id of removing) shown.set(id, undefined);
    return shown;
  };
  /** The open agents, by id. An id in the map has a backend a session can hold. */
  const open = new Map<string, Opened>();
  /** What the host knows of each agent's health, by id, in memory only. */
  const healths = new Map<string, AgentHealth>();
  /** The ids whose health is the reason their record did not open. */
  const openFailures = new Set<string>();
  /**
   * The ids the host serves, as of the last fold.
   *
   * Absent until the first fold, so a channel that has not folded yet trusts
   * the engine and the schema rather than calling every record invalid.
   */
  let served: ReadonlySet<string> | undefined;

  const problem = (message: string): void => { options.onProblem?.(`${SCHEME}: ${message}`); };

  /** The config a stored record holds, as an object. */
  const configOf = (record: StoredRecord): Record<string, unknown> => bag(record.config);

  /** The engine a stored record names, when this host serves one. */
  const engineOf = (record: StoredRecord): ServedEngine | undefined => options.engines()[String(record.engine)];

  /**
   * The fields an engine keeps secret in a put: its vault values at any
   * depth, in what is sent and what was kept, and its `keyVariables`.
   */
  const secretFields = (engine: ServedEngine, config: Record<string, unknown>, kept: Record<string, unknown>): string[] => {
    const fields = new Set(secretPaths(engine.schema, kept, config));
    for (const variable of engine.keyVariables ?? []) fields.add(`env.${variable}`);
    return [...fields];
  };

  /** Whether a stored config is still one the engine's schema describes. */
  const fits = (config: Record<string, unknown>, schema: Record<string, unknown>): boolean => {
    try {
      options.check(heldAgainst(config, AGENT_SECRETS), schema, 'config');
      return true;
    } catch {
      return false;
    }
  };

  /** The state a stored record is in now. */
  const stateOf = (record: StoredRecord): AgentState => {
    const engine = engineOf(record);
    if (engine === undefined) return 'unavailable';
    if (!fits(configOf(record), engine.schema)) return 'invalid';
    if (served !== undefined && !served.has(record.id)) return 'invalid';
    return 'ready';
  };

  /** The template a record was made from: the engine's answer, else the one whose `command` is the record's. */
  const templateOf = (record: StoredRecord, engine: ServedEngine): AgentTemplate | undefined => {
    const templates = engine.templates ?? [];
    const config = configOf(record);
    if (engine.templateOf !== undefined) return engine.templateOf({ id: record.id, config }, templates);
    const command = config['command'];
    if (typeof command !== 'string') return undefined;
    return templates.find((one) => one.config?.['command'] === command);
  };

  /** The icons a client draws for a record: its own, else its template's. */
  const iconsOf = (record: StoredRecord): Icon[] => {
    if (isRecord(record.icon)) return [record.icon as unknown as Icon];
    const engine = engineOf(record);
    if (engine === undefined) return [];
    return templateOf(record, engine)?.icons ?? [];
  };

  /** One stored record as a client is shown it: its record, its state, and its health where known. */
  const row = (record: StoredRecord): Record<string, unknown> => {
    const health = healths.get(record.id);
    const icons = iconsOf(record);
    return {
      ...record,
      state: stateOf(record),
      ...(icons.length === 0 ? {} : { icons }),
      ...(health === undefined ? {} : { health }),
    };
  };

  /** The values a record is read through, before any secret is read back. */
  const blankView = (record: StoredRecord, owner: AgentOwner): OpenView => ({
    id: record.id,
    engine: String(record.engine),
    owner,
    name: typeof record.name === 'string' ? record.name : record.id,
    description: typeof record.description === 'string' ? record.description : undefined,
    icon: isRecord(record.icon) ? record.icon as unknown as Icon : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    config: {},
  });

  /**
   * Put one record's values on one view.
   *
   * The view is the same object `open` was handed, so a running session reads
   * an edit at its next turn: `open` is not called again, and the backend a
   * session holds is not swapped.
   */
  const fill = (view: OpenView, record: StoredRecord, owner: AgentOwner, config: Record<string, unknown>): void => {
    view.id = record.id;
    view.engine = String(record.engine);
    view.owner = owner;
    view.name = typeof record.name === 'string' ? record.name : record.id;
    view.description = typeof record.description === 'string' ? record.description : undefined;
    view.icon = isRecord(record.icon) ? record.icon as unknown as Icon : undefined;
    view.model = typeof record.model === 'string' ? record.model : undefined;
    view.config = config;
  };

  /**
   * Build one record's backend, with each secret read back from the vault.
   *
   * The agent is named by its record: the fold and the served set key on
   * `provider`, while a client names a record by its id, so a backend under
   * another id is refused here rather than served under an id no row has.
   */
  const opened = async (record: StoredRecord, owner: AgentOwner, engine: ServedEngine): Promise<Opened> => {
    const config = await resolvedRecord(configOf(record), owner, options.vault(), AGENT_SECRETS);
    const view = blankView(record, owner);
    fill(view, record, owner, config);
    const agent = engine.open(view);
    if (agent.provider !== record.id) {
      throw new Error(`${engine.name} opened ${record.id} as ${agent.provider}, and an agent is served by the id of its record`);
    }
    return { engine, view, agent };
  };

  /**
   * The plugin of one open record's engine, and the record twice: as its
   * engine opened it, each secret read back, and as it is stored with each
   * secret field left out.
   */
  const handed = async (id: string): Promise<HandedAgent | undefined> => {
    const entry = open.get(id);
    const stored = entry === undefined ? undefined : await options.collection.get(id);
    if (entry === undefined || stored === undefined) return undefined;
    const { view } = entry;
    const shown = {
      id: view.id,
      engine: view.engine,
      owner: view.owner,
      name: view.name,
      ...(view.description === undefined ? {} : { description: view.description }),
      ...(view.icon === undefined ? {} : { icon: view.icon }),
      ...(view.model === undefined ? {} : { model: view.model }),
    };
    return {
      plugin: entry.engine.spec ?? entry.engine.by,
      record: {
        whole: { ...shown, config: { ...view.config } },
        bare: { ...shown, config: withoutSecrets(configOf(stored), AGENT_SECRETS) },
      },
    };
  };

  /** The agent records the store holds, and the owner each names. */
  const stored = async (): Promise<StoredRecord[]> => {
    const records = await options.collection.list();
    /*
     * A record is in the map even where its owner cannot be read: the entry
     * with `undefined` is what tells an id a record holds, which nobody may
     * use, from an id no record holds, which is the host's own agent.
     */
    const read = new Map<string, AgentOwner | undefined>();
    for (const one of records) read.set(one.id, asOwner(one.owner));
    owners = read;
    return records;
  };

  /**
   * Every stored record as an agent, opening what is not open and refreshing
   * the views of what is.
   *
   * A record already open keeps its backend object, which is what a running
   * session holds: only the view is updated, so an edit reaches the next turn.
   */
  const sync = async (): Promise<Agent[]> => {
    const before = new Map(open);
    const records = await stored();
    const engines = options.engines();
    const agents: Agent[] = [];
    const live = new Set<string>();
    for (const record of records) {
      const owner = asOwner(record.owner);
      if (owner === undefined) {
        problem(`${record.id} names no owner, so it is not served`);
        open.delete(record.id);
        continue;
      }
      if (typeof record.engine !== 'string') {
        problem(`${record.id} names no engine, so it is unavailable`);
        open.delete(record.id);
        continue;
      }
      const engine = engines[record.engine];
      // An engine nobody registers keeps its records on disk, served as `unavailable`.
      if (engine === undefined) {
        open.delete(record.id);
        continue;
      }
      const entry = open.get(record.id);
      // The engine object, not its name: a reload brings a new object, and the
      // backend the old module built would otherwise serve on.
      if (entry !== undefined && entry.engine === engine) {
        try {
          fill(entry.view, record, owner, await resolvedRecord(configOf(record), owner, options.vault(), AGENT_SECRETS));
        } catch (error) {
          /*
           * The vault was unreadable, which says nothing about the record: the
           * last good view and the backend a session holds are kept, and the
           * record stays served. Ending its sessions over a vault hiccup would
           * take a working agent away for a failure that may pass.
           */
          problem(`${record.id} could not be read, and its last good record is still served: ${reason(error)}`);
        }
        agents.push(entry.agent);
        live.add(record.id);
        continue;
      }
      try {
        const one = await opened(record, owner, engine);
        open.set(record.id, one);
        agents.push(one.agent);
        live.add(record.id);
        if (openFailures.delete(record.id)) healths.delete(record.id);
      } catch (error) {
        const message = reason(error);
        problem(`${record.id} could not be opened: ${message}`);
        open.delete(record.id);
        // The row says why, as a failed check does, so a client shows it.
        healths.set(record.id, { result: 'failed', at: new Date().toISOString(), ...(message === '' ? {} : { message }) });
        openFailures.add(record.id);
      }
    }
    for (const id of [...open.keys()]) if (!live.has(id)) open.delete(id);
    /*
     * An agent that is gone, or whose engine changed under it, ends its sessions
     * first: the host keeps a backend that still has one open, so a session on
     * an agent this list no longer holds would run on until the daemon stops.
     * An edit of the same engine keeps its agent, and its sessions.
     */
    for (const [id, was] of before) {
      if (open.get(id) === was) continue;
      try {
        await options.endSessionsOf(id);
      } catch (error) {
        problem(`${id}'s sessions could not be ended: ${reason(error)}`);
      }
    }
    return agents;
  };

  /** Take a record list as the host's agents, and keep the ids it serves. */
  const take = async (agents: Agent[]): Promise<void> => {
    served = await options.refold(agents);
  };

  const source = {
    ids: async (): Promise<string[]> => (await stored()).map((one) => one.id).sort(),
    find: async (id: string): Promise<Record<string, unknown> | undefined> => {
      const record = await options.collection.get(id);
      owners.set(id, record === undefined ? undefined : asOwner(record.owner));
      return record === undefined ? undefined : row(record);
    },
  };

  /**
   * Whether this reader sees this row.
   *
   * `agent:all` reads every row, whoever owns it. `agent:list` reads the ones
   * the caller owns, the ones their teams own and the host's. A reader with
   * neither sees nothing, its own agent included.
   */
  const mayRead = (id: string, reader: Principal): boolean => {
    if (reader.can('agent:all' as Grant)) return true;
    if (!reader.can('agent:list' as Grant)) return false;
    const owner = owners.get(id);
    if (owner === undefined) return false;
    if (owner === 'host') return true;
    if (owner.startsWith('user:')) return reader.plugin === undefined && reader.id === owner.slice('user:'.length);
    return onTeam(reader, owner.slice('team:'.length));
  };

  const channel = recordsChannel(SCHEME, source, {
    grant: 'agent:list' as Grant,
    alsoGrant: 'agent:all' as Grant,
    mayRead,
    mayReadEveryReader: true,
    /*
     * A host agent belongs to everyone and to nobody, so the filter leaves it
     * out and `?owner=me` is the caller's own agents.
     */
    ownerOf: (id, record) => {
      const owner = asOwner(record.owner);
      return owner === undefined || owner === 'host' ? undefined : owner;
    },
    describe: () => ({
      title: 'Agents',
      description: 'The agents this host serves, each a record of an engine.',
    }),
    onProblem: problem,
  });

  /** A string param that names one agent, or a refusal saying what the command needs. */
  const idParam = (command: string, params: Record<string, unknown>): string => {
    const id = params.id;
    if (typeof id !== 'string' || !isRecordSlug(id)) {
      throw new RpcError(INVALID_PARAMS, `${command} needs id, the agent's id, a slug such as build`);
    }
    return id;
  };

  /** The agent's name, which the channel owns rather than the engine's schema. */
  const nameParam = (params: Record<string, unknown>, command: string): string => {
    const name = params.name;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new RpcError(INVALID_PARAMS, `${command} needs name, what a client prints for the agent`);
    }
    return name;
  };

  /** One optional string the channel owns, such as the description or the model. */
  const optionalString = (params: Record<string, unknown>, member: string, command: string): string | undefined => {
    const value = params[member];
    if (value !== undefined && typeof value !== 'string') {
      throw new RpcError(INVALID_PARAMS, `${command} takes ${member} as a string`);
    }
    return value as string | undefined;
  };

  /** One optional icon, which is an `Icon` with a source a client can read. */
  const iconParam = (params: Record<string, unknown>, command: string): Icon | undefined => {
    const value = params.icon;
    if (value === undefined) return undefined;
    if (!isRecord(value) || typeof value['src'] !== 'string' || value['src'] === '') {
      throw new RpcError(INVALID_PARAMS, `${command} takes icon as an object with a src, or nothing`);
    }
    return value as unknown as Icon;
  };

  /**
   * Refuse a team's or a person's record that sets a field only the host may.
   *
   * A `hostOnly` field is where a dangerous setting lives, such as a command a
   * backend runs, and the host's own record is the only one whose person is the
   * daemon's.
   */
  const refuseHostOnly = (config: Record<string, unknown>, owner: AgentOwner, engine: ServedEngine): void => {
    if (owner === 'host') return;
    for (const field of engine.hostOnly ?? []) {
      if (config[field] !== undefined) {
        throw new RpcError(INVALID_PARAMS, `${field} is a host-only field of ${engine.name}, so only a host agent may set it`);
      }
    }
  };

  /**
   * Refuse a team's or a person's record that sets an `env` variable the engine
   * does not name as a key.
   *
   * A free environment can run a program - `NODE_OPTIONS` is enough - so only
   * the variables an engine lists as key fields may be set by anyone but the host.
   * The key fields themselves are secrets, and the vault keeps their values.
   */
  const refuseEnv = (config: Record<string, unknown>, owner: AgentOwner, engine: ServedEngine): void => {
    const env = config.env;
    if (env === undefined) return;
    if (!isRecord(env)) {
      throw new RpcError(INVALID_PARAMS, `${PUT} takes env as an object of variables, or nothing`);
    }
    if (owner === 'host') return;
    const allowed = new Set(engine.keyVariables ?? []);
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) continue;
      if (!allowed.has(name)) {
        throw new RpcError(INVALID_PARAMS, `${name} is not a key variable of ${engine.name}, so only a host agent may set it`);
      }
    }
  };

  /**
   * Refuse a record whose field names a connector its owner may not use.
   *
   * The check an automation's save and a session's bindings make: a field the
   * engine's schema marks, or a list whose items it marks, names connectors of
   * the adapter the mark says, and each has to be one this host serves of that
   * adapter, and the record owner's own or the host's. A host record is host
   * work, which reaches the host's connectors and no person's.
   */
  const refuseConnectors = (config: Record<string, unknown>, owner: AgentOwner, engine: ServedEngine): void => {
    const served = options.connectors?.();
    if (served === undefined) return;
    const refused = connectorRefusal(config, engine.schema, served, owner === 'host' ? undefined : owner);
    if (refused === undefined) return;
    const { field, id, adapter, found } = refused;
    if (found === undefined) {
      throw new RpcError(INVALID_PARAMS, `${field} names ${id}, and this host serves no ${adapter} connector with that id`);
    }
    throw new RpcError(INVALID_PARAMS, `${field} names ${id}, which belongs to ${found.owner ?? 'nobody'}, so ${owner} may not use it`);
  };

  /**
   * The commands run one at a time, in the order they arrived.
   *
   * A put reads whether an id is free before it writes, so two of them run
   * together would both find it free and the second would take the first
   * owner's record. A remove, a check and `openAll` rewrite or read the same
   * open list, so they queue behind a put rather than beside it.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    // The chain moves even when this turn failed, or one refusal would stop
    // every command after it.
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  const put: PluginMethod = {
    grant: 'agent:put' as Grant,
    describe: () => ({ title: 'Make an agent', description: 'Makes or changes one agent record, and serves it.' }),
    authorize: async (params, reader) => ownerAllows('agent', asOwner(params.owner), reader, 'put'),
    handle: (params, reader) => inTurn(() => putOne(params, reader)),
  };

  /**
   * Make or change one record, once its turn comes.
   *
   * A new record is opened before it is written: an engine that cannot make a
   * backend of it, or makes one under another id, leaves the store and the
   * vault as they were and the answer says why. An edit is left to `sync`,
   * which updates the view `open` was already handed and keeps the backend its
   * sessions hold.
   */
  const putOne = async (params: Record<string, unknown>, reader: Principal | undefined): Promise<unknown> => {
    const id = idParam(PUT, params);
    const engineName = params.engine;
    if (typeof engineName !== 'string' || engineName === '') {
      throw new RpcError(INVALID_PARAMS, `${PUT} needs engine, the name of an engine`);
    }
    const engine = options.engines()[engineName];
    if (engine === undefined) {
      throw new RpcError(INVALID_PARAMS, `${engineName} is not an engine this host serves`);
    }
    const owner = asOwner(params.owner);
    if (owner === undefined) {
      throw new RpcError(INVALID_PARAMS, `${PUT} needs owner, one of host, team:<team> or user:<id>`);
    }
    refuseOwner('agent', 'make', owner, reader, 'put');
    const config = params.config ?? {};
    if (!isRecord(config)) {
      throw new RpcError(INVALID_PARAMS, "An agent's config is a JSON object, and that is not one");
    }
    const name = nameParam(params, PUT);
    const description = optionalString(params, 'description', PUT);
    const model = optionalString(params, 'model', PUT);
    const icon = iconParam(params, PUT);
    const before = await options.collection.get(id);
    const was = before === undefined ? undefined : asOwner(before.owner);
    /*
     * An id is unique across every agent, not only across the records: the
     * daemon's own backends and the plugins' keep theirs, and a record under
     * one of those ids would be folded away while its row stayed here. A new
     * record is refused before anything is written.
     */
    if (before === undefined) {
      const holder = options.holderOf?.(id);
      if (holder !== undefined) {
        throw new RpcError(DENIED, `${id} is served by ${holder}, and an agent id is unique`);
      }
    }
    /*
     * An id is unique across every owner, because a client names an agent by
     * it alone: a put never takes one another record holds, and a record
     * written by hand is no exception. Removing that owner's record is the
     * only way to use the id.
     */
    if (before !== undefined && was !== owner) {
      const held = was === undefined ? 'a record written by hand' : `${was}'s`;
      throw new RpcError(DENIED, `${id} is ${held}, and an agent id is unique`);
    }
    refuseHostOnly(config, owner, engine);
    refuseEnv(config, owner, engine);
    // Nothing of another owner's is kept; only the same record's own secrets are.
    const kept = before !== undefined && was === owner ? configOf(before) : {};
    const fields = secretFields(engine, config, kept);
    try {
      options.check(checkedConfig(config, AGENT_SECRETS, fields, kept), engine.schema, `agent ${id}`);
    } catch (error) {
      throw new RpcError(INVALID_PARAMS, reason(error));
    }
    refuseConnectors(config, owner, engine);
    const moved = await moveRecordSecrets({
      rules: AGENT_SECRETS,
      fields,
      config,
      held: kept,
      owner,
      id,
      vault: options.vault(),
      problem,
    });
    const record: StoredRecord = {
      id,
      engine: engineName,
      owner,
      name,
      ...(description === undefined ? {} : { description }),
      ...(icon === undefined ? {} : { icon }),
      ...(model === undefined ? {} : { model }),
      config: moved,
    };
    let built: Opened | undefined;
    if (before === undefined) {
      try {
        built = await opened(record, owner, engine);
      } catch (error) {
        // The record was not written, so the secrets moved for it go back out:
        // a vault entry no record names would outlive the refusal.
        await forgetRecordSecrets(moved, owner, id, AGENT_SECRETS, options.vault(), problem);
        const why = reason(error);
        problem(`${id} was not stored: ${why}`);
        throw new RpcError(INTERNAL_ERROR, `${id} was not stored: ${why}`);
      }
    }
    await options.collection.put(record);
    owners.set(id, owner);
    if (built !== undefined) open.set(id, built);
    try {
      await take(await sync());
    } catch (error) {
      await channel.refresh();
      throw new RpcError(INTERNAL_ERROR, `${id} is stored, but the host did not take it: ${reason(error)}`);
    }
    /*
     * A record written again under an id a failed removal left refused is a
     * new record, and one the store holds: the marker that closed the old one
     * goes out with it.
     */
    removing.delete(id);
    await channel.refresh();
    return row(record);
  };

  const remove: PluginMethod = {
    grant: 'agent:remove' as Grant,
    describe: () => ({ title: 'Remove an agent', description: 'Ends the sessions on one agent and takes its record out.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      if (reader?.can('agent:all' as Grant) === true) return true;
      const before = await options.collection.get(id);
      return before !== undefined && ownerAllows('agent', asOwner(before.owner), reader, 'remove');
    },
    handle: (params, reader) => inTurn(async () => {
      const id = idParam(REMOVE, params);
      const before = await options.collection.get(id);
      if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
      const owner = asOwner(before.owner);
      /*
       * A record naming no scope is one written by hand, and only a caller the
       * gate let through with `agent:remove` reaches it; a record that names one
       * is the owner's, and the gate's grant does not widen that. `agent:all`
       * is the one grant that does: it reads and removes any agent, whoever
       * owns it, which is what an operator's role is given.
       */
      if (owner !== undefined && reader?.can('agent:all' as Grant) !== true) {
        refuseOwner('agent', 'remove', owner, reader, 'remove');
      }
      /*
       * The id is refused to everyone from here on, its owner included: it is
       * not an agent to start on while it is going out. A removal that stops
       * before the record is taken out puts the agent back as it was; one whose
       * record is out stays refused even if the fold fails, because the host
       * still holds the backend and the store no longer says whose it was.
       */
      removing.add(id);
      try {
        /*
         * The sessions go first: `host.replace` keeps a backend that still has
         * a session open, and a record removed beside a live session would come
         * back the moment the fold was taken.
         */
        await options.endSessionsOf(id);
        await forgetRecordSecrets(configOf(before), owner, id, AGENT_SECRETS, options.vault(), problem);
        await options.collection.remove(id);
      } catch (error) {
        removing.delete(id);
        throw error;
      }
      open.delete(id);
      healths.delete(id);
      openFailures.delete(id);
      try {
        await take(await sync());
      } catch (error) {
        await channel.refresh();
        throw new RpcError(INTERNAL_ERROR, `${id} is removed, but the host did not take the new list: ${reason(error)}`);
      }
      /*
       * The owner entry is dropped only once the fold has dropped the record:
       * taken away sooner, a caller reading the map in between finds the id
       * without an owner and takes it for a host agent.
       */
      owners.delete(id);
      removing.delete(id);
      await channel.refresh();
      return {};
    }),
  };

  /** One probe, or `unreachable` when it takes more than the limit to answer. */
  const within = async (probe: Promise<unknown>): Promise<'ok' | 'unreachable'> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'unreachable'>((done) => {
      timer = setTimeout(() => { done('unreachable'); }, CHECK_LIMIT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([probe.then(() => 'ok' as const), late]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /*
   * The check command takes what a put takes: who may change an agent may test
   * it. The owner's rule is asked here, as a put asks it, because a grant that
   * reads the channel says nothing about another person's agent.
   */
  const check: PluginMethod = {
    grant: 'agent:put' as Grant,
    describe: () => ({ title: 'Check an agent', description: "Builds one agent's backend and asks its probe, then answers the row." }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      return before !== undefined && ownerAllows('agent', asOwner(before.owner), reader, 'put');
    },
    handle: (params, reader) => inTurn(async () => {
      const id = idParam(CHECK, params);
      const before = await options.collection.get(id);
      if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
      const owner = asOwner(before.owner);
      if (owner !== undefined) refuseOwner('agent', 'check', owner, reader, 'put');
      const engine = engineOf(before);
      if (engine === undefined) {
        throw new RpcError(INVALID_PARAMS, `${id} is a ${String(before.engine)}, and this host serves no such engine`);
      }
      if (owner === undefined) {
        throw new RpcError(INVALID_PARAMS, `${id} names no owner, so it cannot be opened`);
      }
      let health: AgentHealth;
      try {
        const one = await opened(before, owner, engine);
        const probe = one.agent.probe;
        const result = typeof probe === 'function' ? await within(probe.call(one.agent)) : 'ok';
        health = { result, at: new Date().toISOString() };
      } catch (error) {
        const message = reason(error);
        health = { result: 'failed', at: new Date().toISOString(), ...(message === '' ? {} : { message }) };
      }
      healths.set(id, health);
      openFailures.delete(id);
      await channel.refresh();
      return row(before);
    }),
  };

  const methods: Record<string, PluginMethod> = { [PUT]: put, [REMOVE]: remove, [CHECK]: check };

  return {
    channel,
    methods,
    agents: () => inTurn(() => sync()),
    openAll: () => inTurn(async () => {
      /*
       * A start does not wait for a record it cannot serve: the host serves
       * what opened, and the record stays on disk with the failure said.
       */
      try {
        await take(await sync());
      } catch (error) {
        problem(`the agent records could not be served: ${reason(error)}`);
      }
      await channel.refresh();
    }),
    refresh: () => channel.refresh(),
    owners: ownersFor,
    handed,
  };
}
