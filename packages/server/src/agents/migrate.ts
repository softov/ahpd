/**
 * The presets a configuration file holds, made into agent records.
 *
 * Before an agent was a record, a plugin registered one agent for every preset
 * its options named: `presets` for `claude` and `acp`, a `provider` beside
 * `displayName` for `cofold` and `pi`. A record is now the one thing the agents
 * channel serves, and a plugin registers an engine and no agent at all, so the
 * presets a file still holds would otherwise be dropped without a word.
 *
 * This runs at the start, in two steps around the plugin load. The plan reads
 * the configuration file's own entries, and never the merged options a flag
 * builds for this run, so a `--plugin-option` is not made permanent. The write
 * step runs once the engines have loaded, because an engine's schema is what says
 * which fields of a record are secrets: each plaintext key is moved to the
 * vault under the record's own name, as a put of the agents channel does, and
 * the record keeps `{ "$secret": "<name>" }` in its place.
 *
 * The records are written first and the file second, so a failure leaves the
 * file as it was and the records already written, and the next start finds the
 * records and writes only the rest. Only the presets that became records, or
 * that the records already held, are taken out: one that could not become a
 * record stays in the file, which is its only copy.
 *
 * The built-in claude a file with no presets still describes is written once: a
 * marker beside the file says so, so a record a person removed stays removed.
 *
 * A Claude record may hold a `models` list written before the field held one
 * shape: a string, a model and a fetch in one list. `splitModels` rewrites one
 * into `models` and `modelSources` at the same start, and leaves a record
 * already in the two-list shape untouched.
 *
 * The configuration file is the person's own, so it is copied beside itself
 * before it is rewritten, and the new text is written to a temporary name and
 * renamed over the old one. Nothing here logs a value: a record may hold a key,
 * and the line says the ids only.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bag, isRecord, isRecordSlug, knownAgents, reason, RECORD_SLUG, secretPaths } from '@ahpd/sdk';
import type { PluginSpec, RecordCollection, ServedEngine, StoredRecord, Vault } from '@ahpd/sdk';
import { sourceOf } from '../plugins.js';
import { readEntry, writeEntry } from '../install.js';
import type { LogLevel } from '@ahpd/sdk';

/** The engines whose presets this moves, and the package each ships as. */
const PRESET_ENGINES = [
  ['claude', 'agent-claude'],
  ['acp', 'agent-acp'],
  ['cofold', 'agent-cofold'],
  ['pi', 'agent-pi'],
] as const;

/** One of the engines whose presets this moves. */
type PresetEngine = (typeof PRESET_ENGINES)[number][0];

/**
 * What a spec of each engine carries per agent, and a record carries instead.
 *
 * `claude` and `acp` name all of them under `presets`; the other two wrote one
 * agent's identity as options of their own.
 */
const PER_AGENT: Record<PresetEngine, readonly string[]> = {
  claude: ['presets'],
  acp: ['presets'],
  cofold: ['provider', 'displayName', 'description'],
  pi: ['provider', 'displayName', 'description'],
};

/** The package matching one engine, as the segment a spec names it by. */
const PACKAGE_OF: Record<PresetEngine, RegExp> = Object.fromEntries(PRESET_ENGINES.map(([engine, pkg]) => [
  engine,
  // A package may be scoped and a spec may be a path or a URL, so the package
  // is a segment of what was written: `@ahpd/agent-acp` and
  // `.../agent-acp/index.ts` are `acp`, and `agent-acp-extra` is neither.
  new RegExp(`(^|[/\\\\])${pkg}([/\\\\]|$)`),
])) as Record<PresetEngine, RegExp>;

/** The engine a name of a plugin points at, or nothing when it names none of them. */
const engineOfName = (name: string): PresetEngine | undefined =>
  (Object.keys(PACKAGE_OF) as PresetEngine[]).find((engine) => PACKAGE_OF[engine].test(name));

