/**
 * `ahpd config`: say where the configuration is, and what it says.
 *
 * The file is read as it stands and printed as JSON values, so what a person
 * sees is what the daemon will fold - no key is interpreted here.
 */

import { existsSync } from 'node:fs';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import type { PluginSpec } from '@ahpd/sdk';
import { configPath, loadConfig, type Config } from '../config.js';
import { serverFields } from './options.js';
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

/** One sentence with every URL's userinfo replaced. */
export const withoutUserinfoIn = (text: string): string => text.replace(USERINFO, '$1<set>@');

/** A plugin spec with the userinfo of its URL, string or `name`, replaced. */
export const withoutUserinfo = (spec: PluginSpec): PluginSpec =>
  typeof spec === 'string'
    ? withoutUserinfoIn(spec)
    : { ...spec, name: withoutUserinfoIn(spec.name) };

/**
 * A plugin entry as a served answer shows it: its option keys, each value `<set>`.
 *
 * A plugin's options are the secrets it was configured with, so a request that
 * may read the settings is told which are there and never what they are -
 * decision `served-answers-hide-plugin-option-values-and-url-credentials`. An
 * entry that is only a name, or has no options, is answered as it is.
 */
export const withoutOptionValues = (spec: PluginSpec): PluginSpec =>
  typeof spec === 'object' && spec !== null && spec.options !== undefined
    ? { ...spec, options: Object.fromEntries(Object.keys(spec.options).map((key) => [key, '<set>'])) }
    : spec;

/**
 * One plugin entry with both of its secrets replaced: the URL's userinfo, then
 * every option value. The order matters only in that the name is read before
 * the options object is rebuilt.
 */
export const withoutSpecSecrets = (spec: PluginSpec): PluginSpec =>
  withoutOptionValues(withoutUserinfo(spec));

/**
 * What a served answer says about the file.
 *
 * The connection token is the deployment's own root credential, and a plugin
 * entry holds two more places a secret is written: the options it was configured
 * with, and the userinfo of a URL it installs from. A request that may read the
 * settings is told they are there and never what they are - decision
 * `served-answers-hide-plugin-option-values-and-url-credentials`. Every plugin
 * entry keeps its keys and has each value replaced; an entry that is only a name
 * is answered as it is. The terminal's own `config` is the process owner reading
 * their own file and keeps printing it.
 */
const withoutSecrets = (found: Config): Config => {
  const at = 'connectionToken' in found ? { ...found, connectionToken: '<set>' } : found;
  if (!Array.isArray(at.plugins)) return at;
  return { ...at, plugins: at.plugins.map(withoutSpecSecrets) };
};

export const declareConfig = (registry: Registry<object>, served?: ServedFacts): Command => registry.action({
  id: 'daemon.config',
  summary: 'Say where the configuration is, and what it says',
  description: 'The path the daemon reads, then every key it holds.',
  surfaces: { cli: { pattern: ['config'] }, http: { method: 'GET', path: '/config' } },
  // Served, the file is the daemon's own, so no field could name another.
  ...(served === undefined ? { input: serverFields } : {}),
  scopes: ['config:write'],
  run: (context) => {
    /*
     * Served, the file is the daemon's own: one that is gone is a daemon that
     * never wrote it, and the path it would have read is still the answer. The
     * terminal's own `--config-file` that names nothing is worth complaining
     * about, so `loadConfig` still refuses it.
     */
    const asked = served === undefined ? context.optional<string>('configFile') : served.configFile;
    const at = asked ?? configPath();
    const found = served !== undefined && !existsSync(at) ? {} : loadConfig(asked);
    const answer = served === undefined ? found : withoutSecrets(found);
    const rows = Object.entries(answer);
    const text = `${at}\n${rows.length === 0
      ? '  (nothing set)\n'
      : `${rows.map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join('\n')}\n`}`;
    return output({ path: at, config: answer }, text);
  },
});
