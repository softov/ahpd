/**
 * `ahpd config`: say where the configuration is, and what it says.
 *
 * The file is read as it stands and printed as JSON values, so what a person
 * sees is what the daemon will fold - no key is interpreted here.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { configPath, loadConfig } from '../config.js';
import { serverFields } from './options.js';

export const declareConfig = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.config',
  summary: 'Say where the configuration is, and what it says',
  description: 'The path the daemon reads, then every key it holds.',
  surfaces: { cli: { pattern: ['config'] }, http: { method: 'GET', path: '/config' } },
  input: serverFields,
  scopes: ['config:write'],
  run: (context) => {
    const named = context.optional<string>('configFile');
    const at = named ?? configPath();
    const found = loadConfig(named);
    const rows = Object.entries(found);
    const text = `${at}\n${rows.length === 0
      ? '  (nothing set)\n'
      : `${rows.map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join('\n')}\n`}`;
    return output({ path: at, config: found }, text);
  },
});