/** The engine a spec points at. */
const engineOfSpec = (spec: PluginSpec): PresetEngine | undefined => engineOfName(sourceOf(spec));

/** A non-blank string, or nothing for a blank or missing one. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value !== '' ? value : undefined);

/** One object without the given keys, as a new object. */
const without = (value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

/** The options a spec names, as an object. */
const specOptions = (spec: PluginSpec): Record<string, unknown> => (typeof spec === 'string' ? {} : bag(spec.options));

/** A deep copy of a parsed value, so a move never writes to the file it read. */
const copied = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((one) => copied(one)) as unknown as T;
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, copied(one)])) as T;
  return value;
};

/** One agent a preset described, as the record it becomes. */
interface Planned {
  engine: PresetEngine;
  id: string;
  name: string;
  config: Record<string, unknown>;
  description?: string;
  model?: string;
}

/** One agent a preset described, and the preset key it was written at. */
interface Described {
  /** The key under `presets`, or nothing when the agent was the plugin's own options. */
  key?: string;
  plan: Planned;
}

/**
 * The agents one spec's options describe.
 *
 * A preset is the values the plugin used to open an agent with, so the record
 * takes them all but the three the channel owns: `name`, `description` and
 * `model` are the record's own fields and not part of its `config`. An ACP
 * preset keeps its `base`, because a record takes the shipped row it may name
 * the same way. A `$secret` and a `fromEnv` stay as they were written: where a
 * value comes from is not read here, so no key is moved or logged.
 *
 * `builtin` is whether the built-in claude is planned when the values do not
 * name it: true while the file entry still holds a `presets` key, and on the
 * first migration a file with none is found in. A `presets.claude: false` is
 * always taken as written, so a person who turned it off is answered.
 */
const plansOf = (spec: PluginSpec, engine: PresetEngine, builtin: boolean): Described[] => {
  const values = specOptions(spec);
  if (engine === 'claude') {
    const presets = bag(values['presets']);
    const described: Described[] = [];
    if (presets['claude'] !== false && (presets['claude'] !== undefined || builtin)) {
      const given = bag(presets['claude']);
      described.push({ key: 'claude', plan: { engine, id: 'claude', name: text(given['name']) ?? 'Claude', config: without(given, ['name']) } });
    }
    for (const [id, one] of Object.entries(presets)) {
      if (id === 'claude' || one === false) continue;
      const given = bag(one);
      described.push({ key: id, plan: { engine, id, name: text(given['name']) ?? id, config: without(given, ['name']) } });
    }
    return described;
  }
  if (engine === 'acp') {
    const presets = bag(values['presets']);
    const described: Described[] = [];
    for (const [id, one] of Object.entries(presets)) {
      if (one === false) continue;
      const given = bag(one);
      const base = text(given['base']);
      // The name the plugin would have given the agent: what the preset said,
      // then the shipped row's own name, then the key.
      const known = knownAgents[id] ?? (base === undefined ? undefined : knownAgents[base]);
      const description = text(given['description']);
      const model = text(given['model']);
      described.push({
        key: id,
        plan: {
          engine,
          id,
          name: text(given['name']) ?? known?.name ?? id,
          config: without(given, ['name', 'description', 'model']),
          ...(description === undefined ? {} : { description }),
          ...(model === undefined ? {} : { model }),
        },
      });
    }
    return described;
  }
  // cofold and pi wrote one agent as their own options, and every other option
  // was that agent's: it stays as the plugin's defaults, which a record that
  // names nothing runs on, so the record itself carries nothing.
  const provider = text(values['provider']);
  if (provider === undefined) return [];
  const description = text(values['description']);
  return [{
    plan: {
      engine,
      id: provider,
      name: text(values['displayName']) ?? provider,
      config: {},
      ...(description === undefined ? {} : { description }),
    },
  }];
};

