/**
 * `ahpd config`: say where the configuration is, and what it says.
 *
 * The files are read as the daemon reads them, merged and with relative paths
 * made absolute, and printed as JSON values beside the file that set each key -
 * no key is checked or interpreted here.
 */

import { existsSync } from 'node:fs';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import type { PluginSpec } from '@ahpd/sdk';
import { secretRef } from '@ahpd/sdk';
import { configDir, configPath, loadConfig, type Config } from '../config.js';
import { nameOf, optionsSchemaOf, schemaOf } from '../plugins.js';
import { flagFields } from './options.js';
import type { ServedFacts } from './served.js';

/**
 * The userinfo of any URL in a sentence, which is where a spec's credential is.
 *
 * `git+https://user:pat@host/repo` is a spec npm installs from, and the part
 * before the `@` is the private repository's credential. The scheme is matched
 * loosely because npm takes several, and the path must hold no `/` or `@` so
 * that only the authority's userinfo matches.
 */
const USERINFO = /([a-zA-Z][\w+.-]*:\/\/)[^/@\s]+@/gu;

/** What an answer says in place of a value it will not carry. */
export const SET = '<set>';

/** One sentence with every URL's userinfo replaced. */
export const withoutUserinfoIn = (text: string): string => text.replace(USERINFO, `$1${SET}@`);

/** A plugin spec with the userinfo of its URL, string or `name`, replaced. */
export const withoutUserinfo = (spec: PluginSpec): PluginSpec =>
  typeof spec === 'string'
    ? withoutUserinfoIn(spec)
    : { ...spec, name: withoutUserinfoIn(spec.name) };

/** A schema or a value that is one object, or `undefined` for anything else. */
const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * What no schema said: every value answers `<set>`.
 *
 * The whole of a plugin's options, for one whose schema was never read.
 */
const NOTHING_MARKED = { additionalProperties: { writeOnly: true } };

/** What one value answers, walked against the schema that describes it. */
const walk = (schema: Record<string, unknown>, value: unknown): unknown => {
  // A reference is a name and not a value, so it answers as written whatever the
  // schema says about the option it is written for: hiding it would hide only
  // where the value comes from.
  if (secretRef(value) !== undefined) return value;
  if (schema['writeOnly'] === true) return SET;
  const items = object(schema['items']);
  if (Array.isArray(value)) return items === undefined ? value : value.map((one) => walk(items, one));
  const held = object(value);
  if (held === undefined) return value;
  return Object.fromEntries(Object.entries(held).map(([key, one]) => [key, walk(schemaOf(schema, key), one)]));
};

/**
 * What one value answers, given the options schema the plugin declared.
 *
 * `writeOnly` is honoured wherever in that schema it says it, so a credential
 * nested under an option of its own - a search provider's key under a web
 * tool - answers `<set>` the same way one at the top does. A value the schema
 * does not describe is carried as it is: only the plugin's own declarations say
 * what of its options is a secret.
 *
 * `schema` is `undefined` for a plugin whose schema was never read, one that
 * could not be imported or is switched off and so was never imported: nothing
 * marks a value, so every one answers `<set>` - decision
 * `root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value`.
 *
 * Every answer about a plugin's options goes through this one mask, so root
 * state, `GET /api/config`, `GET /api/plugin/list` and `POST /api/plugin/config`
 * say the same thing about the same value.
 */
export const maskValue = (schema: Record<string, unknown> | undefined, value: unknown): unknown =>
  walk(schema ?? NOTHING_MARKED, value);

/**
 * What one option's value answers, given the schema of the options around it.
 *
 * No schema at all is not the same as a schema that does not name the option:
 * one that does not name it says nothing, and one that was never read says
 * every value is a credential.
 */
export const maskOption = (schema: Record<string, unknown> | undefined, option: string, value: unknown): unknown =>
  schema === undefined ? (secretRef(value) === undefined ? SET : value) : walk(schemaOf(schema, option), value);

/**
 * The key each entry of `plugins` is carried under in root config.
 *
 * `plugins.<name>`, always: a plugin is loaded once and its options make its
 * variants, so there is one entry per name to key - decision
 * `a-plugin-loads-once-and-each-preset-is-a-variant`.
 */
export const keyed = (specs: readonly PluginSpec[]): { key: string; spec: PluginSpec }[] =>
  specs.map((spec) => ({ key: `plugins.${nameOf(spec)}`, spec }));