/** One planned agent as the record the channel keeps. */
const recordOf = (plan: Planned): StoredRecord => ({
  id: plan.id,
  engine: plan.engine,
  // The host owned the agents a preset registered, and it owns the records they
  // become: a record with no owner is one nobody is served.
  owner: 'host',
  name: plan.name,
  ...(plan.description === undefined ? {} : { description: plan.description }),
  ...(plan.model === undefined ? {} : { model: plan.model }),
  config: plan.config,
});

/**
 * One spec with what a record now holds taken out of its options.
 *
 * The values are the record's now, so a plugin that read them would be reading
 * a second copy. An entry left with no options at all loses the key, which is
 * how a person would have written it.
 */
const cleanSpec = (spec: PluginSpec, engine: PresetEngine): PluginSpec => {
  if (typeof spec === 'string') return spec;
  // A switched-off entry is one this run does not load, so its presets were not
  // written either and are the only copy of its agents.
  if (spec.enabled === false) return spec;
  if (spec.options === undefined) return spec;
  const held = bag(spec.options);
  const keys = PER_AGENT[engine];
  if (!keys.some((key) => held[key] !== undefined)) return spec;
  const kept = without(held, keys);
  const { options: _options, ...rest } = spec;
  return Object.keys(kept).length === 0 ? rest : { ...rest, options: kept };
};

/** One entry of the configuration file, and the agents it described. */
interface EntryPlan {
  /** The entry's place in the file's `plugins`. */
  index: number;
  engine: PresetEngine;
  /** The agents it described, in the order they are written. */
  agents: Described[];
}

/**
 * The file without the presets a record now holds.
 *
 * Only a preset that is a record now, or was one already, is taken out: one
 * whose id could not be a record, or that the write step could not write, is
 * the only copy there is and stays. A `presets` object left empty loses the
 * key; one left holding a preset that did not move keeps it.
 */
const stripped = (
  held: Record<string, unknown>,
  entries: readonly EntryPlan[],
  records: ReadonlySet<string>,
): { entry: Record<string, unknown>; changed: boolean } => {
  const plugins = held['plugins'];
  if (!Array.isArray(plugins)) return { entry: held, changed: false };
  const byIndex = new Map(entries.map((one) => [one.index, one]));
  let changed = false;
  const next = plugins.map((one, index) => {
    const plan = byIndex.get(index);
    if (plan === undefined || !isRecord(one)) return one;
    const options = one['options'];
    if (!isRecord(options)) return one;
    const kept = { ...options };
    let took = false;
    if (plan.engine === 'claude' || plan.engine === 'acp') {
      const presets = kept['presets'];
      if (isRecord(presets)) {
        const rest = { ...presets };
        for (const { key, plan: agent } of plan.agents) {
          if (key === undefined || !records.has(agent.id) || !(key in rest)) continue;
          delete rest[key];
          took = true;
        }
        if (took) {
          if (Object.keys(rest).length === 0) delete kept['presets'];
          else kept['presets'] = rest;
        }
      }
    } else if (plan.agents.some(({ plan: agent }) => records.has(agent.id))) {
      for (const key of PER_AGENT[plan.engine]) {
        if (!(key in kept)) continue;
        delete kept[key];
        took = true;
      }
    }
    if (!took) return one;
    changed = true;
    const { options: _options, ...rest } = one;
    return Object.keys(kept).length === 0 ? rest : { ...rest, options: kept };
  });
  return { entry: changed ? { ...held, plugins: next } : held, changed };
};

/** A moment as a file name carries it: no colon or dot a name cannot hold. */
const stampOf = (when: Date): string => when.toISOString().replaceAll(/[:.]/g, '-');

/**
 * The file that remembers the presets were made into records once.
 *
 * It sits in the folder the agent records are kept in, which is the one thing
 * that says whether the records were migrated - not the folder of the
 * configuration file, which a `--config-file` may put anywhere.
 */
const markerOf = (recordsDir: string): string => join(recordsDir, 'presets-state.json');

/** What `planPresets` is given. */
export interface PlanOptions {
  /** The plugins this run loads, as the file and the flags named them. */
  plugins: PluginSpec[];
  /** The configuration file the presets were written in. */
  configFile: string;
  /** The folder the agent records are kept in, where the marker that they were made once lives. */
  recordsDir: string;
  /** One line per preset that cannot become a record, naming the id and no value. */
  log(message: string, level?: LogLevel): void;
}

/**
 * What the plan found, and what the write step is handed once the plugins load.
 *
 * The specs are the run's own with what a record takes out of them, so a plugin
 * never reads a second copy of the values a record holds.
 */
export interface PresetPlan {
  /** The specs to hand the loader. */
  plugins: PluginSpec[];
  /** The configuration file the presets were written in. */
  configFile: string;
  /** The file as it was read, for the write step to rewrite; absent when there is none. */
  held?: Record<string, unknown>;
  /** The entries of the file that described an agent, by their place in it. */
  entries: EntryPlan[];
  /** Agents with no file entry to take them out of: the run's own, or a file's built-in. */
  loose: Planned[];
  /** Whether the file could not be read, so the records are written and the file is left. */
  unreadable: boolean;
  /** Whether this pass marks the presets as moved, so a removed claude stays removed. */
  marker: boolean;
}

/**
 * Read the configuration file's presets, and say which agents they describe.
 *
 * The plan is taken from the file's own entries, paired by name with the specs
 * this run loads: a spec a flag named for this run alone is not paired, so what
 * it carries is neither made a record nor taken out of the file. A `--plugin`
 * list that loads none of the file's entries leaves the file as it is.
 *
 * With no file at all, only the built-in claude is planned, and only when the
 * records have never been migrated: there is nothing in a file to lose. A file
 * nothing can parse leaves the run's own options as the only copy of its
 * agents, so they are planned and the file is left as it is.
 */