/**
 * The options schema to mask each of these plugin keys with.
 *
 * The schema is read from the module a load would import, the way `plugin
 * config` reads it: a daemon answers from modules it has already imported, so
 * this runs no code the daemon has not already run. A spec that is switched off,
 * or whose module does not import, is answered `undefined` and so hides every
 * value.
 */
export const schemasFor = async (specs: PluginSpec[]): Promise<Map<string, Record<string, unknown> | undefined>> => {
  const schemas = new Map<string, Record<string, unknown> | undefined>();
  for (const { key, spec } of keyed(specs)) {
    if (schemas.has(key)) continue;
    schemas.set(key, undefined);
    if (typeof spec !== 'string' && spec.enabled === false) continue;
    try {
      schemas.set(key, await optionsSchemaOf(spec, { configDir: configDir(), cwd: process.cwd() }));
    }
    catch {
      // Said by its effect: nothing marks a value, so every one answers `<set>`.
    }
  }
  return schemas;
};

/**
 * A plugin entry as an answer shows it: every value its schema marks `writeOnly`
 * as `<set>`, and every other as the file holds it. An entry that is only a name,
 * or has no options, is answered as it is.
 */
export const withoutOptionValues = (spec: PluginSpec, schema: Record<string, unknown> | undefined): PluginSpec =>
  typeof spec === 'object' && spec !== null && spec.options !== undefined
    ? { ...spec, options: maskValue(schema, spec.options) as Record<string, unknown> }
    : spec;

/**
 * One plugin entry with both of its secrets replaced: the URL's userinfo, then
 * every option value its schema marks. The order matters only in that the name
 * is read before the options object is rebuilt.
 */
export const withoutSpecSecrets = (spec: PluginSpec, schema: Record<string, unknown> | undefined): PluginSpec =>
  withoutOptionValues(withoutUserinfo(spec), schema);

/**
 * What a served answer says about the file.
 *
 * The connection token is the deployment's own root credential, and a plugin
 * entry holds one more place a secret is written: the userinfo of a URL it
 * installs from. An option the plugin's own schema marks `writeOnly` is
 * answered as `<set>` and any other as the file holds it - decision
 * `root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value`.
 * The terminal's own `config` is the process owner reading their own file and
 * keeps printing it.
 */
const withoutSecrets = async (found: Config): Promise<Config> => {
  const at = 'connectionToken' in found ? { ...found, connectionToken: SET } : found;
  if (!Array.isArray(at.plugins)) return at;
  const schemas = await schemasFor(at.plugins);
  return { ...at, plugins: keyed(at.plugins).map(({ key, spec }) => withoutSpecSecrets(spec, schemas.get(key))) };
};

export const declareConfig = (registry: Registry<object>, served?: ServedFacts): Command => registry.action({
  id: 'daemon.config',
  summary: 'Say where the configuration is, and what it says',
  description: 'Every file the daemon reads, then every key they hold and which file set it.',
  surfaces: { cli: { pattern: ['config'] }, http: { method: 'GET', path: '/config' } },
  // The settings are the daemon's own, so this is done to no kind of row.
  effect: 'read',
  // Served, the file is the daemon's own, so no field could name another.
  ...(served === undefined ? { input: flagFields } : {}),
  scopes: ['config:write'],
  run: async (context) => {
    /*
     * Served, the files are the daemon's own: a named one that is gone is a
     * daemon that never wrote it, and the path it would have read is still the
     * answer. The terminal's own `--config-file` that names nothing is worth
     * complaining about, so `loadConfig` still refuses it.
     */
    const asked = served === undefined ? context.optional<string>('configFile') : served.options.configFile;
    const at = asked ?? configPath();
    const loaded = served !== undefined && asked !== undefined && !existsSync(asked)
      ? { values: {}, files: [], sourceOf: () => undefined }
      : loadConfig(asked);
    const answer = served === undefined ? loaded.values : await withoutSecrets(loaded.values);
    const rows = Object.entries(answer);
    const sources = Object.fromEntries(rows.map(([key]) => [key, loaded.sourceOf(key) ?? at]));
    // Which file set a key is worth a column only when there is more than one.
    const from = (key: string): string => (loaded.files.length > 1 ? ` (${sources[key] ?? at})` : '');
    const text = `${(loaded.files.length === 0 ? [at] : loaded.files).join('\n')}\n${rows.length === 0
      ? '  (nothing set)\n'
      : `${rows.map(([key, value]) => `  ${key}: ${JSON.stringify(value)}${from(key)}`).join('\n')}\n`}`;
    return output({ path: at, files: loaded.files, config: answer, sources }, text);
  },
});