export const planPresets = (options: PlanOptions): PresetPlan => {
  let held: Record<string, unknown> | undefined;
  let unreadable = false;
  if (existsSync(options.configFile)) {
    try {
      held = readEntry(options.configFile);
    }
    catch {
      // The parser's own words are not repeated: it quotes the text it choked
      // on, and the file may hold a key.
      unreadable = true;
    }
  }
  // The one thing that makes the built-in claude happen once: a file whose
  // presets are gone is not a file that asks for it again, and a record a
  // person removed stays removed.
  const migrated = existsSync(markerOf(options.recordsDir));
  const entries: EntryPlan[] = [];
  const loose: Planned[] = [];
  const named = new Map<string, PresetEngine>();
  let marker = false;

  const take = (engine: PresetEngine, described: Described[], entry?: EntryPlan): void => {
    for (const one of described) {
      const { plan } = one;
      if (!isRecordSlug(plan.id)) {
        options.log(`The ${engine} preset ${plan.id} did not become a record: its id is not a slug: ${RECORD_SLUG}`, 'warn');
        continue;
      }
      const other = named.get(plan.id);
      if (other !== undefined) {
        options.log(`The ${engine} preset ${plan.id} did not become a record: ${other} already names an agent of that id.`, 'warn');
        continue;
      }
      named.set(plan.id, engine);
      if (entry === undefined) loose.push(plan);
      else entry.agents.push(one);
    }
  };

  /** The built-in claude one spec would have registered, unless it turned it off. */
  const builtinOf = (spec: PluginSpec): Described | undefined => {
    if (bag(specOptions(spec)['presets'])['claude'] === false) return undefined;
    return { key: 'claude', plan: { engine: 'claude', id: 'claude', name: 'Claude', config: {} } };
  };

  /** The run's specs that load a claude, whatever the file holds. */
  const claudeSpecs = (): PluginSpec[] => options.plugins
    .filter((spec) => (typeof spec === 'string' || spec.enabled !== false) && engineOfSpec(spec) === 'claude');

  const paired = new Set<number>();
  if (held !== undefined) {
    const filePlugins = held['plugins'];
    const listed = Array.isArray(filePlugins) ? filePlugins : [];
    listed.forEach((raw, index) => {
      if (!isRecord(raw) || raw['enabled'] === false) return;
      const name = raw['name'];
      if (typeof name !== 'string') return;
      const engine = engineOfName(name);
      if (engine === undefined) return;
      // The spec this run loads that entry as. A flag naming another spec of the
      // same engine never equals this name, so that entry is left alone.
      const at = options.plugins.findIndex((spec, position) => !paired.has(position)
        && (typeof spec === 'string' || spec.enabled !== false)
        && sourceOf(spec) === name);
      if (at === -1) return;
      paired.add(at);
      const values = bag(raw['options']);
      // The built-in claude is planned while the entry still holds a `presets`
      // key; a file entry with none is given it only on the first migration.
      const builtin = engine === 'claude' && (values['presets'] !== undefined || !migrated);
      const entry: EntryPlan = { index, engine, agents: [] };
      take(engine, plansOf(raw as unknown as PluginSpec, engine, builtin), entry);
      // The marker is for a claude question that this pass settled: the entry
      // holds presets now, or this is the first migration and it is being given
      // its built-in agent.
      if (engine === 'claude' && (values['presets'] !== undefined || !migrated)) marker = true;
      if (entry.agents.length > 0) entries.push(entry);
    });
    // A claude spec the file holds no entry for - a `--plugin` this run named -
    // still gets the built-in agent once, so a host whose only agent is that one
    // has an agent at all. What the run's own options say is this run's and is
    // not made a record.
    if (!migrated) {
      for (const [at, spec] of options.plugins.entries()) {
        if (paired.has(at)) continue;
        if (engineOfSpec(spec) !== 'claude') continue;
        const one = builtinOf(spec);
        if (one === undefined) continue;
        marker = true;
        take('claude', [one]);
      }
    }
  } else if (unreadable) {
    // A file nothing can parse: no entry can be paired with a spec, and nothing
    // can be taken out of it, so the run's own options are the only copy of
    // those agents and they become the records the next start reads.
    for (const spec of options.plugins) {
      if (typeof spec !== 'string' && spec.enabled === false) continue;
      const engine = engineOfSpec(spec);
      if (engine === undefined) continue;
      if (engine === 'claude') marker = true;
      take(engine, plansOf(spec, engine, engine === 'claude' && !migrated));
    }
  } else if (!migrated) {
    // No configuration file at all: there is nothing to take the presets out
    // of, and the built-in claude is the one agent every install has.
    for (const spec of claudeSpecs()) {
      const one = builtinOf(spec);
      if (one === undefined) continue;
      marker = true;
      take('claude', [one]);
    }
  }

  const cleaned = options.plugins.map((spec, at) => {
    const engine = held !== undefined && !paired.has(at) ? undefined : engineOfSpec(spec);
    return engine === undefined ? spec : cleanSpec(spec, engine);
  });
  return { plugins: cleaned, configFile: options.configFile, ...(held === undefined ? {} : { held }), entries, loose, unreadable, marker };
};

/**
 * The fields an engine keeps secret in one config: its vault values at any
 * depth and its `keyVariables`.
 *
 * The same set the agents channel moves on a put, so a record this writes keeps
 * no value a listing would serve. A key inside a list entry is moved by
 * `splitModels`, which runs after this; the paths here reach objects only.
 */
const secretFieldsOf = (engine: ServedEngine, config: Record<string, unknown>): string[] => {
  const fields = new Set(secretPaths(engine.schema, config));
  for (const variable of engine.keyVariables ?? []) fields.add(`env.${variable}`);
  return [...fields];
};

/** The value at a dotted field path. */
const readAt = (config: Record<string, unknown>, path: readonly string[]): unknown => {
  let at: unknown = config;
  for (const key of path) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
};

/** Set a value at a dotted field path, making the objects it needs. */
const putAt = (config: Record<string, unknown>, path: readonly string[], value: unknown): void => {
  const last = path[path.length - 1] as string;
  let at = config;
  for (const key of path.slice(0, -1)) {
    const next = at[key];
    if (isRecord(next)) { at = next; continue; }
    const made: Record<string, unknown> = {};
    at[key] = made;
    at = made;
  }
  at[last] = value;
};

/**
 * One record's config, with every secret it wrote in plaintext moved to the
 * vault.
 *
 * A record may hold no value of a secret field: the channel's own put moves it
 * under the record's name and keeps `{ "$secret": "<name>" }`, and a listing
 * serves the record as it is stored. A `$secret` or a `fromEnv` the preset wrote
 * stays as it was: both name where the value comes from and carry none of it,
 * and a host record resolves either.
 */
const withSecretsMoved = async (
  config: Record<string, unknown>,
  engine: ServedEngine,
  id: string,
  vault: Vault | undefined,
): Promise<Record<string, unknown>> => {
  const out = copied(config);
  for (const field of secretFieldsOf(engine, config)) {
    const path = field.split('.');
    const value = readAt(out, path);
    // An absent field, an empty one and every value that is not a string is
    // no secret this could leak.
    if (typeof value !== 'string' || value === '') continue;
    if (vault === undefined) throw new Error(`this host has no vault, so ${field} cannot be kept`);
    // The name a put of the agents channel gives a host record's secret.
    const name = `host:agent/${id}/${field}`;
    await vault.set(name, value);
    putAt(out, path, { $secret: name });
  }
  return out;
};

/** What one record's split came to: a new config, a reason it was left whole, or nothing to do. */
type Split = { config: Record<string, unknown> } | { left: string } | undefined;

/**
 * One record's config with a mixed `models` list split in two.
 *
 * The old list held a model id, `{ id, name }` or `{ fetch, match, key }`, so a
 * client could not draw one row for it. A string becomes `{ id }`, a model
 * entry is kept as written, and a fetch entry moves to `modelSources`; every
 * other field of the config is kept. Nothing is returned for a config already
 * in the two-list shape. A config holding an entry this rewrite does not know,
 * or a `modelSources` that is not a list, is left whole with the reason, so a
 * record is only ever written when it changed and nothing is dropped.
 */
const splitOf = (config: Record<string, unknown>): Split => {
  const models = config['models'];
  if (!Array.isArray(models)) return undefined;
  const kept: unknown[] = [];
  const moved: unknown[] = [];
  let changed = false;
  for (const [position, entry] of models.entries()) {
    if (typeof entry === 'string') {
      kept.push({ id: entry });
      changed = true;
      continue;
    }
    if (isRecord(entry) && typeof entry['fetch'] === 'string') {
      moved.push(entry);
      changed = true;
      continue;
    }
    if (!isRecord(entry) || typeof entry['id'] !== 'string') {
      return { left: `models entry ${String(position)} is neither a model id, a model nor a fetch` };
    }
    kept.push(entry);
  }
  if (!changed) return undefined;
  const split = { ...config, models: kept };
  if (moved.length === 0) return { config: split };
  const sources = config['modelSources'] ?? [];
  if (!Array.isArray(sources)) return { left: 'modelSources is not a list' };
  return { config: { ...split, modelSources: [...sources, ...moved] } };
};

/**
 * One config with each model source key written in plain text moved to the vault.
 *
 * The name is the one a put of the agents channel gives the same key, in the
 * record's owner's scope, so the next put of the record finds it its own.
 * Nothing is returned when no key needed moving.
 */
const withSourceKeysMoved = async (
  config: Record<string, unknown>,
  id: string,
  owner: string,
  vault: Vault,
): Promise<Record<string, unknown> | undefined> => {
  const sources = config['modelSources'];
  if (!Array.isArray(sources)) return undefined;
  let changed = false;
  const out: unknown[] = [];
  for (const [position, source] of sources.entries()) {
    const key = isRecord(source) ? source['key'] : undefined;
    if (!isRecord(source) || typeof key !== 'string' || key === '') { out.push(source); continue; }
    const field = `agent/${id}/modelSources.${String(position)}.key`;
    const name = owner === 'host' ? `host:${field}` : `${owner}/${field}`;
    await vault.set(name, key);
    out.push({ ...source, key: { $secret: name } });
    changed = true;
  }
  return changed ? { ...config, modelSources: out } : undefined;
};

/** What `splitModels` is given. */
export interface SplitOptions {
  /** The `agents` collection, where a record is rewritten. */
  records: RecordCollection;
  /** The vault a model source key written in plain text is moved to. */
  vault?: Vault;
  /** One line per rewrite, naming record ids and no value. */
  log(message: string, level?: LogLevel): void;
}

/** Whether a record's owner is one a secret name can be made in. */
const ownerOf = (value: unknown): string | undefined => {
  if (value === 'host') return 'host';
  if (typeof value === 'string' && /^(team|user):[^/]+$/u.test(value)) return value;
  return undefined;
};

/**
 * Rewrite each Claude record's mixed `models` list into `models` and
 * `modelSources`, and move each model source key written in plain text to the
 * vault, once at start.
 *
 * A record already in the two-list shape with no plain key is not written, so a
 * second start writes nothing. A record this cannot split is left as it is and
 * said with its reason, the same as a record that could not be written: nothing
 * here refuses a start, and no value of a record - a key among them - is read
 * into a line.
 */
export const splitModels = async (options: SplitOptions): Promise<string[]> => {
  let records: StoredRecord[];
  try {
    records = await options.records.list();
  }
  catch (error) {
    options.log(`The Claude models were not split: the agent records could not be read: ${reason(error)}`, 'error');
    return [];
  }
  const written: string[] = [];
  for (const record of records) {
    if (record.engine !== 'claude') continue;
    const split = splitOf(bag(record.config));
    if (split !== undefined && 'left' in split) {
      options.log(`The models of ${record.id} were not split: ${split.left}.`, 'warn');
      continue;
    }
    let config = split?.config;
    const owner = ownerOf(record.owner);
    try {
      if (options.vault !== undefined && owner !== undefined) {
        config = await withSourceKeysMoved(config ?? bag(record.config), record.id, owner, options.vault) ?? config;
      }
      if (config === undefined) continue;
      await options.records.put({ ...record, config });
    }
    catch (error) {
      options.log(`The models of ${record.id} were not split: ${reason(error)}`, 'error');
      continue;
    }
    written.push(record.id);
  }
  if (written.length > 0) {
    options.log(`Split ${written.length === 1 ? 'one agent' : `${String(written.length)} agents`} into models and modelSources: ${written.join(', ')}.`);
  }
  return written;
};

/** What `applyPresets` is given. */
export interface ApplyOptions {
  /** What the plan found, and the specs the loader was handed. */
  plan: PresetPlan;
  /** The `agents` collection, where every agent is a record now. */
  records: RecordCollection;
  /** The folder the agent records are kept in, where the marker that they were made once lives. */
  recordsDir: string;
  /** The engines this run loaded, by name, which is what says where a key goes. */
  engines: Readonly<Record<string, ServedEngine>>;
  /** Where a secret is kept; a host with none writes no record that holds one. */
  vault: Vault | undefined;
  /** One line per thing done, naming record ids and no value. */
  log(message: string, level?: LogLevel): void;
  /** The clock the backup's timestamp is taken from. */
  now?(): Date;
}

/** What `applyPresets` did. */
export interface Applied {
  /** The ids of the records this run wrote. */
  written: string[];
}

/**
 * Write the planned agents as records, take them out of the configuration file,
 * and mark the presets as moved.
 *
 * A failure at any step leaves the file as it was and the records already
 * written, and says so without a value: the next start finds the records it
 * made and writes only the rest. Nothing is done, and nothing is logged, when
 * the plan found no agent the records do not already hold - which is what a
 * second start after this one finds.
 */
export const applyPresets = async (options: ApplyOptions): Promise<Applied> => {
  const { plan } = options;
  const clock = options.now ?? (() => new Date());
  /** Whether every planned agent was settled, so the presets were really moved. */
  let complete = true;

  /** Mark the presets as moved, so a file with none never re-adds the claude. */
  const mark = (): void => {
    if (!plan.marker || !complete) return;
    try {
      writeEntry(markerOf(options.recordsDir), { version: 1, at: clock().toISOString() });
    }
    catch (error) {
      options.log(`The presets were moved, but ${markerOf(options.recordsDir)} could not be written: ${reason(error)}`, 'warn');
    }
  };

  let present: Set<string>;
  try {
    present = new Set((await options.records.list()).map((one) => one.id));
  }
  catch (error) {
    options.log(`The presets were not moved: the agent records could not be read: ${reason(error)}`, 'error');
    return { written: [] };
  }

  // Every record first: a file rewritten before them would lose the agents if
  // one write failed. A record already there is one this file's preset already
  // became, so its preset is taken out with the ones written now.
  const written: string[] = [];
  const accounted = new Set<string>();
  const agents = [...plan.entries.flatMap((entry) => entry.agents.map((one) => one.plan)), ...plan.loose];
  for (const agent of agents) {
    if (present.has(agent.id)) {
      accounted.add(agent.id);
      continue;
    }
    const engine = options.engines[agent.engine];
    if (engine === undefined) {
      // The engine did not load, so what its schema says is a secret is unknown
      // and no plugin serves the record: it stays in the file to try again, and
      // the pass is not one that can say the presets were moved.
      complete = false;
      options.log(`${agent.id} did not become a record: the engine ${agent.engine} did not load.`, 'error');
      continue;
    }
    let config: Record<string, unknown>;
    try {
      config = await withSecretsMoved(agent.config, engine, agent.id, options.vault);
    }
    catch (error) {
      options.log(`The presets were not moved: ${agent.id} could not be written as a record: ${reason(error)}`, 'error');
      return { written };
    }
    try {
      await options.records.put(recordOf({ ...agent, config }));
    }
    catch (error) {
      options.log(`The presets were not moved: ${agent.id} could not be written as a record: ${reason(error)}`, 'error');
      return { written };
    }
    present.add(agent.id);
    accounted.add(agent.id);
    written.push(agent.id);
  }

  if (plan.unreadable) {
    mark();
    options.log(`The presets were not taken out of ${plan.configFile}: it could not be read, and is as it was.`, 'warn');
    return { written };
  }

  let changed = false;
  let backup: string | undefined;
  if (plan.held !== undefined) {
    const taken = stripped(plan.held, plan.entries, accounted);
    changed = taken.changed;
    if (changed) {
      // Beside the file and named after it, before anything is written over it.
      backup = `${plan.configFile}.bak-${stampOf(clock())}`;
      try {
        copyFileSync(plan.configFile, backup);
        writeEntry(plan.configFile, taken.entry);
      }
      catch (error) {
        options.log(`The presets in ${plan.configFile} were not taken out: ${reason(error)}`, 'error');
        return { written };
      }
    }
  }
  mark();

  const kept = backup === undefined ? '' : ` ${backup} holds the file as it was.`;
  if (written.length > 0) {
    options.log(`Moved ${String(written.length)} ${written.length === 1 ? 'preset' : 'presets'} to agent records owned by the host: ${written.join(', ')}.${kept}`);
  } else if (changed) {
    options.log(`The presets in ${plan.configFile} were already agent records: ${agents.map((one) => one.id).join(', ')}.${kept}`);
  }
  return { written };
};
